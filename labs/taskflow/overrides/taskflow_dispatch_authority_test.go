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
