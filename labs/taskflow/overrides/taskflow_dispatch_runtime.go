package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// These values deliberately mirror the TaskFlow-owned runtime read-model
// contract.  The endpoint below only projects native, server-read data into
// that shape; it never accepts a runtime object from the request.
const (
	taskflowRuntimeReadbackSchema = "zhuge-taskflow-dispatch-persistence-v1"
	taskflowRuntimeReadbackSource = "TASKFLOW_RUNTIME_READ_MODEL"
)

type taskflowDispatchRuntimeEvidence struct {
	ProviderAck       string `json:"provider_ack"`
	ProviderRunIDSource string `json:"provider_run_id_source"`
	GithubShaSource   string `json:"github_sha_source"`
	BlockedReason     string `json:"blocked_reason,omitempty"`
}

type taskflowDispatchRuntimeModel struct {
	Schema             string                              `json:"schema"`
	IntentID           string                              `json:"intent_id"`
	IdempotencyKey     string                              `json:"idempotency_key"`
	IssuerUserID       string                              `json:"issuer_user_id"`
	Workspace          string                              `json:"workspace"`
	IssueID            string                              `json:"issue_id"`
	WorkCode           string                              `json:"work_code"`
	ExecutorID         string                              `json:"executor_id"`
	Provider           string                              `json:"provider"`
	State              string                              `json:"state"`
	StatusSource       string                              `json:"status_source"`
	Authorization      string                              `json:"authorization"`
	TaskID             *string                             `json:"task_id,omitempty"`
	ProviderRunID      *string                             `json:"provider_run_id,omitempty"`
	ProviderRunIDSource string                             `json:"provider_run_id_source"`
	WriterID           *string                             `json:"writer_id,omitempty"`
	FencingEpoch       int64                               `json:"fencing_epoch"`
	LeaseActive        bool                                `json:"lease_active"`
	LeaseExpiresAt     *string                             `json:"lease_expires_at,omitempty"`
	CheckpointRef      *string                             `json:"checkpoint_ref,omitempty"`
	LastHeartbeatAt    *string                             `json:"last_heartbeat_at,omitempty"`
	ObservedAt         string                              `json:"observed_at"`
	QuotaState         string                              `json:"quota_state"`
	Version            int                                 `json:"version"`
	Error              string                              `json:"error,omitempty"`
	NativeTaskStatus   string                              `json:"native_task_status,omitempty"`
	Evidence           taskflowDispatchRuntimeEvidence      `json:"evidence"`
}

type taskflowDispatchRuntimeResponse struct {
	Runtime        taskflowDispatchRuntimeModel `json:"runtime"`
	ReadbackKind   string                       `json:"readback_kind"`
	ProviderBinding string                      `json:"provider_binding"`
	Available      bool                         `json:"available"`
}

// taskflowNativeRuntimeState intentionally does not map native "running" to
// RUNNING.  A native TaskFlow queue row is useful readback, but it is not an
// official Provider ACK/run event.  The frontend can therefore show DONE,
// FAILED, CANCELLED or ACK_PENDING from durable TaskFlow state while active
// work remains UNKNOWN until an authenticated Provider event/native readback
// is available.
func taskflowNativeRuntimeState(status string) (state, reason string) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "done", "success":
		return "DONE", ""
	case "failed", "error":
		return "FAILED", ""
	case "cancelled", "canceled":
		return "CANCELLED", ""
	case "queued", "deferred", "dispatched":
		return "ACK_PENDING", "TaskFlow has a durable task, but Provider ACK is not verified"
	case "running", "waiting_local_directory", "in_progress":
		return "UNKNOWN", "PROVIDER_RUNTIME_NOT_BOUND"
	default:
		return "UNKNOWN", "RUNTIME_READBACK_NOT_BOUND"
	}
}

func taskflowNativeIssueWorkCode(issue db.Issue) string {
	// This is a stable native readback label, not a Provider work code or Run
	// ID.  It keeps the response schema useful without trusting mutable issue
	// metadata.
	return "TF-" + strconv.FormatInt(int64(issue.Number), 10)
}

func taskflowNativeTaskID(tasks []db.AgentTaskQueue) *string {
	if len(tasks) == 0 || !tasks[0].ID.Valid {
		return nil
	}
	id := uuidToString(tasks[0].ID)
	if id == "" {
		return nil
	}
	return &id
}

func taskflowNativeTaskError(task db.AgentTaskQueue) string {
	if task.Error.Valid {
		return strings.TrimSpace(task.Error.String)
	}
	if task.FailureReason.Valid {
		return strings.TrimSpace(task.FailureReason.String)
	}
	return ""
}

func buildTaskflowNativeRuntime(issue db.Issue, userID string, tasks []db.AgentTaskQueue, observedAt time.Time) taskflowDispatchRuntimeResponse {
	state, reason := taskflowNativeRuntimeState("")
	var taskStatus string
	var taskID *string
	var taskError string
	if len(tasks) > 0 {
		taskStatus = strings.TrimSpace(tasks[0].Status)
		state, reason = taskflowNativeRuntimeState(taskStatus)
		taskID = taskflowNativeTaskID(tasks)
		taskError = taskflowNativeTaskError(tasks[0])
	}
	if taskError != "" {
		reason = taskError
	}
	issueID := uuidToString(issue.ID)
	workspaceID := uuidToString(issue.WorkspaceID)
	return taskflowDispatchRuntimeResponse{
		Runtime: taskflowDispatchRuntimeModel{
			Schema:              taskflowRuntimeReadbackSchema,
			IntentID:            "native:issue:" + issueID,
			IdempotencyKey:      "native:issue:" + issueID,
			IssuerUserID:        userID,
			Workspace:           workspaceID,
			IssueID:             issueID,
			WorkCode:            taskflowNativeIssueWorkCode(issue),
			ExecutorID:          "UNVERIFIED",
			Provider:            "UNVERIFIED",
			State:               state,
			StatusSource:        taskflowRuntimeReadbackSource,
			Authorization:       "UNVERIFIED",
			TaskID:              taskID,
			ProviderRunIDSource: "NOT_AVAILABLE",
			FencingEpoch:        0,
			LeaseActive:         false,
			ObservedAt:          observedAt.UTC().Format(time.RFC3339Nano),
			QuotaState:          "UNKNOWN",
			Version:             1,
			Error:               taskError,
			NativeTaskStatus:    taskStatus,
			Evidence: taskflowDispatchRuntimeEvidence{
				ProviderAck:         "UNVERIFIED",
				ProviderRunIDSource: "NOT_AVAILABLE",
				GithubShaSource:     "NOT_AVAILABLE",
				BlockedReason:       reason,
			},
		},
		ReadbackKind:    "NATIVE_TASK_READBACK",
		ProviderBinding: "NOT_BOUND",
		Available:       true,
	}
}

// GetDispatchRuntime is a read-only, authenticated Runtime Readback boundary.
// loadIssueForUser enforces the native session, workspace selection and issue
// access before any task rows are read.  No request field can supply authority,
// ACK, a Provider Run ID, or a VERIFIED marker.
func (h *Handler) GetDispatchRuntime(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	tasks, err := h.Queries.ListTasksByIssue(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read TaskFlow runtime")
		return
	}
	response := buildTaskflowNativeRuntime(issue, userID, tasks, time.Now())
	writeJSON(w, http.StatusOK, response)
}
