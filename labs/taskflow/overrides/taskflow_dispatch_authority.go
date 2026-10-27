package handler

import (
	"errors"
	"strings"
)

var ErrCTODispatchAuthorityUnavailable = errors.New("cto dispatch authority is not configured")
var ErrCTODispatchUnauthorized = errors.New("authenticated user is not an authorized cto dispatcher")
var ErrCTODispatchWorkspaceMismatch = errors.New("cto dispatch workspace does not match authenticated workspace")
var ErrCTODispatchExecutorUnknown = errors.New("dispatch executor is not registered")
var ErrCTODispatchProviderMismatch = errors.New("dispatch provider does not match registered executor")

// AuthorizeCTODispatch is deliberately independent from client metadata and
// workspace role labels. The deployment supplies the authenticated CTO user
// IDs through a protected runtime configuration; an empty allowlist fails
// closed until that authority is formally provisioned.
func AuthorizeCTODispatch(authenticatedUserID string, configuredCTOUserIDs []string) error {
	userID := strings.TrimSpace(authenticatedUserID)
	if userID == "" {
		return ErrCTODispatchAuthorityUnavailable
	}
	hasCandidate := false
	for _, candidate := range configuredCTOUserIDs {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		hasCandidate = true
		if userID == trimmed {
			return nil
		}
	}
	if !hasCandidate {
		return ErrCTODispatchAuthorityUnavailable
	}
	return ErrCTODispatchUnauthorized
}

// TaskFlow-owned executor identities. Provider Run evidence is still read
// from the native runtime/provider response; these labels never create ACKs.
var TaskFlowDispatchExecutors = map[string]string{
	"CO-01":     "codex",
	"CO-02":     "codex",
	"CO-03":     "codex",
	"GEM-01":    "gemini",
	"GH-HELPER": "github",
}

// CTODispatchRequest is the server-side input needed by a future mutation
// handler. It deliberately contains the authenticated identity and workspace
// resolved by middleware; it does not contain a client-supplied CTO label or
// an authorization claim. Keeping this validator separate lets the overlay
// test the security boundary without changing frozen vendor routes.
type CTODispatchRequest struct {
	AuthenticatedUserID      string
	ConfiguredCTOUserIDs     []string
	AuthenticatedWorkspaceID string
	RequestedWorkspaceID     string
	ExecutorID               string
	Provider                 string
}

// ParseCTOAllowlist parses protected deployment configuration. Empty entries
// are discarded and duplicates are collapsed; an empty result remains an
// unavailable authority and therefore fails closed in AuthorizeCTODispatch.
func ParseCTOAllowlist(raw string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, candidate := range strings.Split(raw, ",") {
		userID := strings.TrimSpace(candidate)
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		result = append(result, userID)
	}
	return result
}

// AuthorizeCTODispatchRequest composes authenticated CTO authority, the
// middleware-resolved workspace and the TaskFlow-owned executor registry. A
// caller cannot upgrade this check with metadata, a GitHub comment or a UI
// label because those values are not inputs to the validator.
func AuthorizeCTODispatchRequest(req CTODispatchRequest) error {
	if err := AuthorizeCTODispatch(req.AuthenticatedUserID, req.ConfiguredCTOUserIDs); err != nil {
		return err
	}
	authenticatedWorkspace := strings.TrimSpace(req.AuthenticatedWorkspaceID)
	requestedWorkspace := strings.TrimSpace(req.RequestedWorkspaceID)
	if authenticatedWorkspace == "" || requestedWorkspace == "" || authenticatedWorkspace != requestedWorkspace {
		return ErrCTODispatchWorkspaceMismatch
	}
	executorID := strings.TrimSpace(req.ExecutorID)
	provider := strings.TrimSpace(req.Provider)
	registeredProvider, ok := TaskFlowDispatchExecutors[executorID]
	if !ok {
		return ErrCTODispatchExecutorUnknown
	}
	if provider == "" || provider != registeredProvider {
		return ErrCTODispatchProviderMismatch
	}
	return nil
}
