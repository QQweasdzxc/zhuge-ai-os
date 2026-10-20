package handler

import "testing"

func TestParseCTODispatchMutationRequest(t *testing.T) {
	request, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02","provider":"codex","task_id":"task-1"}`))
	if err != nil {
		t.Fatalf("parse valid dispatch request: %v", err)
	}
	if request.Executor != "CO-02" || request.Provider != "codex" || request.TaskID != "task-1" {
		t.Fatalf("unexpected request: %+v", request)
	}
}

func TestParseCTODispatchMutationRequestRejectsClientAuthorityFields(t *testing.T) {
	if _, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02","provider":"codex","cto_user_id":"forged"}`)); err == nil {
		t.Fatal("expected client authority field to be rejected")
	}
}

func TestParseCTODispatchMutationRequestRequiresExecutorAndProvider(t *testing.T) {
	if _, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02"}`)); err == nil {
		t.Fatal("expected missing provider to be rejected")
	}
	if _, err := parseCTODispatchMutationRequest([]byte(`{"provider":"codex"}`)); err == nil {
		t.Fatal("expected missing executor to be rejected")
	}
}

func TestCTODispatchMutationHTTPErrorFailsClosedWithoutAuthority(t *testing.T) {
	status, _ := ctoDispatchMutationHTTPError(ErrCTODispatchAuthorityUnavailable)
	if status != 503 {
		t.Fatalf("status = %d, want 503", status)
	}
}
