package handler

import (
	"errors"
	"testing"
)

func TestAuthorizeCTODispatchFailsClosedWithoutProtectedAuthority(t *testing.T) {
	if !errors.Is(AuthorizeCTODispatch("cto-user", nil), ErrCTODispatchAuthorityUnavailable) {
		t.Fatal("missing CTO authority must fail closed")
	}
	if !errors.Is(AuthorizeCTODispatch("ordinary-user", []string{"cto-user"}), ErrCTODispatchUnauthorized) {
		t.Fatal("non-CTO authenticated user must be denied")
	}
	if err := AuthorizeCTODispatch("cto-user", []string{"cto-user"}); err != nil {
		t.Fatalf("configured CTO user must be authorized: %v", err)
	}
}

func TestTaskFlowDispatchExecutorRegistryIsExplicit(t *testing.T) {
	for _, id := range []string{"CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"} {
		if TaskFlowDispatchExecutors[id] == "" {
			t.Fatalf("missing executor %s", id)
		}
	}
}

func TestParseCTOAllowlistIsDeterministicAndEmptyEntriesFailClosed(t *testing.T) {
	got := ParseCTOAllowlist(" cto-user, ,cto-user, second-user ")
	if len(got) != 2 || got[0] != "cto-user" || got[1] != "second-user" {
		t.Fatalf("unexpected parsed allowlist: %#v", got)
	}
	if err := AuthorizeCTODispatch("cto-user", ParseCTOAllowlist(" , ")); !errors.Is(err, ErrCTODispatchAuthorityUnavailable) {
		t.Fatalf("empty protected allowlist must fail closed: %v", err)
	}
}

func TestAuthorizeCTODispatchRequestBindsWorkspaceExecutorAndProvider(t *testing.T) {
	base := CTODispatchRequest{
		AuthenticatedUserID:      "cto-user",
		ConfiguredCTOUserIDs:     []string{"cto-user"},
		AuthenticatedWorkspaceID: "workspace-a",
		RequestedWorkspaceID:     "workspace-a",
		ExecutorID:               "CO-02",
		Provider:                 "codex",
	}
	if err := AuthorizeCTODispatchRequest(base); err != nil {
		t.Fatalf("valid authenticated dispatch request rejected: %v", err)
	}
	wrongWorkspace := base
	wrongWorkspace.RequestedWorkspaceID = "workspace-b"
	if !errors.Is(AuthorizeCTODispatchRequest(wrongWorkspace), ErrCTODispatchWorkspaceMismatch) {
		t.Fatal("workspace mismatch must be rejected")
	}
	wrongExecutor := base
	wrongExecutor.ExecutorID = "CO-99"
	if !errors.Is(AuthorizeCTODispatchRequest(wrongExecutor), ErrCTODispatchExecutorUnknown) {
		t.Fatal("unknown executor must be rejected")
	}
	wrongProvider := base
	wrongProvider.Provider = "gemini"
	if !errors.Is(AuthorizeCTODispatchRequest(wrongProvider), ErrCTODispatchProviderMismatch) {
		t.Fatal("executor/provider mismatch must be rejected")
	}
}
