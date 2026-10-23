package handler

import (
	"context"
	"errors"
	"testing"
)

func validProviderDispatchRequest() ProviderDispatchRequest {
	return ProviderDispatchRequest{
		IssueID: "issue-1", WorkspaceID: "workspace-1",
		AuthenticatedUserID: "cto-1", TaskID: "task-1",
		ExecutorID: "CO-01", Provider: "codex",
		DispatchClaim: ProviderDispatchClaim{DispatchID: "dispatch-1", LeaseID: "lease-1", FencingEpoch: 1, WorkspaceID: "workspace-1", IssueID: "issue-1", ExecutorID: "CO-01", Provider: "codex", Active: true},
		Correlation: ProviderDispatchCorrelation{DispatchID: "dispatch-1", LeaseID: "lease-1", FencingEpoch: 1},
		Route: ProviderConversationRoute{
			EngineerID: "CO-01", ProviderAccountPoolID: "codex-account",
			ConversationReference: "conversation-ref", OfficialSessionID: "session-1",
			VerificationStatus: "VERIFIED", WorkspaceScope: "workspace-1",
		},
	}
}

func TestDispatchContractRejectsUnverifiedRouteAndFencing(t *testing.T) {
	request := validProviderDispatchRequest()
	request.Route.VerificationStatus = "UNVERIFIED"
	if _, err := dispatchToProvider(context.Background(), request); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("unverified route error = %v", err)
	}
	request = validProviderDispatchRequest()
	request.Correlation.FencingEpoch = 0
	if _, err := dispatchToProvider(context.Background(), request); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("invalid fencing error = %v", err)
	}
}

func TestDispatchContractRejectsMismatchedOrInactiveClaim(t *testing.T) {
	request := validProviderDispatchRequest()
	request.DispatchClaim.Active = false
	if _, err := dispatchToProvider(context.Background(), request); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("inactive claim error = %v", err)
	}
	request = validProviderDispatchRequest()
	request.DispatchClaim.IssueID = "other-issue"
	if _, err := dispatchToProvider(context.Background(), request); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("mismatched claim error = %v", err)
	}
	request = validProviderDispatchRequest()
	request.DispatchClaim.FencingEpoch = 2
	if _, err := dispatchToProvider(context.Background(), request); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("stale claim error = %v", err)
	}
}

type testProviderDispatcher struct {
	result ProviderDispatchResult
	err    error
	got    ProviderDispatchRequest
}

func (d *testProviderDispatcher) Dispatch(_ context.Context, request ProviderDispatchRequest) (ProviderDispatchResult, error) {
	d.got = request
	return d.result, d.err
}

func TestDispatchToProviderFailsClosedUntilOfficialBinding(t *testing.T) {
	original := taskflowProviderDispatcher
	taskflowProviderDispatcher = unboundTaskFlowProviderDispatcher{}
	t.Cleanup(func() { taskflowProviderDispatcher = original })

	_, err := dispatchToProvider(context.Background(), ProviderDispatchRequest{
		IssueID: "issue-1", WorkspaceID: "workspace-1",
		AuthenticatedUserID: "cto-1", ExecutorID: "CO-01", Provider: "codex",
	})
	if !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("error = %v, want provider unavailable", err)
	}
}

func TestDispatchToProviderRequiresVerifiedRunAndAck(t *testing.T) {
	original := taskflowProviderDispatcher
	t.Cleanup(func() { taskflowProviderDispatcher = original })

	for _, result := range []ProviderDispatchResult{
		{ProviderRunID: "", AckVerified: true},
		{ProviderRunID: "run-1", AckVerified: false},
	} {
		taskflowProviderDispatcher = &testProviderDispatcher{result: result}
		_, err := dispatchToProvider(context.Background(), validProviderDispatchRequest())
		if !errors.Is(err, ErrTaskFlowProviderAckInvalid) {
			t.Fatalf("result %#v produced %v, want invalid ACK", result, err)
		}
	}
}

func TestDispatchToProviderForwardsOnlyServerResolvedContext(t *testing.T) {
	original := taskflowProviderDispatcher
	taskflowProviderDispatcher = &testProviderDispatcher{result: ProviderDispatchResult{ProviderRunID: "run-1", AckVerified: true}}
	t.Cleanup(func() { taskflowProviderDispatcher = original })

	result, err := dispatchToProvider(context.Background(), validProviderDispatchRequest())
	if err != nil || result.ProviderRunID != "run-1" {
		t.Fatalf("dispatch result = %#v, error = %v", result, err)
	}
}
