package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/analytics"
)

func TestTaskFlowZhugeRoutesInFinalRouter(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://aios.example")

	router, _ := NewRouterWithOptions(nil, nil, nil, analytics.NoopClient{}, nil, RouterOptions{})
	assertRouteCount := func(method, path string) {
		t.Helper()
		count := 0
		if err := chi.Walk(router, func(routeMethod, routePath string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
			if routeMethod == method && routePath == path {
				count++
			}
			return nil
		}); err != nil {
			t.Fatalf("walk final router: %v", err)
		}
		if count != 1 {
			t.Fatalf("expected exactly one %s %s route, got %d", method, path, count)
		}
	}

	assertRouteCount(http.MethodPost, "/auth/zhuge")
	assertRouteCount(http.MethodPost, "/api/cli-token")

	loginRequest := httptest.NewRequest(http.MethodPost, "/auth/zhuge", strings.NewReader(`{"access_token":""}`))
	loginRequest.Header.Set("Content-Type", "application/json")
	loginResponse := httptest.NewRecorder()
	router.ServeHTTP(loginResponse, loginRequest)
	if loginResponse.Code != http.StatusUnauthorized {
		t.Fatalf("POST /auth/zhuge without a session must reach ZhugeLogin and return 401, got %d: %s", loginResponse.Code, loginResponse.Body.String())
	}
	if !strings.Contains(loginResponse.Body.String(), "missing Zhuge session") {
		t.Fatalf("POST /auth/zhuge did not reach the expected ZhugeLogin validation: %s", loginResponse.Body.String())
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/auth/zhuge", nil)
	preflight.Header.Set("Origin", "https://aios.example")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodPost)
	preflight.Header.Set("Access-Control-Request-Headers", "content-type")
	preflightResponse := httptest.NewRecorder()
	router.ServeHTTP(preflightResponse, preflight)
	if preflightResponse.Code < 200 || preflightResponse.Code >= 300 {
		t.Fatalf("POST /auth/zhuge CORS preflight failed: %d", preflightResponse.Code)
	}
	if got := preflightResponse.Header().Get("Access-Control-Allow-Origin"); got != "https://aios.example" {
		t.Fatalf("CORS preflight returned unexpected allow-origin %q", got)
	}

	cliRequest := httptest.NewRequest(http.MethodPost, "/api/cli-token", strings.NewReader(`{}`))
	cliResponse := httptest.NewRecorder()
	router.ServeHTTP(cliResponse, cliRequest)
	if cliResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST /api/cli-token must remain guarded and non-404, got %d", cliResponse.Code)
	}
}
