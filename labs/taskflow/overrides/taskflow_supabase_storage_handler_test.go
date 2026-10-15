package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type taskFlowStorageTestStatusError struct{ status int }

func (e taskFlowStorageTestStatusError) Error() string         { return "private upstream URL and bearer token must not leak" }
func (e taskFlowStorageTestStatusError) HTTPStatusCode() int { return e.status }

func TestWriteTaskFlowStorageErrorFailsClosedForSupabaseProvider(t *testing.T) {
	t.Setenv("TASKFLOW_STORAGE_PROVIDER", "supabase")

	tests := []struct {
		name       string
		err        error
		fallback   int
		wantStatus int
	}{
		{name: "authorization denied", err: taskFlowStorageTestStatusError{http.StatusUnauthorized}, fallback: http.StatusBadGateway, wantStatus: http.StatusForbidden},
		{name: "object missing", err: taskFlowStorageTestStatusError{http.StatusNotFound}, fallback: http.StatusBadGateway, wantStatus: http.StatusNotFound},
		{name: "upload limit", err: taskFlowStorageTestStatusError{http.StatusRequestEntityTooLarge}, fallback: http.StatusBadGateway, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "provider throttle", err: taskFlowStorageTestStatusError{http.StatusTooManyRequests}, fallback: http.StatusBadGateway, wantStatus: http.StatusTooManyRequests},
		{name: "provider server failure", err: taskFlowStorageTestStatusError{http.StatusInternalServerError}, fallback: http.StatusBadGateway, wantStatus: http.StatusBadGateway},
		{name: "untyped transport failure", err: errors.New("private upstream URL and bearer token must not leak"), fallback: http.StatusBadGateway, wantStatus: http.StatusBadGateway},
		{name: "invalid status uses safe fallback", err: taskFlowStorageTestStatusError{0}, fallback: http.StatusBadGateway, wantStatus: http.StatusBadGateway},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			if !writeTaskFlowStorageError(response, tc.err, tc.fallback, "private attachment storage is unavailable") {
				t.Fatal("Supabase Storage error was not handled; caller could use a legacy fallback")
			}
			if response.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tc.wantStatus)
			}
			body := response.Body.String()
			if !strings.Contains(body, "private attachment storage is unavailable") {
				t.Fatalf("safe user-facing error is missing: %q", body)
			}
			if strings.Contains(body, "bearer") || strings.Contains(body, "upstream URL") || strings.Contains(body, "private upstream") {
				t.Fatalf("provider detail leaked in response: %q", body)
			}
			if response.Header().Get("Content-Disposition") != "" {
				t.Fatal("failed storage response unexpectedly emitted an attachment disposition")
			}
		})
	}
}

func TestWriteTaskFlowStorageErrorLeavesNonSupabaseStorageHandlingToCaller(t *testing.T) {
	t.Setenv("TASKFLOW_STORAGE_PROVIDER", "local")
	response := httptest.NewRecorder()
	if writeTaskFlowStorageError(response, errors.New("local error"), http.StatusNotFound, "attachment missing") {
		t.Fatal("non-Supabase storage error should remain with the existing local handler")
	}
}
