package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"github.com/multica-ai/multica/server/internal/auth"
)

func TestZhugeCLIAuthorizationCodeOnlyMintsHumanTokenOnNativeRoute(t *testing.T) {
	code, err := auth.NewCLIAuthorizationCode("zhuge-human-uuid")
	if err != nil { t.Fatal(err) }
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-User-ID"); got != "zhuge-human-uuid" { t.Fatalf("wrong bound identity: %q", got) }
		w.WriteHeader(http.StatusCreated)
	})
	handler := Auth(nil, nil, nil, nil)(next)
	wrong := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	wrong.Header.Set("Authorization", "Bearer "+code)
	wrongResult := httptest.NewRecorder()
	handler.ServeHTTP(wrongResult, wrong)
	if wrongResult.Code != http.StatusUnauthorized { t.Fatalf("wrong route accepted: %d", wrongResult.Code) }
	valid := httptest.NewRequest(http.MethodPost, "/api/tokens", nil)
	valid.Header.Set("Authorization", "Bearer "+code)
	validResult := httptest.NewRecorder()
	handler.ServeHTTP(validResult, valid)
	if validResult.Code != http.StatusCreated { t.Fatalf("valid exchange rejected: %d", validResult.Code) }
	replay := httptest.NewRequest(http.MethodPost, "/api/tokens", nil)
	replay.Header.Set("Authorization", "Bearer "+code)
	replayResult := httptest.NewRecorder()
	handler.ServeHTTP(replayResult, replay)
	if replayResult.Code != http.StatusUnauthorized { t.Fatalf("replay accepted: %d", replayResult.Code) }
}

func TestZhugeCLIAuthorizationCodeRejectsUnknownCode(t *testing.T) {
	handler := Auth(nil, nil, nil, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", nil)
	req.Header.Set("Authorization", "Bearer zgc_not-issued")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized { t.Fatalf("unknown grant accepted: %d", rec.Code) }
}
