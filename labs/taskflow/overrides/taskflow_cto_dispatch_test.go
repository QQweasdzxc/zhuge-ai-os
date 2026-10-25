package handler

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestParseCTODispatchMutationRequest(t *testing.T) {
	request, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02","provider":"codex"}`))
	if err != nil {
		t.Fatalf("parse valid dispatch request: %v", err)
	}
	if request.Executor != "CO-02" || request.Provider != "codex" {
		t.Fatalf("unexpected request: %+v", request)
	}
}

func TestParseCTODispatchMutationRequestRejectsClientSelectedTaskContext(t *testing.T) {
	if _, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02","provider":"codex","task_id":"unverified"}`)); err == nil {
		t.Fatal("client-selected Task ID must not be forwarded without native task/workspace verification")
	}
}

func TestParseCTODispatchMutationRequestRejectsClientAuthorityFields(t *testing.T) {
	if _, err := parseCTODispatchMutationRequest([]byte(`{"executor_id":"CO-02","provider":"codex","cto_user_id":"forged"}`)); err == nil {
		t.Fatal("expected client authority field to be rejected")
	}
}

func TestParseCTODispatchMutationRequestRejectsAllClientAuthorityProjections(t *testing.T) {
	for _, field := range []string{
		"authority_result", "authorization", "workspace_id", "role", "provider_run_id", "cto_user_id",
	} {
		body := []byte(`{"executor_id":"CO-02","provider":"codex","` + field + `":"forged"}`)
		if _, err := parseCTODispatchMutationRequest(body); err == nil {
			t.Fatalf("expected client authority field %q to be rejected", field)
		}
	}
}

func TestParseCTODispatchMutationRequestRejectsDuplicateJSONValues(t *testing.T) {
	body := []byte(`{"executor_id":"CO-02","provider":"codex"}{"executor_id":"CO-02","provider":"codex"}`)
	if _, err := parseCTODispatchMutationRequest(body); err == nil {
		t.Fatal("expected duplicate JSON values to be rejected")
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

func TestDispatchIdempotencyKeyRequiresOneBoundedHeaderValue(t *testing.T) {
	request, _ := http.NewRequest(http.MethodPost, "/", nil)
	if _, err := dispatchIdempotencyKey(request); err == nil {
		t.Fatal("missing Idempotency-Key was accepted")
	}
	request.Header.Set("Idempotency-Key", " retry-123 ")
	if got, err := dispatchIdempotencyKey(request); err != nil || got != "retry-123" {
		t.Fatalf("key=%q error=%v", got, err)
	}
	request.Header.Add("Idempotency-Key", "second")
	if _, err := dispatchIdempotencyKey(request); err == nil {
		t.Fatal("duplicate Idempotency-Key values were accepted")
	}
}

func TestNativeDispatchRequiresUniqueVerifiedExecutorProjectForIssue(t *testing.T) {
	verified := zhugeNativeProjectMapping{
		ExecutorID: "CO-01", State: "VERIFIED", ProjectID: "project-1",
		WorkspaceID: "workspace-1", ProjectAccess: "ALLOW", agentID: pgtype.UUID{Valid: true},
	}
	if !nativeDispatchProjectMatchesIssue([]zhugeNativeProjectMapping{verified}, "CO-01", "workspace-1", "project-1") {
		t.Fatal("matching verified native executor Project was rejected")
	}
	for name, mappings := range map[string][]zhugeNativeProjectMapping{
		"missing mapping":            {},
		"unverified mapping":         {func() zhugeNativeProjectMapping { item := verified; item.State = "GAP"; return item }()},
		"cross-workspace mapping":    {func() zhugeNativeProjectMapping { item := verified; item.WorkspaceID = "workspace-2"; return item }()},
		"different native Project":   {func() zhugeNativeProjectMapping { item := verified; item.ProjectID = "project-2"; return item }()},
		"denied Project ACL":         {func() zhugeNativeProjectMapping { item := verified; item.ProjectAccess = "DENY"; return item }()},
		"missing native Agent":       {func() zhugeNativeProjectMapping { item := verified; item.agentID = pgtype.UUID{}; return item }()},
		"duplicate executor mapping": {verified, verified},
	} {
		t.Run(name, func(t *testing.T) {
			if nativeDispatchProjectMatchesIssue(mappings, "CO-01", "workspace-1", "project-1") {
				t.Fatal("invalid native Project mapping was accepted")
			}
		})
	}
}
