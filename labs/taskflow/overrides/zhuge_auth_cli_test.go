package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestZhugeIssueCliTokenRejectsAnonymousAndClientSelectedIdentity(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodPost, "/api/cli-token", strings.NewReader(`{"user_id":"attacker-selected-id"}`))
	rec := httptest.NewRecorder()
	h.ZhugeIssueCliToken(rec, req)
	if rec.Code != http.StatusUnauthorized { t.Fatalf("anonymous grant must fail: %d", rec.Code) }
	if strings.Contains(rec.Body.String(), `"token"`) { t.Fatal("anonymous request received a CLI code") }
}
