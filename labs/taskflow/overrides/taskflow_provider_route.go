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

// ProviderConversationRouteResolver is the only seam for an official
// provider/session binding. The default implementation is intentionally
// unbound until an official API and attestation are available.
type ProviderConversationRouteResolver interface {
    Resolve(context.Context, string, string, string) (ProviderRouteResolution, error)
}

type unboundProviderConversationRouteResolver struct{}

func (unboundProviderConversationRouteResolver) Resolve(context.Context, string, string, string) (ProviderRouteResolution, error) {
    return ProviderRouteResolution{
        Status: ProviderRouteUnverified,
        Reason: ProviderDeliveryManual,
    }, ErrTaskFlowProviderUnavailable
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


type ProviderDispatchCorrelationResolver interface {
    Resolve(context.Context, string, string, string) (ProviderDispatchCorrelation, error)
}

type unboundProviderDispatchCorrelationResolver struct{}

func (unboundProviderDispatchCorrelationResolver) Resolve(context.Context, string, string, string) (ProviderDispatchCorrelation, error) {
    return ProviderDispatchCorrelation{}, ErrTaskFlowProviderUnavailable
}

var taskflowProviderDispatchCorrelationResolver ProviderDispatchCorrelationResolver = unboundProviderDispatchCorrelationResolver{}

func resolveProviderDispatchCorrelation(ctx context.Context, dispatchID, workspaceID, issueID string) (ProviderDispatchCorrelation, error) {
    correlation, err := taskflowProviderDispatchCorrelationResolver.Resolve(ctx, dispatchID, workspaceID, issueID)
    if err != nil || correlation.DispatchID != dispatchID || correlation.FencingEpoch <= 0 || correlation.LeaseID == "" {
        return ProviderDispatchCorrelation{}, ErrTaskFlowProviderUnavailable
    }
    return correlation, nil
}
