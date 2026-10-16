package handler

// Zhuge AI TaskFlow-native approval/readback: the authenticated native issue
// and workspace member remain the ONLY business authorities. No provider calls.
// Approval != Codex ACK != TaskFlow RUNNING. The cloud dispatcher is separately
// gated until verified durable CAS, GitHub SHA and provider identity exist.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/handler/taskflowcontract"
)

const zhugeAIRepo = "QQweasdzxc/zhuge-ai-os"

// The server ignores client-supplied user, role, workspace, Run state, cost
// allowance, provider receipt or worker stop claims. Those never appear here.
type zhugeAIApproveRequest struct {
	ExpectedRevision int64  `json:"expected_issue_revision"`
	IdempotencyKey   string `json:"idempotency_key"`
}

type zhugeAIRunListItem struct {
	ID                string         `json:"id"`
	TaskIdentifier    string         `json:"task_identifier"`
	Engineer          string         `json:"engineer"`
	State             string         `json:"state"`
	GithubPR          *int32         `json:"github_pr"`
	GithubPRState     *string        `json:"github_pr_state"`
	GithubChecksState *string        `json:"github_checks_state"`
	GithubHeadSHA     *string        `json:"github_head_sha"`
	GithubSnapshotSHA *string        `json:"github_snapshot_head_sha"`
	GithubSnapshotAt  *time.Time     `json:"github_snapshot_fetched_at"`
	CreatedAt         time.Time      `json:"created_at"`
	ApprovalExpiresAt time.Time      `json:"approval_expires_at"`
	ProviderThreadID  *string        `json:"provider_thread_id"`
	EvidenceSHA       *string        `json:"last_evidence_sha"`
	Revision          int64          `json:"revision"`
	Events            []zhugeAIEvent `json:"events"`
}

type zhugeAIEvent struct {
	RunID     string    `json:"run_id"`
	Kind      string    `json:"kind"`
	State     string    `json:"state"`
	GitHubSHA *string   `json:"github_sha"`
	CreatedAt time.Time `json:"created_at"`
}

func validateZhugeAIApprove(req zhugeAIApproveRequest, revision int64) string {
	if !taskflowcontract.ValidApproval(req.ExpectedRevision, revision, req.IdempotencyKey) {
		if revision <= 0 || req.ExpectedRevision != revision {
			return "stale or invalid native issue revision"
		}
		return "random 128-bit idempotency key required"
	}
	return ""
}

