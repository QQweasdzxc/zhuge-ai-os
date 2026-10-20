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

func TestAuthorizeCTODispatchRequestFailsClosedForMissingOrForgedAuthenticatedContext(t *testing.T) {
	base := CTODispatchRequest{
		AuthenticatedUserID:      "cto-user",
		ConfiguredCTOUserIDs:     []string{"cto-user"},
		AuthenticatedWorkspaceID: "workspace-a",
		RequestedWorkspaceID:     "workspace-a",
		ExecutorID:               "CO-02",
		Provider:                 "codex",
	}
	cases := []struct {
		name string
		mutate func(*CTODispatchRequest)
		want error
	}{
		{name: "missing authenticated user", mutate: func(req *CTODispatchRequest) { req.AuthenticatedUserID = "" }, want: ErrCTODispatchAuthorityUnavailable},
		{name: "allowlist whitespace only", mutate: func(req *CTODispatchRequest) { req.ConfiguredCTOUserIDs = []string{" ", ""} }, want: ErrCTODispatchAuthorityUnavailable},
		{name: "case changed identity", mutate: func(req *CTODispatchRequest) { req.AuthenticatedUserID = "CTO-USER" }, want: ErrCTODispatchUnauthorized},
		{name: "missing authenticated workspace", mutate: func(req *CTODispatchRequest) { req.AuthenticatedWorkspaceID = "" }, want: ErrCTODispatchWorkspaceMismatch},
		{name: "missing requested workspace", mutate: func(req *CTODispatchRequest) { req.RequestedWorkspaceID = "" }, want: ErrCTODispatchWorkspaceMismatch},
		{name: "provider label cannot authorize unknown executor", mutate: func(req *CTODispatchRequest) { req.ExecutorID = "CO-99"; req.Provider = "codex" }, want: ErrCTODispatchExecutorUnknown},
		{name: "provider cannot be upgraded by label", mutate: func(req *CTODispatchRequest) { req.ExecutorID = "GEM-01"; req.Provider = "codex" }, want: ErrCTODispatchProviderMismatch},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := base
			tc.mutate(&req)
			if err := AuthorizeCTODispatchRequest(req); !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestTaskFlowDispatchExecutorRegistryProviderPairsAreStable(t *testing.T) {
	want := map[string]string{
		"CO-01":     "codex",
		"CO-02":     "codex",
		"CO-03":     "codex",
		"GEM-01":    "gemini",
		"GH-HELPER": "github",
	}
	for executor, provider := range want {
		if got := TaskFlowDispatchExecutors[executor]; got != provider {
			t.Fatalf("executor %s provider = %q, want %q", executor, got, provider)
		}
	}
}
