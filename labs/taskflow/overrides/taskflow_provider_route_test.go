package handler

import (
	"context"
	"errors"
	"testing"
)

func TestResolveProviderConversationRouteFailsClosed(t *testing.T) {
	original := taskflowProviderRouteResolver
	taskflowProviderRouteResolver = unboundProviderConversationRouteResolver{}
	t.Cleanup(func() { taskflowProviderRouteResolver = original })
	result, err := resolveProviderConversationRoute(context.Background(), "CO-01", "workspace-1", "codex")
	if !errors.Is(err, ErrTaskFlowProviderUnavailable) || result.Status != ProviderRouteUnverified || result.Reason != ProviderDeliveryManual {
		t.Fatalf("resolution = %#v, error = %v", result, err)
	}
}

type verifiedRouteResolver struct{}

func (verifiedRouteResolver) Resolve(context.Context, string, string, string) (ProviderRouteResolution, error) {
	return ProviderRouteResolution{Status: ProviderRouteVerified, Route: ProviderConversationRoute{
		EngineerID: "CO-01", ProviderAccountPoolID: "codex-account",
		ConversationReference: "conversation-ref", OfficialSessionID: "session-1",
		VerificationStatus: ProviderRouteVerified, WorkspaceScope: "workspace-1",
	}}, nil
}

func TestResolveProviderConversationRouteBindsEngineerAndWorkspace(t *testing.T) {
	original := taskflowProviderRouteResolver
	taskflowProviderRouteResolver = verifiedRouteResolver{}
	t.Cleanup(func() { taskflowProviderRouteResolver = original })
	if _, err := resolveProviderConversationRoute(context.Background(), "CO-01", "workspace-1", "codex"); err != nil {
		t.Fatalf("verified route rejected: %v", err)
	}
	if _, err := resolveProviderConversationRoute(context.Background(), "CO-02", "workspace-1", "codex"); !errors.Is(err, ErrTaskFlowProviderUnavailable) {
		t.Fatalf("wrong engineer accepted: %v", err)
	}
}