// Only an authenticated TaskFlow member can read the official Run history.
// This is not a shadow TaskFlow issue and does not show a fabricated Cloud Run.
func (h *Handler) ZhugeAIListRuns(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "AI Run authority not configured")
		return
	}
	rows, err := h.DB.Query(r.Context(),
		"SELECT r.id::text,r.task_identifier,r.engineer,"+
			"CASE WHEN r.state='approved' AND r.approval_expires_at<=now() THEN 'expired' ELSE r.state END,"+
			"pr.pr_number,pr.state,pr.checks_rollup_state,pr.head_sha,pr.snapshot_head_sha,pr.snapshot_fetched_at,"+
			"r.created_at,r.approval_expires_at,r.provider_thread_id,r.last_evidence_sha,r.revision "+
			"FROM taskflow.zhuge_ai_engineering_run r "+
			"LEFT JOIN LATERAL (SELECT ghpr.pr_number,ghpr.state,ghpr.checks_rollup_state,ghpr.head_sha,"+
			"ghpr.snapshot_head_sha,ghpr.snapshot_fetched_at FROM taskflow.issue_pull_request ipr "+
			"JOIN taskflow.github_pull_request ghpr ON ghpr.id=ipr.pull_request_id "+
			"WHERE ipr.issue_id=r.issue_id AND ghpr.workspace_id=r.workspace_id "+
			"AND ghpr.repo_owner=$3 AND ghpr.repo_name=$4 "+
			"ORDER BY ghpr.pr_updated_at DESC,ghpr.pr_number DESC LIMIT 1) pr ON TRUE "+
			"WHERE r.workspace_id=$1::uuid AND r.issue_id=$2::uuid "+
			"ORDER BY r.created_at DESC,r.id DESC LIMIT 20",
		uuidToString(issue.WorkspaceID), uuidToString(issue.ID), "QQweasdzxc", "zhuge-ai-os")
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "AI Run authority not configured")
		return
	}
	items := make([]zhugeAIRunListItem, 0, 8)
	byID := make(map[string]int, 8)
	for rows.Next() {
		var x zhugeAIRunListItem
		var pr pgtype.Int4
		var prState, checksState, headSHA, snapshotSHA pgtype.Text
		var snapshotFetchedAt pgtype.Timestamptz
		if err := rows.Scan(&x.ID, &x.TaskIdentifier, &x.Engineer, &x.State, &pr,
			&prState, &checksState, &headSHA, &snapshotSHA, &snapshotFetchedAt,
			&x.CreatedAt, &x.ApprovalExpiresAt, &x.ProviderThreadID, &x.EvidenceSHA, &x.Revision); err != nil {
			writeError(w, http.StatusServiceUnavailable, "AI Run readback unavailable")
			return
		}
		if pr.Valid {
			n := pr.Int32
			x.GithubPR = &n
		}
		if prState.Valid {
			x.GithubPRState = &prState.String
		}
		if checksState.Valid {
			x.GithubChecksState = &checksState.String
		}
		if headSHA.Valid {
			x.GithubHeadSHA = &headSHA.String
		}
		if snapshotSHA.Valid {
			x.GithubSnapshotSHA = &snapshotSHA.String
		}
		if snapshotFetchedAt.Valid {
			x.GithubSnapshotAt = &snapshotFetchedAt.Time
		}
		x.Events = make([]zhugeAIEvent, 0)
		byID[x.ID] = len(items)
		items = append(items, x)
	}
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		writeError(w, http.StatusServiceUnavailable, "AI Run readback unavailable")
		return
	}
	events, err := h.DB.Query(r.Context(),
		"SELECT e.run_id::text,e.event_kind,e.state,e.github_sha,e.created_at "+
			"FROM taskflow.zhuge_ai_engineering_event e "+
			"JOIN taskflow.zhuge_ai_engineering_run run ON run.id=e.run_id "+
			"WHERE run.workspace_id=$1::uuid AND run.issue_id=$2::uuid "+
			"ORDER BY e.id DESC LIMIT 200", uuidToString(issue.WorkspaceID), uuidToString(issue.ID))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "AI Run event history unavailable")
		return
	}
	defer events.Close()
	for events.Next() {
		var event zhugeAIEvent
		if err := events.Scan(&event.RunID, &event.Kind, &event.State, &event.GitHubSHA, &event.CreatedAt); err != nil {
			writeError(w, http.StatusServiceUnavailable, "AI Run event history unavailable")
			return
		}
		if index, ok := byID[event.RunID]; ok {
			items[index].Events = append(items[index].Events, event)
		}
	}
	if events.Err() != nil {
		writeError(w, http.StatusServiceUnavailable, "AI Run event history unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	writeJSON(w, http.StatusOK, map[string]any{"runs": items, "dispatch_enabled": false,
		"message": "Run evidence is authoritative only after verified provider receipt"})
}

