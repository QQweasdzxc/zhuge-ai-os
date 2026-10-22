package handler

import (
	"context"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
)

// CTODispatchMutationRequest is the client portion of the candidate native
// dispatch mutation. The client cannot provide a CTO identity, workspace
// authority, or authorization result; those values are resolved server-side.
type CTODispatchMutationRequest struct {
	TaskID    string `json:"task_id,omitempty"`
	Executor  string `json:"executor_id"`
	Provider  string `json:"provider"`
}

func parseCTODispatchMutationRequest(body []byte) (CTODispatchMutationRequest, error) {
	var request CTODispatchMutationRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return CTODispatchMutationRequest{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return CTODispatchMutationRequest{}, errors.New("request body contains multiple JSON values")
		}
		return CTODispatchMutationRequest{}, err
	}
	if strings.TrimSpace(request.Executor) == "" || strings.TrimSpace(request.Provider) == "" {
		return CTODispatchMutationRequest{}, errors.New("executor_id and provider are required")
	}
	request.Executor = strings.TrimSpace(request.Executor)
	request.Provider = strings.TrimSpace(request.Provider)
	request.TaskID = strings.TrimSpace(request.TaskID)
	return request, nil
}

func ctoDispatchProviderHTTPError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrTaskFlowProviderUnavailable):
		return http.StatusServiceUnavailable, "provider dispatch is not bound"
	case errors.Is(err, ErrTaskFlowProviderAckInvalid):
		return http.StatusBadGateway, "provider ACK is not verified"
	default:
		return http.StatusBadGateway, "provider dispatch failed"
	}
}

func ctoDispatchMutationHTTPError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrCTODispatchAuthorityUnavailable):
		return http.StatusServiceUnavailable, "cto dispatch authority is unavailable"
	case errors.Is(err, ErrCTODispatchUnauthorized):
		return http.StatusForbidden, "cto dispatch authority rejected"
	case errors.Is(err, ErrCTODispatchWorkspaceMismatch):
		return http.StatusForbidden, "cto dispatch workspace rejected"
	case errors.Is(err, ErrCTODispatchExecutorUnknown):
		return http.StatusForbidden, "dispatch executor is not registered"
	case errors.Is(err, ErrCTODispatchProviderMismatch):
		return http.StatusForbidden, "dispatch provider is not registered for executor"
	default:
		return http.StatusForbidden, "cto dispatch rejected"
	}
}

// CTODispatchIssue is a TaskFlow-owned candidate mutation boundary. It
// checks the protected deployment allowlist and native workspace before
// delegating task creation to the existing RerunIssue service. An empty
// allowlist fails closed. The native service response is a TaskFlow task, not
// a Provider ACK or Provider Run ID.
// CTODispatchIssue is the protected dispatch outlet.
func (h *Handler) CTODispatchIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	body := []byte{}
	if r.Body != nil {
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid dispatch request body")
			return
		}
	}
	request, err := parseCTODispatchMutationRequest(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid dispatch request body")
		return
	}

	workspaceID := uuidToString(issue.WorkspaceID)
	if err := AuthorizeCTODispatchRequest(CTODispatchRequest{
		AuthenticatedUserID:      userID,
		ConfiguredCTOUserIDs:     ParseCTOAllowlist(os.Getenv("TASKFLOW_CTO_ALLOWLIST_USER_IDS")),
		AuthenticatedWorkspaceID: workspaceID,
		RequestedWorkspaceID:     workspaceID,
		ExecutorID:               request.Executor,
		Provider:                 request.Provider,
	}); err != nil {
		status, message := ctoDispatchMutationHTTPError(err)
		writeError(w, status, message)
		return
	}

	// Resolve both route and durable claim server-side. The default resolvers
	// are unbound, so no native task/provider run can be created accidentally.
	route, err := resolveProviderConversationRoute(context.Background(), request.Executor, workspaceID, request.Provider)
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}
	// Dispatch ID must come from a server-owned durable claim, never from TaskID/client metadata.\n\tdispatchID := ""
	correlation, err := resolveProviderDispatchCorrelation(context.Background(), dispatchID, workspaceID, uuidToString(issue.ID))
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}
	_, err = dispatchToProvider(context.Background(), ProviderDispatchRequest{
		IssueID: uuidToString(issue.ID),
		WorkspaceID: workspaceID,
		AuthenticatedUserID: userID,
		TaskID: request.TaskID,
		ExecutorID: request.Executor,
		Provider: request.Provider,
		Correlation: correlation,
		Route: route.Route,
	})
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	// RerunIssue is the existing native TaskFlow mutation. Strip the
	// authorization-only fields before delegating so the frozen handler sees
	// only its established request contract.
	nativeBody, err := json.Marshal(RerunIssueRequest{TaskID: request.TaskID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to prepare native dispatch")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(nativeBody))
	r.ContentLength = int64(len(nativeBody))
	h.RerunIssue(w, r)
}
