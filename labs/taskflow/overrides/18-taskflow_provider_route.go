package handler

import "context"

// ProviderRouteResolution is server-owned. A client label or GitHub comment
// cannot elevate an unverified conversation into a deliverable route.
type ProviderRouteResolution struct {
	Route  ProviderConversationRoute
	Status string
	Reason string
}

const (
	ProviderRouteVerified   = "VERIFIED"
	ProviderRouteUnverified = "ROUTE_UNVERIFIED"
	ProviderDeliveryManual  = "DELIVERY_MANUAL_REQUIRED"
)

type ProviderConversationRouteResolver interface {
	Resolve(context.Context, string, string, string) (ProviderRouteResolution, error)
}

type unboundProviderConversationRouteResolver struct{}

func (unboundProviderConversationRouteResolver) Resolve(context.Context, string, string, string) (ProviderRouteResolution, error) {
	return ProviderRouteResolution{Status: ProviderRouteUnverified, Reason: ProviderDeliveryManual}, ErrTaskFlowProviderUnavailable
}

var taskflowProviderRouteResolver ProviderConversationRouteResolver = unboundProviderConversationRouteResolver{}

func resolveProviderConversationRoute(ctx context.Context, engineerID, workspaceID, provider string) (ProviderRouteResolution, error) {
	resolution, err := taskflowProviderRouteResolver.Resolve(ctx, engineerID, workspaceID, provider)
	if err != nil || resolution.Status != ProviderRouteVerified {
		return ProviderRouteResolution{Status: ProviderRouteUnverified, Reason: ProviderDeliveryManual}, ErrTaskFlowProviderUnavailable
	}
	if resolution.Route.EngineerID != engineerID || resolution.Route.WorkspaceScope != workspaceID || resolution.Route.VerificationStatus != ProviderRouteVerified {
		return ProviderRouteResolution{Status: ProviderRouteUnverified, Reason: ProviderDeliveryManual}, ErrTaskFlowProviderUnavailable
	}
	return resolution, nil
}

// ProviderDispatchClaim is the server-owned durable authority claim. The
// client cannot supply any of these values. It is read from NativeDispatchAuthority.
type ProviderDispatchClaim struct {
	DispatchID   string
	LeaseID      string
	FencingEpoch int64
	WorkspaceID  string
	IssueID      string
	ExecutorID   string
	Provider     string
	Active       bool
}
