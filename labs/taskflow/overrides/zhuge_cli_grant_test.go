package auth

import (
	"strings"
	"testing"
	"time"
)

func TestZhugeCLIAuthorizationCodeIsRandomBoundShortLivedAndSingleUse(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	code, err := newCLIAuthorizationCodeAt("zhuge-user-uuid", now)
	if err != nil { t.Fatal(err) }
	if !strings.HasPrefix(code, CLIAuthorizationCodePrefix) { t.Fatalf("bad code prefix: %q", code) }
	second, err := newCLIAuthorizationCodeAt("zhuge-user-uuid", now)
	if err != nil { t.Fatal(err) }
	if code == second { t.Fatal("independent grants must differ") }
	if userID, ok := consumeCLIAuthorizationCodeAt(code, now.Add(cliAuthorizationCodeTTL-time.Second)); !ok || userID != "zhuge-user-uuid" {
		t.Fatalf("identity binding failed: %q, %t", userID, ok)
	}
	if _, ok := consumeCLIAuthorizationCodeAt(code, now.Add(time.Second)); ok { t.Fatal("replay accepted") }
}

func TestZhugeCLIAuthorizationCodeExpiresAndRejectsInvalidInput(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	if _, err := newCLIAuthorizationCodeAt(" ", now); err == nil { t.Fatal("empty identity accepted") }
	code, err := newCLIAuthorizationCodeAt("zhuge-user-uuid", now)
	if err != nil { t.Fatal(err) }
	if _, ok := consumeCLIAuthorizationCodeAt(code, now.Add(cliAuthorizationCodeTTL)); ok { t.Fatal("expired code accepted") }
	if _, ok := consumeCLIAuthorizationCodeAt("not-a-cli-code", now); ok { t.Fatal("invalid code accepted") }
}
