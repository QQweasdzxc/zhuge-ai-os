package handler

// TaskFlow-owned receipt wrapper for signed GitHub pull_request deliveries.
// The existing Multica handler still performs PR upsert, native issue auto-link,
// and refresh triggering. This wrapper adds durable delivery idempotency and
// verifies the PR mirror/link writes before returning a persisted receipt.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/handler/taskflowcontract"
)

func (h *Handler) HandleTaskflowGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	switch r.Header.Get("X-GitHub-Event") {
	case "issue_comment":
		h.HandleTaskflowCodexCommentWebhook(w, r)
		return
	case "pull_request":
		// TaskFlow records the native PR snapshot and link below.
	default:
		// Other native events (including check_run/check_suite) continue through
		// the upstream handler. Its 202 means accepted for refresh, not a
		// persisted check snapshot; only pull_request receipts are labeled below.
		h.HandleGitHubWebhookNative(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (10<<20)+1))
	if err != nil || len(body) > 10<<20 {
		writeError(w, http.StatusRequestEntityTooLarge, "GitHub webhook body too large")
		return
	}
	secret := githubWebhookSecret()
	if secret == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if !verifyWebhookSignature(secret, r.Header.Get("X-Hub-Signature-256"), body) {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}
	deliveryID := strings.TrimSpace(r.Header.Get("X-GitHub-Delivery"))
	if !taskflowcontract.ValidGitHubDeliveryID(deliveryID) {
		writeError(w, http.StatusBadRequest, "valid GitHub delivery id required")
		return
	}
	var payload ghPullRequestPayload
	if err := json.Unmarshal(body, &payload); err != nil ||
		payload.PullRequest.Number <= 0 ||
		payload.Installation.ID <= 0 ||
		strings.TrimSpace(payload.Repository.Owner.Login) == "" ||
		strings.TrimSpace(payload.Repository.Name) == "" ||
		!taskflowcontract.ValidGitHubHeadSHA(payload.PullRequest.Head.SHA) {
		writeError(w, http.StatusBadRequest, "invalid pull request event")
		return
	}
	updatedAt, timeErr := time.Parse(time.RFC3339, payload.PullRequest.UpdatedAt)
	if timeErr != nil {
		writeError(w, http.StatusBadRequest, "pull request update time is required")
		return
	}
	updatedAt = updatedAt.UTC().Truncate(time.Microsecond)
	if h.DB == nil || h.TxStarter == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt store unavailable")
		return
	}
	digest := taskflowcontract.PayloadSHA256(body)
	_, err = h.DB.Exec(r.Context(),
		"INSERT INTO taskflow.github_webhook_delivery "+
			"(delivery_id,event_type,action,repo_owner,repo_name,pr_number,payload_sha256,processing_state) "+
			"VALUES($1,'pull_request',$2,$3,$4,$5,$6,'received') ON CONFLICT(delivery_id) DO NOTHING",
		deliveryID, payload.Action, payload.Repository.Owner.Login, payload.Repository.Name,
		payload.PullRequest.Number, digest)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt could not be recorded")
		return
	}

	claim, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt unavailable")
		return
	}
	var state string
	var recordedDigest string
	var receiptUpdatedAt time.Time
	err = claim.QueryRow(r.Context(),
		"SELECT processing_state,payload_sha256,updated_at FROM taskflow.github_webhook_delivery "+
			"WHERE delivery_id=$1 FOR UPDATE", deliveryID).Scan(&state, &recordedDigest, &receiptUpdatedAt)
	if err != nil {
		_ = claim.Rollback(r.Context())
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt unavailable")
		return
	}
	if !taskflowcontract.DeliveryPayloadMatches(recordedDigest, body) {
		_ = claim.Commit(r.Context())
		writeError(w, http.StatusConflict, "GitHub delivery id was already used for a different payload")
		return
	}
	if state == "persisted" || state == "ignored" {
		_ = claim.Commit(r.Context())
		if state == "ignored" {
			writeJSON(w, http.StatusAccepted, map[string]any{
				"delivery_id": deliveryID, "receipt": "ignored", "duplicate": true,
			})
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"delivery_id": deliveryID, "receipt": "persisted", "duplicate": true,
		})
		return
	}
	if state == "processing" && time.Since(receiptUpdatedAt) < 2*time.Minute {
		_ = claim.Commit(r.Context())
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery is still processing; redeliver later")
		return
	}
	_, err = claim.Exec(r.Context(),
		"UPDATE taskflow.github_webhook_delivery SET processing_state='processing',"+
			"attempt_count=attempt_count+1,last_error_code=NULL,updated_at=now() WHERE delivery_id=$1",
		deliveryID)
	if err != nil {
		_ = claim.Rollback(r.Context())
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery claim failed")
		return
	}
	if err := claim.Commit(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery claim failed")
		return
	}

	nativeRequest := r.Clone(r.Context())
	nativeRequest.Body = io.NopCloser(bytes.NewReader(body))
	nativeResponse := httptest.NewRecorder()
	h.HandleGitHubWebhookNative(nativeResponse, nativeRequest)
	if nativeResponse.Code < http.StatusOK || nativeResponse.Code >= http.StatusMultipleChoices {
		h.failTaskflowGitHubDelivery(r, deliveryID, "native_webhook_rejected")
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusServiceUnavailable, "GitHub pull request event was not accepted")
		return
	}

	var mirrorRows, expectedMirrorRows, staleMirrorRows, mismatchedSnapshotRows int64
	var linkedIssueRows int64
	expectedState := derivePRState(payload.PullRequest.State, payload.PullRequest.Draft, payload.PullRequest.Merged)
	err = h.DB.QueryRow(r.Context(), `
	SELECT
	 (SELECT count(*) FROM taskflow.github_pull_request
	   WHERE installation_id=$1 AND repo_owner=$2 AND repo_name=$3 AND pr_number=$4),
	 (SELECT count(*) FROM taskflow.github_installation WHERE installation_id=$1),
	 (SELECT count(*) FROM taskflow.github_pull_request
	   WHERE installation_id=$1 AND repo_owner=$2 AND repo_name=$3 AND pr_number=$4 AND pr_updated_at<$5),
	 (SELECT count(*) FROM taskflow.github_pull_request
	   WHERE installation_id=$1 AND repo_owner=$2 AND repo_name=$3 AND pr_number=$4 AND pr_updated_at=$5
	     AND (head_sha IS DISTINCT FROM $6 OR state IS DISTINCT FROM $7))`,
		payload.Installation.ID, payload.Repository.Owner.Login, payload.Repository.Name,
		payload.PullRequest.Number, updatedAt, payload.PullRequest.Head.SHA, expectedState).Scan(
		&mirrorRows, &expectedMirrorRows, &staleMirrorRows, &mismatchedSnapshotRows)
	if err == nil && expectedMirrorRows == 0 {
		// This signed delivery belongs to an installation no longer connected
		// to a TaskFlow workspace. Acknowledge it durably instead of asking
		// GitHub to retry a delivery that the native handler intentionally drops.
		_, ignoreErr := h.DB.Exec(r.Context(),
			"UPDATE taskflow.github_webhook_delivery SET processing_state='ignored',"+
				"last_error_code='installation_not_linked',processed_at=now(),updated_at=now() "+
				"WHERE delivery_id=$1 AND processing_state='processing'", deliveryID)
		if ignoreErr != nil {
			w.Header().Set("Retry-After", "30")
			writeError(w, http.StatusServiceUnavailable, "unlinked GitHub installation receipt could not be recorded")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false,
			"reason": "installation_not_linked", "provider_run_acknowledged": false,
		})
		return
	}
	if err != nil || mirrorRows == 0 || expectedMirrorRows == 0 || mirrorRows < expectedMirrorRows ||
		staleMirrorRows > 0 || mismatchedSnapshotRows > 0 {
		h.failTaskflowGitHubDelivery(r, deliveryID, "pull_request_mirror_not_persisted")
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusServiceUnavailable, "GitHub pull request snapshot was not persisted")
		return
	}
	err = h.DB.QueryRow(r.Context(),
		"SELECT count(*) FROM taskflow.issue_pull_request ipr "+
			"JOIN taskflow.github_pull_request pr ON pr.id=ipr.pull_request_id "+
			"WHERE pr.installation_id=$1 AND pr.repo_owner=$2 AND pr.repo_name=$3 AND pr.pr_number=$4",
		payload.Installation.ID, payload.Repository.Owner.Login, payload.Repository.Name,
		payload.PullRequest.Number).Scan(&linkedIssueRows)
	if err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "issue_pr_link_readback_failed")
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusServiceUnavailable, "TaskFlow PR link state could not be verified")
		return
	}

	finalize, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "delivery_finalize_unavailable")
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery finalization unavailable")
		return
	}
	eventKind := "github_pr_updated"
	if payload.PullRequest.Merged {
		eventKind = "github_pr_merged"
	}
	_, err = finalize.Exec(r.Context(),
		"INSERT INTO taskflow.zhuge_ai_engineering_event "+
			"(run_id,state,event_kind,source_delivery_id,github_sha) "+
			"SELECT run.id,run.state,$5,$1,"+
			"CASE WHEN pr.head_sha ~ '^[a-f0-9]{40}$' THEN pr.head_sha ELSE NULL END "+
			"FROM taskflow.github_pull_request pr "+
			"JOIN taskflow.issue_pull_request ipr ON ipr.pull_request_id=pr.id "+
			"JOIN taskflow.zhuge_ai_engineering_run run ON run.issue_id=ipr.issue_id "+
			"WHERE pr.installation_id=$2 AND pr.repo_owner=$3 AND pr.repo_name=$4 AND pr.pr_number=$6 "+
			"ON CONFLICT (run_id,source_delivery_id) WHERE source_delivery_id IS NOT NULL DO NOTHING",
		deliveryID, payload.Installation.ID, payload.Repository.Owner.Login,
		payload.Repository.Name, eventKind, payload.PullRequest.Number)
	if err != nil {
		_ = finalize.Rollback(r.Context())
		h.failTaskflowGitHubDelivery(r, deliveryID, "run_pr_event_write_failed")
		writeError(w, http.StatusServiceUnavailable, "TaskFlow PR event could not be recorded")
		return
	}
	_, err = finalize.Exec(r.Context(),
		"UPDATE taskflow.github_webhook_delivery SET processing_state='persisted',"+
			"mirror_rows=$2,linked_issue_rows=$3,last_error_code=NULL,processed_at=now(),updated_at=now() "+
			"WHERE delivery_id=$1 AND processing_state='processing'",
		deliveryID, mirrorRows, linkedIssueRows)
	if err != nil {
		_ = finalize.Rollback(r.Context())
		h.failTaskflowGitHubDelivery(r, deliveryID, "delivery_receipt_write_failed")
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt could not be completed")
		return
	}
	if err := finalize.Commit(r.Context()); err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "delivery_commit_failed")
		writeError(w, http.StatusServiceUnavailable, "GitHub delivery receipt could not be completed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"delivery_id": deliveryID, "receipt": "persisted", "duplicate": false,
		"mirrored_pr_rows": mirrorRows, "linked_issue_rows": linkedIssueRows,
		"provider_run_acknowledged": false,
	})
}

func (h *Handler) failTaskflowGitHubDelivery(r *http.Request, deliveryID, code string) {
	_, err := h.DB.Exec(r.Context(),
		"UPDATE taskflow.github_webhook_delivery SET processing_state='failed',"+
			"last_error_code=$2,updated_at=now() WHERE delivery_id=$1 AND processing_state<>'persisted'",
		deliveryID, code)
	if err != nil {
		// The caller still returns 503. A failed receipt update is observable
		// from the delivery's previous state and is never reported processed.
		return
	}
}

// Keep the native method name available to TaskFlow's existing handler tests
// and any in-package callers while the router is wrapped by the overlay.
func (h *Handler) HandleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	h.HandleGitHubWebhookNative(w, r)
}
