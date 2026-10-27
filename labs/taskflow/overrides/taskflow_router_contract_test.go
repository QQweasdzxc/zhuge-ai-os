package main

import (
	"context"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/auth"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

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
	assertRouteCount(http.MethodGet, "/api/issues/{id}/dispatch-runtime")
	assertRouteCount(http.MethodGet, "/api/zhuge/native-executor-projects")
	assertRouteCount(http.MethodGet, "/api/zhuge/native-ai-tasks")

	for _, path := range []string{"/api/zhuge/native-executor-projects", "/api/zhuge/native-ai-tasks"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("X-User-ID", "00000000-0000-0000-0000-000000000001")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Fatalf("unauthenticated spoofed-header GET %s = %d", path, w.Code)
		}
	}
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

// Runs the actual final HTTP router. No pre-injected handler/member context.
func TestG1NativeFinalHTTPAuthMemberHumanChain(t *testing.T) {
	url := os.Getenv("G1_READBACK_TEST_URL")
	if url == "" {
		if os.Getenv("G1_READBACK_REQUIRED") == "1" {
			t.Fatal("required isolated fixture missing")
		}
		t.Skip("isolated fixture not selected")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `ALTER TABLE taskflow.member ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();CREATE TABLE IF NOT EXISTS taskflow.task_token(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text,task_id uuid,agent_id uuid,workspace_id uuid,user_id uuid,expires_at timestamptz,created_at timestamptz DEFAULT now());`)
	if err != nil {
		t.Fatal(err)
	}
	machine := "mat_isolated_g1_http_fixture"
	_, err = pool.Exec(ctx, `INSERT INTO taskflow.task_token(token_hash,task_id,agent_id,workspace_id,user_id,expires_at) SELECT $1,gen_random_uuid(),id,workspace_id,owner_id,now()+interval '1 hour' FROM taskflow.agent WHERE system_key='CO-01'`, auth.HashToken(machine))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM taskflow.task_token WHERE token_hash=$1`, auth.HashToken(machine))
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "ac5afcc7-f045-41a9-8827-eaf085a04c0d", "exp": time.Now().Add(time.Hour).Unix()}).SignedString(auth.JWTSecret())
	if err != nil {
		t.Fatal(err)
	}
	router, _ := NewRouterWithOptions(pool, nil, nil, analytics.NoopClient{}, nil, RouterOptions{})
	for _, path := range []string{"/api/zhuge/native-executor-projects", "/api/zhuge/native-ai-tasks"} {
		for _, tc := range []struct {
			name, token, ws string
			want            int
		}{{"human-owner", signed, "01a1247f-520e-78eb-aa58-0a0e458185f6", 200}, {"machine", machine, "01a1247f-520e-78eb-aa58-0a0e458185f6", 403}, {"nonmember-workspace", signed, "00000000-0000-0000-0000-000000000099", 404}} {
			req := httptest.NewRequest("GET", path+"?workspace_id="+tc.ws, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			req.Header.Set("X-Actor-Source", "ignored-client-spoof")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("%s %s=%d want%d %s", path, tc.name, w.Code, tc.want, w.Body.String())
			}
			if tc.want == 200 && !strings.Contains(w.Body.String(), "workspace_id") {
				t.Fatalf("handler not reached: %s", w.Body.String())
			}
		}
	}
}
