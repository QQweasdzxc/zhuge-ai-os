package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
)

type CTODispatchMutationRequest struct {
	TaskID   string `json:"task_id,omitempty"`
	Executor string `json:"executor_id"`
	Provider string `json:"provider"`
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

// CTODispatchIssue is the protected dispatch outlet. Route and durable claim
// resolution are server-owned; clients cannot provide a DispatchID, lease,
// fencing epoch, session or ACK.
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
	issueID := uuidToString(issue.ID)
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

	route, err := resolveProviderConversationRoute(context.Background(), request.Executor, workspaceID, request.Provider)
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	// Claim is an atomic, server-owned operation. It must be obtained before
	// crossing the provider boundary; TaskID and client metadata are not claims.
	claim, err := resolveProviderDispatchClaim(context.Background(), workspaceID, issueID, request.Executor, request.Provider)
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}
	correlation, err := resolveProviderDispatchCorrelation(context.Background(), claim.DispatchID, workspaceID, issueID)
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	_, err = dispatchToProvider(context.Background(), ProviderDispatchRequest{
		IssueID:             issueID,
		WorkspaceID:         workspaceID,
		AuthenticatedUserID: userID,
		TaskID:              request.TaskID,
		ExecutorID:          request.Executor,
		Provider:            request.Provider,
		Correlation:         correlation,
		Route:               route.Route,
		DispatchClaim:       claim,
	})
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	nativeBody, err := json.Marshal(RerunIssueRequest{TaskID: request.TaskID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to prepare native dispatch")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(nativeBody))
	r.ContentLength = int64(len(nativeBody))
	h.RerunIssue(w, r)
}