// PM may create one short-lived, idempotent Run intent for one native TaskFlow
// issue. No GitHub comment, Codex task, chargeable provider, or Run launch is
// created by this endpoint.
func (h *Handler) ZhugeAIApproveRun(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("ZHUGE_TASKFLOW_AI_APPROVALS_ENABLED") != "true" {
		writeError(w, http.StatusServiceUnavailable, "AI approval authority is not configured")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	workspaceID := uuidToString(issue.WorkspaceID)
	if _, ok = h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner"); !ok {
		return
	}
	if !issue.ProjectID.Valid || issue.Number <= 0 {
		writeError(w, http.StatusConflict, "project-linked TaskFlow issue required")
		return
	}
	// Fail closed for terminal/blocked/missing and arbitrary custom status keys.
	if !taskflowcontract.StatusEligible(issue.Status) {
		writeError(w, http.StatusConflict, "issue status not eligible for dispatch approval")
		return
	}
	workspace, workspaceErr := h.Queries.GetWorkspace(r.Context(), issue.WorkspaceID)
	if workspaceErr != nil {
		writeError(w, http.StatusServiceUnavailable, "TaskFlow identifier unavailable")
		return
	}
	taskIdentifier := fmt.Sprintf("%s-%d", issuePrefixForWorkspace(workspace), issue.Number)
	if taskflowcontract.ClosingMarker(taskIdentifier) == "" {
		writeError(w, http.StatusServiceUnavailable, "TaskFlow identifier is invalid")
		return
	}
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "AI approval database unavailable")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req zhugeAIApproveRequest
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid AI approval request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid or oversized AI approval request")
		return
	}
	if why := validateZhugeAIApprove(req, issue.Revision); why != "" {
		writeError(w, http.StatusBadRequest, why)
		return
	}
	// The supplied revision is rechecked INSIDE the SQL statement, closing
	// the gap between the native read and the approval write.
	userID := requestUserID(r)
	// Approval and immutable first audit event must commit atomically; never
	// leave an active approval without its first PM-authenticated evidence.
	if h.TxStarter == nil {
		writeError(w, http.StatusServiceUnavailable, "AI approval transaction unavailable")
		return
	}
	tx, beginErr := h.TxStarter.Begin(r.Context())
	if beginErr != nil {
		writeError(w, http.StatusServiceUnavailable, "AI approval transaction unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	// Expire stale approvals inside the same transaction before claiming the
	// one-active-Run-per-issue slot. The append-only event preserves why the
	// previous writer intent stopped blocking a new PM approval.
	_, expireErr := tx.Exec(r.Context(), `
	WITH expired AS (
	 UPDATE taskflow.zhuge_ai_engineering_run
	 SET state='expired',revision=revision+1,updated_at=now()
	 WHERE workspace_id=$1::uuid AND issue_id=$2::uuid
	   AND state='approved' AND approval_expires_at<=now()
	 RETURNING id
	)
	INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind)
	SELECT id,'expired','approval_expired' FROM expired
	`, workspaceID, uuidToString(issue.ID))
	if expireErr != nil {
		writeError(w, http.StatusServiceUnavailable, "expired AI approval could not be settled")
		return
	}
	var id string
	err := tx.QueryRow(r.Context(), `
 INSERT INTO taskflow.zhuge_ai_engineering_run
 (workspace_id,issue_id,project_id,task_identifier,requested_by,engineer,issue_revision,
 github_repo,idempotency_key,state,approval_expires_at)
 SELECT i.workspace_id,i.id,i.project_id,$4,$5::uuid,'co',i.revision,
 $6,$7,'approved',now()+interval '5 minutes'
 FROM taskflow.issue i
		WHERE i.id=$1::uuid AND i.workspace_id=$2::uuid AND
		       i.project_id=$3::uuid AND i.revision=$8::bigint AND
		       EXISTS (SELECT 1 FROM taskflow.project p WHERE p.id=i.project_id AND p.workspace_id=i.workspace_id) AND
		       i.status = ANY(ARRAY['backlog','todo','in_progress','in_review','unstarted','started']::text[])
 ON CONFLICT (workspace_id,issue_id,requested_by,idempotency_key) DO NOTHING
 RETURNING id::text
 `, uuidToString(issue.ID), workspaceID, uuidToString(issue.ProjectID), taskIdentifier, userID,
		zhugeAIRepo, req.IdempotencyKey, req.ExpectedRevision).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotency replay is allowed only for the same native issue revision.
		var previous struct {
			ID, TaskIdentifier, Engineer, State string
			IssueRevision                       int64
		}
		same := tx.QueryRow(r.Context(), `
    SELECT id::text,task_identifier,engineer,state,issue_revision
    FROM taskflow.zhuge_ai_engineering_run
    WHERE workspace_id=$1::uuid AND issue_id=$2::uuid AND requested_by=$3::uuid
      AND idempotency_key=$4
   `, workspaceID, uuidToString(issue.ID), userID, req.IdempotencyKey).Scan(
			&previous.ID, &previous.TaskIdentifier, &previous.Engineer, &previous.State, &previous.IssueRevision)
		if same == nil && previous.TaskIdentifier == taskIdentifier &&
			previous.Engineer == "co" && previous.IssueRevision == req.ExpectedRevision {
			if err := tx.Commit(r.Context()); err != nil {
				writeError(w, http.StatusServiceUnavailable, "AI approval replay could not be read")
				return
			}
			w.Header().Set("Cache-Control", "no-store, private")
			writeJSON(w, http.StatusOK, map[string]any{"id": previous.ID, "state": previous.State,
				"taskflow_identifier": taskIdentifier, "dispatch_started": false, "idempotent_replay": true,
				"pull_request_link_instruction": taskflowcontract.ClosingMarker(taskIdentifier)})
			return
		}
		writeError(w, http.StatusConflict, "stale native revision or conflicting approval")
		return
	}
	if err != nil {
		var pgerr *pgconn.PgError
		if errors.As(err, &pgerr) && pgerr.Code == "23505" {
			writeError(w, http.StatusConflict, "another active AI run approval exists")
			return
		}
		writeError(w, http.StatusServiceUnavailable, "AI approval authority unavailable")
		return
	}
	// Append-only audit; keep the approval and first event atomic. If the event
	// write fails, the deferred rollback removes the uncommitted Run as well.
	_, auditErr := tx.Exec(r.Context(), `
 INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind)
 VALUES($1::uuid,'approved','pm_approved')
 `, id)
	if auditErr != nil {
		writeError(w, http.StatusServiceUnavailable, "AI approval audit unavailable")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "AI approval transaction could not be committed")
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "taskflow_identifier": taskIdentifier, "state": "approved", "dispatch_started": false,
		"provider_status":               "not_configured",
		"pull_request_link_instruction": taskflowcontract.ClosingMarker(taskIdentifier),
		"message":                       "PM approval recorded; no Codex task was launched"})
}
