package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestTaskFlowDriveRefreshSingleFlight(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		r.ParseForm()
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("client_secret") != "test-secret" {
			t.Error("wrong token request")
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": "fixture-access", "token_type": "Bearer", "expires_in": 3600, "scope": TaskFlowDriveScope})
	}))
	defer server.Close()
	tok := &TaskFlowDriveOAuthToken{Client: server.Client(), ClientID: "fixture-client", ClientSecret: "test-secret", RefreshToken: "fixture-refresh", endpoint: server.URL}
	var wg sync.WaitGroup
	for n := 0; n < 10; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := tok.AccessToken(context.Background())
			if e != nil || v != "fixture-access" {
				t.Error("refresh failed")
			}
		}()
	}
	wg.Wait()
	if calls != 1 {
		t.Fatal("refresh duplicated", calls)
	}
}
func TestTaskFlowDriveRefreshRejectsFailures(t *testing.T) {
	for _, mode := range []string{"revoked", "broad-scope", "rotate", "redirect", "rotate-persist", "rotate-persist-fails"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "revoked":
					w.WriteHeader(400)
					fmt.Fprint(w, `{"error":"invalid_grant"}`)
				case "redirect":
					w.Header().Set("Location", "https://untrusted.invalid/token")
					w.WriteHeader(307)
				case "broad-scope":
					json.NewEncoder(w).Encode(map[string]any{"access_token": "a", "token_type": "Bearer", "expires_in": 3600, "scope": "https://www.googleapis.com/auth/drive"})
				case "rotate", "rotate-persist", "rotate-persist-fails":
					json.NewEncoder(w).Encode(map[string]any{"access_token": "a", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "rotated-fixture"})
				}
			}))
			defer server.Close()
			tok := &TaskFlowDriveOAuthToken{Client: server.Client(), ClientID: "fixture-client", ClientSecret: "test-secret", RefreshToken: "fixture-refresh", endpoint: server.URL}
			saved := ""
			if mode == "rotate-persist" || mode == "rotate-persist-fails" {
				tok.PersistRefresh = func(_ context.Context, v string) error {
					if mode == "rotate-persist-fails" {
						return fmt.Errorf("store unavailable")
					}
					saved = v
					return nil
				}
			}
			access, e := tok.AccessToken(context.Background())
			if mode == "rotate-persist" {
				if e != nil || access != "a" || saved != "rotated-fixture" || tok.RefreshToken != saved {
					t.Fatal("rotation not durably saved", e)
				}
			} else if e == nil {
				t.Fatal("unsafe refresh accepted")
			}
			if mode == "rotate-persist-fails" && tok.RefreshToken != "fixture-refresh" {
				t.Fatal("failed persistence replaced grant")
			}

		})
	}
}
