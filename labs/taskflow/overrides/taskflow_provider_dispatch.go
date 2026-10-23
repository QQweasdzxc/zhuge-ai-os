package handler

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrTaskFlowProviderUnavailable = errors.New("taskflow provider is not bound")
	ErrTaskFlowProviderAckInvalid  = errors.New("taskflow provider ACK is not verified")
)

type ProviderDispatchCorrelation struct {
	DispatchID   string
	LeaseID      string
	FencingEpoch int64
	ProviderRunID string
	SessionID    string
	AckEventID   string
}

type ProviderConversationRoute struct {
	EngineerID            string
	ProviderAccountPoolID string
	ConversationReference string
	OfficialSessionID     string
	VerificationStatus    string
	WorkspaceScope        string
}

type ProviderDispatchRequest struct {
	IssueID             string
	WorkspaceID         string
	AuthenticatedUserID string
	TaskID              string
	ExecutorID          string
	Provider            string
	DispatchClaim       ProviderDispatchClaim
	Correlation         ProviderDispatchCorrelation
	Route               ProviderConversationRoute
}

func validateProviderDispatchContract(request ProviderDispatchRequest) error {
	if !request.DispatchClaim.Active ||
		strings.TrimSpace(request.DispatchClaim.DispatchID) == "" ||
		strings.TrimSpace(request.DispatchClaim.LeaseID) == "" ||
		request.DispatchClaim.FencingEpoch <= 0 ||
		request.DispatchClaim.DispatchID != request.Correlation.DispatchID ||
		request.DispatchClaim.LeaseID != request.Correlation.LeaseID ||
		request.DispatchClaim.FencingEpoch != request.Correlation.FencingEpoch ||
		request.DispatchClaim.WorkspaceID != request.WorkspaceID ||
		request.DispatchClaim.IssueID != request.IssueID ||
		request.DispatchClaim.ExecutorID != request.ExecutorID ||
		request.DispatchClaim.Provider != request.Provider ||
		strings.TrimSpace(request.Correlation.DispatchID) == "" ||
		strings.TrimSpace(request.Correlation.LeaseID) == "" ||
		request.Correlation.FencingEpoch <= 0 ||
		strings.TrimSpace(request.Route.EngineerID) == "" ||
		strings.TrimSpace(request.Route.ProviderAccountPoolID) == "" ||
		strings.TrimSpace(request.Route.ConversationReference) == "" ||
		strings.TrimSpace(request.Route.OfficialSessionID) == "" ||
		strings.TrimSpace(request.Route.WorkspaceScope) == "" ||
		strings.TrimSpace(request.Route.VerificationStatus) != "VERIFIED" {
		return ErrTaskFlowProviderUnavailable
	}
	if request.Route.EngineerID != request.ExecutorID || request.Route.WorkspaceScope != request.WorkspaceID {
		return ErrTaskFlowProviderUnavailable
	}
	return nil
}

type ProviderDispatchResult struct {
	ProviderRunID string
	AckVerified   bool
}

type TaskFlowProviderDispatcher interface {
	Dispatch(context.Context, ProviderDispatchRequest) (ProviderDispatchResult, error)
}

type unboundTaskFlowProviderDispatcher struct{}

func (unboundTaskFlowProviderDispatcher) Dispatch(context.Context, ProviderDispatchRequest) (ProviderDispatchResult, error) {
	return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
}

var taskflowProviderDispatcher TaskFlowProviderDispatcher = unboundTaskFlowProviderDispatcher{}

func dispatchToProvider(ctx context.Context, request ProviderDispatchRequest) (ProviderDispatchResult, error) {
	if err := validateProviderDispatchContract(request); err != nil {
		return ProviderDispatchResult{}, err
	}
	if strings.TrimSpace(request.IssueID) == "" ||
		strings.TrimSpace(request.WorkspaceID) == "" ||
		strings.TrimSpace(request.AuthenticatedUserID) == "" ||
		strings.TrimSpace(request.ExecutorID) == "" ||
		strings.TrimSpace(request.Provider) == "" {
		return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
	}
	result, err := taskflowProviderDispatcher.Dispatch(ctx, request)
	if err != nil {
		return ProviderDispatchResult{}, err
	}
	if strings.TrimSpace(result.ProviderRunID) == "" || !result.AckVerified {
		return ProviderDispatchResult{}, ErrTaskFlowProviderAckInvalid
	}
	return result, nil
}
