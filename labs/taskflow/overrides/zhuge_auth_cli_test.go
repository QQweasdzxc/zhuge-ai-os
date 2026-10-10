package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestZhugeCliTokenClaimsAreIdentityBoundAndShortLived(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	claims := zhugeCliTokenClaims("canonical-zhuge-uuid", "human@example.test", "Human", "session-123", now)
	if claims["sub"] != "canonical-zhuge-uuid" {
		t.Fatalf("subject must come from authenticated Zhuge UUID, got %v", claims["sub"])
	}
	if claims["email"] != "human@example.test" || claims["name"] != "Human" || claims["sid"] != "session-123" {
		t.Fatalf("expected native Multica identity claims, got %#v", claims)
	}
	if claims["exp"] != now.Add(zhugeCliAuthorizationTTL).Unix() {
		t.Fatalf("CLI grant must expire after %s, got %v", zhugeCliAuthorizationTTL, claims["exp"])
	}
	if _, exists := claims["user_id"]; exists {
		t.Fatal("CLI grant must not accept or add a front-end selected user id")
	}
	if claims["iat"] != now.Unix() {
		t.Fatalf("unexpected issue time: %v", claims["iat"])
	}

	secret := []byte("test-only-cli-grant-key")
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		t.Fatal(err)
	}
	parse := func(at time.Time) error {
		_, err := jwt.ParseWithClaims(raw, jwt.MapClaims{}, func(*jwt.Token) (any, error) {
			return secret, nil
		}, jwt.WithTimeFunc(func() time.Time { return at }))
		return err
	}
	if err := parse(now.Add(zhugeCliAuthorizationTTL - time.Second)); err != nil {
		t.Fatalf("grant should be valid before five-minute expiry: %v", err)
	}
	if err := parse(now.Add(zhugeCliAuthorizationTTL + time.Second)); err == nil {
		t.Fatal("grant must fail after five-minute expiry")
	}
}

func TestZhugeIssueCliTokenRejectsAnonymousAndClientSelectedIdentity(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodPost, "/api/cli-token", strings.NewReader(`{"user_id":"attacker-selected-id"}`))
	rec := httptest.NewRecorder()

	h.ZhugeIssueCliToken(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous CLI authorization must be rejected, got HTTP %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"token"`) {
		t.Fatal("anonymous or client-selected identity must not receive a CLI token")
	}
}
