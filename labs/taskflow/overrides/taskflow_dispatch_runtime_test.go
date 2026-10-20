package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func testRuntimeIssue() db.Issue {
	return db.Issue{
		ID:          pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		WorkspaceID: pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		Number:      42,
	}
}

func TestTaskFlowNativeRuntimeReadbackFailsClosedWithoutProviderBinding(t *testing.T) {
	state, reason := taskflowNativeRuntimeState("running")
	if state != "UNKNOWN" || reason != "PROVIDER_RUNTIME_NOT_BOUND" {
		t.Fatalf("running native task must remain unverified: state=%q reason=%q", state, reason)
	}
	response := buildTaskflowNativeRuntime(testRuntimeIssue(), "user-1", nil, time.Unix(10, 0))
	if response.Runtime.State != "UNKNOWN" {
		t.Fatalf("empty native readback state=%q, want UNKNOWN", response.Runtime.State)
	}
	if response.Runtime.Authorization != "UNVERIFIED" || response.Runtime.Evidence.ProviderAck != "UNVERIFIED" {
		t.Fatalf("unbound runtime must not claim authorization/ACK: %#v", response.Runtime)
	}
	if response.Runtime.ProviderRunIDSource != "NOT_AVAILABLE" || response.ProviderBinding != "NOT_BOUND" {
		t.Fatalf("unbound provider evidence was exposed: %#v", response)
	}
}

func TestTaskFlowNativeRuntimeReadbackMapsOnlyDurableTerminalState(t *testing.T) {
	issue := testRuntimeIssue()
	task := db.AgentTaskQueue{
		ID:        pgtype.UUID{Bytes: [16]byte{3}, Valid: true},
		IssueID:   issue.ID,
		Status:    "completed",
		CreatedAt: pgtype.Timestamptz{Time: time.Unix(20, 0).UTC(), Valid: true},
	}
	response := buildTaskflowNativeRuntime(issue, "user-1", []db.AgentTaskQueue{task}, time.Unix(30, 0))
	if response.Runtime.State != "DONE" {
		t.Fatalf("terminal native state=%q, want DONE", response.Runtime.State)
	}
	expectedTaskID := uuidToString(task.ID)
	if response.Runtime.TaskID == nil || *response.Runtime.TaskID != expectedTaskID {
		t.Fatalf("native task id missing: %#v", response.Runtime.TaskID)
	}
	if response.Runtime.ProviderRunID != nil || response.Runtime.Evidence.ProviderAck != "UNVERIFIED" {
		t.Fatalf("native task was incorrectly upgraded to provider evidence: %#v", response.Runtime)
	}
}

func TestTaskFlowNativeRuntimeReadbackPreservesFailureDetails(t *testing.T) {
	issue := testRuntimeIssue()
	task := db.AgentTaskQueue{
		ID:     pgtype.UUID{Bytes: [16]byte{4}, Valid: true},
		Status: "failed",
		Error:  pgtype.Text{String: "provider unavailable", Valid: true},
	}
	response := buildTaskflowNativeRuntime(issue, "user-1", []db.AgentTaskQueue{task}, time.Now())
	if response.Runtime.State != "FAILED" || response.Runtime.Error != "provider unavailable" {
		t.Fatalf("failure readback lost durable error: %#v", response.Runtime)
	}
}
