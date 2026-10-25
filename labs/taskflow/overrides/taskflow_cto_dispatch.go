package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
)

type CTODispatchMutationRequest struct {
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

func dispatchIdempotencyKey(r *http.Request) (string, error) {
	if r == nil {
		return "", errors.New("Idempotency-Key is required")
	}
	values := r.Header.Values("Idempotency-Key")
	if len(values) != 1 {
		return "", errors.New("exactly one Idempotency-Key is required")
	}
	key := strings.TrimSpace(values[0])
	if key == "" || len(key) > 200 || strings.ContainsAny(key, "\r\n") {
		return "", errors.New("invalid Idempotency-Key")
	}
	return key, nil
}

func nativeDispatchProjectMatchesIssue(mappings []zhugeNativeProjectMapping, executorID, workspaceID, issueProjectID string) bool {
	if strings.TrimSpace(executorID) == "" || strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(issueProjectID) == "" {
		return false
	}
	var match *zhugeNativeProjectMapping
	for index := range mappings {
		if mappings[index].ExecutorID != executorID {
			continue
		}
		if match != nil {
			return false
		}
		match = &mappings[index]
	}
	return match != nil && match.State == "VERIFIED" && match.WorkspaceID == workspaceID &&
		match.ProjectID == issueProjectID && match.ProjectAccess == "ALLOW" && match.agentID.Valid
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

	// Bind the selected executor to the Issue's existing native Project. The
	// mapping is derived from TaskFlow Agent.system_key/Project.lead and the
	// authenticated member's ACL; missing or ambiguous mappings stay blocked.
	if !issue.ProjectID.Valid {
		writeError(w, http.StatusForbidden, "dispatch issue has no verified native executor project")
		return
	}
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	if uuidToString(member.WorkspaceID) != workspaceID || uuidToString(member.UserID) != userID {
		writeError(w, http.StatusForbidden, "dispatch workspace membership is invalid")
		return
	}
	mappings, err := h.loadZhugeNativeProjectMappings(r, workspaceID, member)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "native executor project mapping is unavailable")
		return
	}
	if !nativeDispatchProjectMatchesIssue(mappings, request.Executor, workspaceID, uuidToString(issue.ProjectID)) {
		writeError(w, http.StatusForbidden, "dispatch issue is not in the verified executor project")
		return
	}

	requestKey, err := dispatchIdempotencyKey(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "a valid Idempotency-Key header is required")
		return
	}
	ctx := r.Context()
	route, err := resolveProviderConversationRoute(ctx, request.Executor, workspaceID, request.Provider)
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	// Claim and one-time start permission come from TaskFlow's existing DB pool.
	// The key is only a replay token; Issue and Workspace authority came from
	// loadIssueForUser and the authenticated server-side principal above.
	claim, result, err := dispatchWithNativeAuthority(ctx, nativeDispatchAuthorityForHandler(h), NativeDispatchClaimRequest{
		RequestKey: requestKey, IssueID: issueID, WorkspaceID: workspaceID,
		ExecutorID: request.Executor, Provider: request.Provider, CTOPrincipal: userID, LeaseSeconds: 300,
	}, ProviderDispatchRequest{
		IssueID:             issueID,
		WorkspaceID:         workspaceID,
		AuthenticatedUserID: userID,
		ExecutorID:          request.Executor,
		Provider:            request.Provider,
		Route:               route.Route,
	})
	if err != nil {
		status, message := ctoDispatchProviderHTTPError(err)
		writeError(w, status, message)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"dispatch_id":         claim.DispatchID,
		"issue_id":            issueID,
		"workspace_id":        workspaceID,
		"executor_id":         request.Executor,
		"provider":            request.Provider,
		"provider_session_id": result.SessionID,
		"provider_run_id":     result.ProviderRunID,
		"ack_event_id":        result.AckEventID,
		"status":              "acknowledged",
	})
}
