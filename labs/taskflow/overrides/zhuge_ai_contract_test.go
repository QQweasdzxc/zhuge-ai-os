package taskflowcontract

import (
	"strings"
	"testing"
)

func TestPMApprovalRevisionAndIdempotencyContract(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	if !ValidApproval(9, 9, key) {
		t.Fatal("current revision and 128-bit key should be accepted")
	}
	for _, tc := range []struct {
		name              string
		expected, current int64
		key               string
	}{
		{"stale revision", 8, 9, key},
		{"zero revision", 0, 0, key},
		{"missing key", 9, 9, ""},
		{"non-random key", 9, 9, "retry-me"},
		{"uppercase key", 9, 9, strings.ToUpper(key)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if ValidApproval(tc.expected, tc.current, tc.key) {
				t.Fatal("invalid approval accepted")
			}
		})
	}
}

func TestNativeStatusAndTaskIdentityContract(t *testing.T) {
	for _, status := range []string{"backlog", "todo", "in_progress", "in_review", "unstarted", "started"} {
		if !StatusEligible(status) {
			t.Errorf("eligible status %q rejected", status)
		}
	}
	for _, status := range []string{"done", "closed", "cancelled", "blocked", "custom-waiting", ""} {
		if StatusEligible(status) {
			t.Errorf("ineligible status %q accepted", status)
		}
	}
	for _, identifier := range []string{"ZG-1", "AIOS-42"} {
		if ClosingMarker(identifier) != "Closes "+identifier {
			t.Errorf("marker missing for %s", identifier)
		}
	}
	for _, identifier := range []string{"", "ZG-0", "zg-42", "public-1", "ZG-1 extra"} {
		if ClosingMarker(identifier) != "" {
			t.Errorf("invalid identifier accepted: %q", identifier)
		}
	}
}

func TestEngineerAllowlist(t *testing.T) {
	for _, engineer := range []string{"co", "gem"} {
		if !ValidEngineer(engineer) {
			t.Errorf("configured engineer %q rejected", engineer)
		}
	}
	for _, engineer := range []string{"", "codex", "gemini", "admin", "Co"} {
		if ValidEngineer(engineer) {
			t.Errorf("unsupported engineer %q accepted", engineer)
		}
	}
}

func TestSignedWebhookDeliveryContract(t *testing.T) {
	for _, id := range []string{"2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42", "A12B3456-7890-4ABC-8DEF-1234567890AB"} {
		if !ValidGitHubDeliveryID(id) {
			t.Errorf("valid delivery id rejected: %q", id)
		}
	}
	for _, id := range []string{"", "not-a-uuid", "2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd4", "2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42/extra"} {
		if ValidGitHubDeliveryID(id) {
			t.Errorf("invalid delivery id accepted: %q", id)
		}
	}
	if !ValidGitHubHeadSHA(strings.Repeat("a", 40)) || ValidGitHubHeadSHA(strings.Repeat("g", 40)) {
		t.Fatal("invalid GitHub head SHA contract")
	}
	body := []byte(`{"action":"opened","pull_request":{"number":42}}`)
	digest := PayloadSHA256(body)
	if !DeliveryPayloadMatches(digest, body) || DeliveryPayloadMatches(digest, []byte(`{"action":"closed"}`)) {
		t.Fatal("delivery replay digest does not bind payload")
	}
}
