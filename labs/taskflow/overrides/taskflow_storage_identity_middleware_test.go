package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/storage"
)

const taskFlowIdentityTestUUID = "11111111-1111-4111-8111-111111111111"

func TestTaskFlowStorageIdentityRequiresMatchingVerifiedUUID(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if token, ok := storage.TaskFlowSupabaseJWTFromContext(r.Context()); !ok || token != "zhuge.access.jwt" {
			t.Errorf("verified storage token missing from request context")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	verify := func(_ context.Context, token string) (string, error) {
		if token != "zhuge.access.jwt" {
			t.Errorf("verifier received unexpected token")
		}
		return taskFlowIdentityTestUUID, nil
	}
	request := httptest.NewRequest(http.MethodGet, "/api/attachments/id", nil)
	request.Header.Set("X-User-ID", taskFlowIdentityTestUUID)
	request.Header.Set("X-Zhuge-Storage-Token", "zhuge.access.jwt")
	response := httptest.NewRecorder()
	requireTaskFlowSupabaseStorageIdentity(next, verify).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !called {
		t.Fatalf("status=%d called=%v body=%s", response.Code, called, response.Body.String())
	}
}

func TestTaskFlowStorageIdentityRejectsMissingWriteOrMismatchedCredentials(t *testing.T) {
	for _, tc := range []struct {
		name        string
		method      string
		userID      string
		storageJWT  string
		verifiedID  string
		wantStatus  int
	}{
		{name: "missing TaskFlow user", method: http.MethodPost, storageJWT: "token", verifiedID: taskFlowIdentityTestUUID, wantStatus: http.StatusForbidden},
		{name: "missing Zhuge token on upload", method: http.MethodPost, userID: taskFlowIdentityTestUUID, verifiedID: taskFlowIdentityTestUUID, wantStatus: http.StatusForbidden},
		{name: "missing Zhuge token on delete", method: http.MethodDelete, userID: taskFlowIdentityTestUUID, verifiedID: taskFlowIdentityTestUUID, wantStatus: http.StatusForbidden},
		{name: "UUID mismatch", method: http.MethodGet, userID: taskFlowIdentityTestUUID, storageJWT: "token", verifiedID: "22222222-2222-4222-8222-222222222222", wantStatus: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
			verify := func(_ context.Context, _ string) (string, error) { return tc.verifiedID, nil }
			request := httptest.NewRequest(tc.method, "/api/attachments/id", nil)
			if tc.userID != "" {
				request.Header.Set("X-User-ID", tc.userID)
			}
			if tc.storageJWT != "" {
				request.Header.Set("X-Zhuge-Storage-Token", tc.storageJWT)
			}
			response := httptest.NewRecorder()
			requireTaskFlowSupabaseStorageIdentity(next, verify).ServeHTTP(response, request)
			if response.Code != tc.wantStatus || called {
				t.Fatalf("status=%d called=%v want status %d and no downstream call", response.Code, called, tc.wantStatus)
			}
		})
	}
}

func TestTaskFlowStorageIdentityAllowsAuthenticatedLegacyReadWithoutStorageJWT(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := storage.TaskFlowSupabaseJWTFromContext(r.Context()); ok {
			t.Fatal("missing Zhuge token unexpectedly entered request context")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/api/attachments/id/content", nil)
	request.Header.Set("X-User-ID", taskFlowIdentityTestUUID)
	response := httptest.NewRecorder()
	requireTaskFlowSupabaseStorageIdentity(next, nil).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !called {
		t.Fatalf("status=%d called=%v body=%s", response.Code, called, response.Body.String())
	}
}
