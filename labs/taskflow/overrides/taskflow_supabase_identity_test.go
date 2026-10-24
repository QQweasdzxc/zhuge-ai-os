package storage

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVerifyTaskFlowSupabaseIdentityUsesAuthUserEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/auth/v1/user" {
			t.Errorf("unexpected identity request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("apikey") != "anon-test" || r.Header.Get("Authorization") != "Bearer a.b.c" {
			t.Errorf("identity verification did not use the supplied user credential")
		}
		_, _ = fmt.Fprint(w, `{"id":"11111111-1111-4111-8111-111111111111"}`)
	}))
	defer server.Close()
	userID, err := verifyTaskFlowSupabaseIdentity(context.Background(), "a.b.c", server.URL, "anon-test", server.Client())
	if err != nil || userID != testTaskFlowUserID {
		t.Fatalf("verified id = %q, err = %v", userID, err)
	}
}

func TestVerifyTaskFlowSupabaseIdentityRejectsInvalidTokenAndIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.Header.Get("Authorization"), "not-a-token") {
			t.Error("malformed token reached Supabase")
		}
		_, _ = fmt.Fprint(w, `{"id":"not-a-uuid"}`)
	}))
	defer server.Close()
	for _, token := range []string{"", "not-a-token", strings.Repeat("a", 16*1024+1)} {
		if _, err := verifyTaskFlowSupabaseIdentity(context.Background(), token, server.URL, "anon-test", server.Client()); err == nil {
			t.Errorf("invalid token %q unexpectedly accepted", token[:min(16, len(token))])
		}
	}
	if _, err := verifyTaskFlowSupabaseIdentity(context.Background(), "a.b.c", server.URL, "anon-test", server.Client()); err == nil {
		t.Fatal("invalid user UUID unexpectedly accepted")
	}
}

func TestVerifyTaskFlowSupabaseIdentityMapsRejectedAndUnavailable(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		want int
	}{
		{name: "expired", code: http.StatusUnauthorized, want: http.StatusForbidden},
		{name: "upstream", code: http.StatusInternalServerError, want: http.StatusBadGateway},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.code) }))
			defer server.Close()
			_, err := verifyTaskFlowSupabaseIdentity(context.Background(), "a.b.c", server.URL, "anon-test", server.Client())
			statusErr, ok := err.(interface{ HTTPStatusCode() int })
			if !ok || statusErr.HTTPStatusCode() != tc.want {
				t.Fatalf("error = %v, want status %d", err, tc.want)
			}
		})
	}
}
