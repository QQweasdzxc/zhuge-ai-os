package main

import (
	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskFlowDriveFinalRouter(t *testing.T) {
	t.Setenv("TASKFLOW_DRIVE_SETUP_ENABLED", "1")
	t.Setenv("TASKFLOW_DRIVE_CLIENT_ID", "fixture-client")
	t.Setenv("TASKFLOW_DRIVE_CLIENT_SECRET", "fixture-secret")
	t.Setenv("TASKFLOW_DRIVE_MASTER_SECRET", strings.Repeat("x", 32))
	t.Setenv("TASKFLOW_DRIVE_OWNER_EMAIL", "owner@example.invalid")
	t.Setenv("TASKFLOW_DRIVE_CALLBACK_URL", "https://api.example.invalid"+storage.TaskFlowDriveCallbackPath)
	router, _ := NewRouterWithOptions(nil, nil, nil, analytics.NoopClient{}, nil, RouterOptions{})
	callbackCount, setupCount := 0, 0
	chi.Walk(router, func(method, path string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method == "GET" && path == storage.TaskFlowDriveCallbackPath {
			callbackCount++
		}
		if method == "POST" && path == "/api/taskflow-drive/setup" {
			setupCount++
		}
		return nil
	})
	if callbackCount != 1 || setupCount != 1 {
		t.Fatal("incorrect registration", callbackCount, setupCount)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "https://api.example.invalid"+storage.TaskFlowDriveCallbackPath+"?state=wrong&code=fake", nil))
	if w.Code != 400 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("callback not exact/failclosed", w.Code)
	}
	req := httptest.NewRequest("POST", "/api/taskflow-drive/setup", strings.NewReader("{}"))
	req.Header.Set("X-User-ID", "owner-spoof")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal("owner setup unauthenticated", w.Code)
	}
}
