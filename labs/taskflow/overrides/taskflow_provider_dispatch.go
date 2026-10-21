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

// ProviderDispatchRequest is the only input a future official provider adapter
// receives. Identity and workspace are resolved by the protected handler; no
// client-supplied authorization or ACK fields are accepted.
type ProviderDispatchRequest struct {
    IssueID       string
    WorkspaceID   string
    AuthenticatedUserID string
    TaskID        string
    ExecutorID    string
    Provider      string
}

// ProviderDispatchResult must contain an official provider run identifier and
// a verified ACK before native TaskFlow persistence is attempted.
type ProviderDispatchResult struct {
    ProviderRunID string
    AckVerified   bool
}

// TaskFlowProviderDispatcher is an explicit seam for an officially supported
// provider adapter. Production remains fail-closed until such an adapter is
// configured; tests may inject a deterministic adapter without starting an AI.
type TaskFlowProviderDispatcher interface {
    Dispatch(context.Context, ProviderDispatchRequest) (ProviderDispatchResult, error)
}

type unboundTaskFlowProviderDispatcher struct{}

func (unboundTaskFlowProviderDispatcher) Dispatch(context.Context, ProviderDispatchRequest) (ProviderDispatchResult, error) {
    return ProviderDispatchResult{}, ErrTaskFlowProviderUnavailable
}

var taskflowProviderDispatcher TaskFlowProviderDispatcher = unboundTaskFlowProviderDispatcher{}

func dispatchToProvider(ctx context.Context, request ProviderDispatchRequest) (ProviderDispatchResult, error) {
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
