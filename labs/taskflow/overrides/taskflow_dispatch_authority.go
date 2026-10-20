package handler

import (
	"errors"
	"strings"
)

var ErrCTODispatchAuthorityUnavailable = errors.New("cto dispatch authority is not configured")
var ErrCTODispatchUnauthorized = errors.New("authenticated user is not an authorized cto dispatcher")

// AuthorizeCTODispatch is deliberately independent from client metadata and
// workspace role labels. The deployment supplies the authenticated CTO user
// IDs through a protected runtime configuration; an empty allowlist fails
// closed until that authority is formally provisioned.
func AuthorizeCTODispatch(authenticatedUserID string, configuredCTOUserIDs []string) error {
	userID := strings.TrimSpace(authenticatedUserID)
	if userID == "" || len(configuredCTOUserIDs) == 0 {
		return ErrCTODispatchAuthorityUnavailable
	}
	for _, candidate := range configuredCTOUserIDs {
		if userID == strings.TrimSpace(candidate) {
			return nil
		}
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
