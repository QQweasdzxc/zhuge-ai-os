package handler

// Signed GitHub issue_comment receipts for the existing @codex PR workflow.
// Raw comment bodies are processed in memory only; only the bounded summary
// and opaque webhook digest are retained by TaskFlow.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/handler/taskflowcontract"
)

type codexIssueCommentPayload struct {
	Action string `json:"action"`
	Issue  struct {
		Number      int32 `json:"number"`
		PullRequest *struct {
			URL string `json:"url"`
		} `json:"pull_request"`
	} `json:"issue"`
	Comment struct {
		ID   int64  `json:"id"`
		Body string `json:"body"`
		User struct {
			Login string `json:"login"`
		} `json:"user"`
	} `json:"comment"`
	Repository struct {
		Name  string `json:"name"`
		Owner struct {
			Login string `json:"login"`
		} `json:"owner"`
	} `json:"repository"`
	Installation struct {
		ID int64 `json:"id"`
	} `json:"installation"`
}

type codexAckMarker struct {
	DispatchID    string  `json:"dispatch_id"`
	CheckpointSHA string  `json:"checkpoint_sha"`
	Status        string  `json:"status"`
	ThreadID      *string `json:"thread_id"`
}

type codexResultMarker struct {
	DispatchID string `json:"dispatch_id"`
	ThreadID   string `json:"thread_id"`
	State      string `json:"state"`
	CommitSHA  string `json:"commit_sha"`
	Summary    string `json:"summary"`
}

type codexFailureMarker struct {
	DispatchID string `json:"dispatch_id"`
	ThreadID   string `json:"thread_id"`
	Summary    string `json:"summary"`
}

func codexMarker(body, name string, target any) bool {
	if len(body) > 128*1024 {
		return false
	}
	prefix, suffix := "<!-- ZHUGE_CODEX_"+name+"_V1 ", " -->"
	found := false
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, prefix) || !strings.HasSuffix(line, suffix) {
			continue
		}
		if found {
			return false
		}
		found = true
		encoded := strings.TrimSuffix(strings.TrimPrefix(line, prefix), suffix)
		decoder := json.NewDecoder(strings.NewReader(encoded))
		decoder.DisallowUnknownFields()
		if decoder.Decode(target) != nil {
			return false
		}
		var trailing any
		if decoder.Decode(&trailing) != io.EOF {
			return false
		}
	}
	return found
}

func codexMarkerCount(body string) int {
	if len(body) > 128*1024 {
		return -1
	}
	count := 0
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		for _, name := range []string{"ACK", "RESULT", "FAILURE"} {
			if strings.HasPrefix(line, "<!-- ZHUGE_CODEX_"+name+"_V1 ") && strings.HasSuffix(line, " -->") {
				count++
			}
		}
	}
	return count
}

func codexMarkerDispatchID(kind string, ack codexAckMarker, result codexResultMarker, failure codexFailureMarker) string {
	switch kind {
	case "ack":
		return ack.DispatchID
	case "result":
		return result.DispatchID
	default:
		return failure.DispatchID
	}
}

func (h *Handler) finishCodexCommentIgnored(r *http.Request, deliveryID, code string) {
	_, _ = h.DB.Exec(r.Context(), `UPDATE taskflow.github_webhook_delivery
	SET processing_state='ignored',last_error_code=$2,processed_at=now(),updated_at=now()
	WHERE delivery_id=$1 AND processing_state='processing'`, deliveryID, code)
}

func (h *Handler) HandleTaskflowCodexCommentWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, (10<<20)+1))
	if err != nil || len(body) > 10<<20 {
		writeError(w, http.StatusRequestEntityTooLarge, "GitHub webhook body too large")
		return
	}
	secret := githubWebhookSecret()
	if secret == "" || !verifyWebhookSignature(secret, r.Header.Get("X-Hub-Signature-256"), body) {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}
	deliveryID := strings.TrimSpace(r.Header.Get("X-GitHub-Delivery"))
	if !taskflowcontract.ValidGitHubDeliveryID(deliveryID) {
		writeError(w, http.StatusBadRequest, "valid GitHub delivery id required")
		return
	}
	var payload codexIssueCommentPayload
	if json.Unmarshal(body, &payload) != nil || payload.Issue.Number <= 0 || payload.Comment.ID <= 0 ||
		payload.Installation.ID <= 0 || payload.Repository.Owner.Login == "" || payload.Repository.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid GitHub issue comment event")
		return
	}
	if h.DB == nil || h.TxStarter == nil {
		writeError(w, http.StatusServiceUnavailable, "Codex receipt store unavailable")
		return
	}
	digest := taskflowcontract.PayloadSHA256(body)
	_, err = h.DB.Exec(r.Context(), `
	INSERT INTO taskflow.github_webhook_delivery
	(delivery_id,event_type,action,repo_owner,repo_name,pr_number,payload_sha256,processing_state)
	VALUES($1,'issue_comment',$2,$3,$4,$5,$6,'received') ON CONFLICT(delivery_id) DO NOTHING`,
		deliveryID, payload.Action, payload.Repository.Owner.Login, payload.Repository.Name, payload.Issue.Number, digest)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Codex receipt could not be recorded")
		return
	}
	claim, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Codex receipt claim unavailable")
		return
	}
	var receiptState, recordedDigest string
	var updatedAt time.Time
	err = claim.QueryRow(r.Context(), `SELECT processing_state,payload_sha256,updated_at FROM taskflow.github_webhook_delivery WHERE delivery_id=$1 FOR UPDATE`, deliveryID).Scan(&receiptState, &recordedDigest, &updatedAt)
	if err != nil {
		_ = claim.Rollback(r.Context())
		writeError(w, http.StatusServiceUnavailable, "Codex receipt claim unavailable")
		return
	}
	if !taskflowcontract.DeliveryPayloadMatches(recordedDigest, body) {
		_ = claim.Commit(r.Context())
		writeError(w, http.StatusConflict, "GitHub delivery id was reused with different content")
		return
	}
	if receiptState == "persisted" || receiptState == "ignored" {
		_ = claim.Commit(r.Context())
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": receiptState, "duplicate": true})
		return
	}
	if receiptState == "processing" && time.Since(updatedAt) < 2*time.Minute {
		_ = claim.Commit(r.Context())
		w.Header().Set("Retry-After", "30")
		writeError(w, http.StatusServiceUnavailable, "Codex receipt is processing; redeliver later")
		return
	}
	_, err = claim.Exec(r.Context(), `UPDATE taskflow.github_webhook_delivery SET processing_state='processing',attempt_count=attempt_count+1,last_error_code=NULL,updated_at=now() WHERE delivery_id=$1`, deliveryID)
	if err != nil {
		_ = claim.Rollback(r.Context())
		writeError(w, http.StatusServiceUnavailable, "Codex receipt claim failed")
		return
	}
	if err = claim.Commit(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Codex receipt claim failed")
		return
	}
	if payload.Action != "created" || payload.Issue.PullRequest == nil ||
		payload.Repository.Owner.Login != "QQweasdzxc" || payload.Repository.Name != "zhuge-ai-os" ||
		payload.Comment.User.Login != codexGitHubBotLogin {
		h.finishCodexCommentIgnored(r, deliveryID, "untrusted_or_irrelevant_comment")
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false})
		return
	}
	if !taskflowCodexDispatchEnabled() {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_callback_disabled")
		writeError(w, http.StatusServiceUnavailable, "Codex callback processing is disabled")
		return
	}
	if codexMarkerCount(payload.Comment.Body) != 1 {
		h.finishCodexCommentIgnored(r, deliveryID, "codex_marker_count_invalid")
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false})
		return
	}
	var ack codexAckMarker
	var result codexResultMarker
	var failure codexFailureMarker
	kind := ""
	switch {
	case codexMarker(payload.Comment.Body, "ACK", &ack):
		kind = "ack"
	case codexMarker(payload.Comment.Body, "RESULT", &result):
		kind = "result"
	case codexMarker(payload.Comment.Body, "FAILURE", &failure):
		kind = "failure"
	default:
		h.finishCodexCommentIgnored(r, deliveryID, "unrecognized_codex_marker")
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false})
		return
	}
	markerDispatchID := codexMarkerDispatchID(kind, ack, result, failure)
	var runID, runState, dispatchID, checkpointSHA string
	var threadID pgtype.Text
	var installID int64
	err = h.DB.QueryRow(r.Context(), `
	SELECT run.id::text,run.state,run.provider_dispatch_id::text,run.github_dispatch_head_sha,
	       run.provider_thread_id,pr.installation_id
	FROM taskflow.zhuge_ai_engineering_run run
	JOIN taskflow.issue_pull_request ipr ON ipr.issue_id=run.issue_id
	JOIN taskflow.github_pull_request pr ON pr.id=ipr.pull_request_id
	WHERE run.provider_dispatch_id=$1::uuid AND run.github_pr_number=$2
	  AND pr.pr_number=$2 AND pr.installation_id=$3
	  AND pr.repo_owner=$4 AND pr.repo_name=$5 AND pr.workspace_id=run.workspace_id
	ORDER BY pr.pr_updated_at DESC LIMIT 1`, markerDispatchID, payload.Issue.Number, payload.Installation.ID,
		payload.Repository.Owner.Login, payload.Repository.Name).Scan(&runID, &runState, &dispatchID, &checkpointSHA, &threadID, &installID)
	if errors.Is(err, pgx.ErrNoRows) {
		h.finishCodexCommentIgnored(r, deliveryID, "dispatch_not_found_for_pr")
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false})
		return
	}
	if err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_dispatch_lookup_failed")
		writeError(w, http.StatusServiceUnavailable, "Codex dispatch lookup unavailable")
		return
	}
	if installID != payload.Installation.ID || dispatchID != markerDispatchID {
		h.finishCodexCommentIgnored(r, deliveryID, "dispatch_identity_mismatch")
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "ignored", "duplicate": false})
		return
	}
	if kind == "ack" {
		if ack.CheckpointSHA != checkpointSHA || (ack.Status != "accepted" && ack.Status != "blocked") ||
			(ack.Status == "accepted" && (ack.ThreadID == nil || !taskflowcontract.ValidCodexThreadID(*ack.ThreadID))) ||
			(ack.Status == "blocked" && ack.ThreadID != nil) {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_invalid")
			writeError(w, http.StatusUnprocessableEntity, "Codex ACK did not match the authorized dispatch")
			return
		}
		newState, eventKind, providerError := "running", "provider_ack", ""
		if ack.Status == "blocked" {
			newState, eventKind, providerError = "blocked", "dispatch_blocked", "codex_provider_blocked"
		}
		if runState == newState && ((ack.ThreadID == nil && !threadID.Valid) || (ack.ThreadID != nil && threadID.Valid && *ack.ThreadID == threadID.String)) {
			h.finishCodexCommentPersisted(r, deliveryID)
			writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "persisted", "run_id": runID, "state": runState, "provider_acknowledged": ack.Status == "accepted"})
			return
		}
		tx, beginErr := h.TxStarter.Begin(r.Context())
		if beginErr != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_tx_unavailable")
			writeError(w, http.StatusServiceUnavailable, "Codex ACK transaction unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		var updatedRun string
		threadValue := any(nil)
		if ack.ThreadID != nil {
			threadValue = *ack.ThreadID
		}
		err = tx.QueryRow(r.Context(), `
		UPDATE taskflow.zhuge_ai_engineering_run SET state=$4,provider_thread_id=$5,provider_receipt_id=$6,
		 last_error_code=NULLIF($7,''),revision=revision+1,updated_at=now()
		WHERE id=$1::uuid AND provider_dispatch_id=$2::uuid AND github_dispatch_head_sha=$3
		 AND state IN ('dispatch_pending','provider_ack_pending') RETURNING id::text`,
			runID, dispatchID, checkpointSHA, newState, threadValue, strconv.FormatInt(payload.Comment.ID, 10), providerError).Scan(&updatedRun)
		if err != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_state_conflict")
			writeError(w, http.StatusConflict, "Codex ACK arrived for a Run that is no longer awaiting ACK")
			return
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind,source_delivery_id,github_sha) VALUES($1::uuid,$2,$3,$4,$5)`, runID, newState, eventKind, deliveryID, checkpointSHA); err != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_event_failed")
			writeError(w, http.StatusServiceUnavailable, "Codex ACK audit unavailable")
			return
		}
		if _, err = tx.Exec(r.Context(), `UPDATE taskflow.github_webhook_delivery SET processing_state='persisted',mirror_rows=1,linked_issue_rows=1,processed_at=now(),updated_at=now() WHERE delivery_id=$1 AND processing_state='processing'`, deliveryID); err != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_receipt_failed")
			writeError(w, http.StatusServiceUnavailable, "Codex ACK receipt unavailable")
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_ack_commit_failed")
			writeError(w, http.StatusServiceUnavailable, "Codex ACK could not be committed")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "persisted", "run_id": runID, "state": newState, "provider_acknowledged": ack.Status == "accepted"})
		return
	}
	var resultThread, resultDispatch, resultState, resultSHA, summary string
	switch kind {
	case "result":
		resultThread, resultDispatch, resultState, resultSHA, summary = result.ThreadID, result.DispatchID, result.State, result.CommitSHA, result.Summary
	case "failure":
		resultThread, resultDispatch, resultState, resultSHA, summary = failure.ThreadID, failure.DispatchID, "failed", "", failure.Summary
	}
	if !taskflowcontract.ValidCodexThreadID(resultThread) || resultDispatch != dispatchID ||
		!threadID.Valid || resultThread != threadID.String || len(strings.TrimSpace(summary)) == 0 || len(summary) > 4000 {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_identity_invalid")
		writeError(w, http.StatusUnprocessableEntity, "Codex result identity or summary is invalid")
		return
	}
	if resultState != "review_pending" && resultState != "failed" {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_state_invalid")
		writeError(w, http.StatusUnprocessableEntity, "Codex result state is invalid")
		return
	}
	if resultState == "review_pending" {
		if !taskflowcontract.ValidGitHubHeadSHA(resultSHA) {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_sha_invalid")
			writeError(w, http.StatusUnprocessableEntity, "Codex result commit is invalid")
			return
		}
		target := codexDispatchTarget{InstallationID: installID, Owner: payload.Repository.Owner.Login, Repository: payload.Repository.Name, Number: payload.Issue.Number, HeadSHA: checkpointSHA}
		client := codexGitHubClient()
		token, tokenErr := createCodexInstallationToken(r.Context(), client, installID, "read")
		if tokenErr != nil {
			h.failTaskflowGitHubDelivery(r, deliveryID, "github_result_verification_unavailable")
			writeError(w, http.StatusServiceUnavailable, "GitHub result verification unavailable")
			return
		}
		defer revokeGitHubInstallationToken(client, token)
		currentHead, headErr := readCodexTargetHead(r.Context(), client, token, target)
		if headErr != nil || currentHead != resultSHA {
			h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_head_not_verified")
			writeError(w, http.StatusConflict, "Codex result commit is not the current open PR head")
			return
		}
	}
	newState, eventKind := "review_pending", "review"
	if resultState == "failed" {
		newState, eventKind = "failed", "failed"
	}
	tx, beginErr := h.TxStarter.Begin(r.Context())
	if beginErr != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_tx_unavailable")
		writeError(w, http.StatusServiceUnavailable, "Codex result transaction unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var updatedRun string
	err = tx.QueryRow(r.Context(), `
	UPDATE taskflow.zhuge_ai_engineering_run SET state=$4,last_evidence_sha=NULLIF($5,'')::text,
	 result_summary=$6,provider_receipt_id=$7,last_error_code=CASE WHEN $4='failed' THEN 'codex_run_failed' ELSE NULL END,
	 revision=revision+1,updated_at=now()
	WHERE id=$1::uuid AND provider_dispatch_id=$2::uuid AND provider_thread_id=$3
	 AND state='running' RETURNING id::text`, runID, resultDispatch, resultThread, newState, resultSHA, summary, strconv.FormatInt(payload.Comment.ID, 10)).Scan(&updatedRun)
	if err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_state_conflict")
		writeError(w, http.StatusConflict, "Codex result arrived for a Run that is not active")
		return
	}
	var githubSHA any
	if newState == "review_pending" {
		githubSHA = resultSHA
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind,source_delivery_id,github_sha) VALUES($1::uuid,$2,$3,$4,$5)`, runID, newState, eventKind, deliveryID, githubSHA); err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_event_failed")
		writeError(w, http.StatusServiceUnavailable, "Codex result audit unavailable")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE taskflow.github_webhook_delivery SET processing_state='persisted',mirror_rows=1,linked_issue_rows=1,processed_at=now(),updated_at=now() WHERE delivery_id=$1 AND processing_state='processing'`, deliveryID); err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_receipt_failed")
		writeError(w, http.StatusServiceUnavailable, "Codex result receipt unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		h.failTaskflowGitHubDelivery(r, deliveryID, "codex_result_commit_failed")
		writeError(w, http.StatusServiceUnavailable, "Codex result could not be committed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"delivery_id": deliveryID, "receipt": "persisted", "run_id": runID, "state": newState, "provider_acknowledged": true})
}

func (h *Handler) finishCodexCommentPersisted(r *http.Request, deliveryID string) {
	_, _ = h.DB.Exec(r.Context(), `UPDATE taskflow.github_webhook_delivery SET processing_state='persisted',mirror_rows=1,linked_issue_rows=1,processed_at=now(),updated_at=now() WHERE delivery_id=$1 AND processing_state='processing'`, deliveryID)
}
