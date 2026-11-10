package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type driveSetupTest struct {
	sync.Mutex
	state, folder     string
	expiry            time.Time
	verifier, grant   []byte
	claimed, failSave bool
}

func (s *driveSetupTest) Issue(_ context.Context, hash string, expiry time.Time, v []byte) error {
	s.state = hash
	s.expiry = expiry
	s.verifier = v
	return nil
}
func (s *driveSetupTest) Claim(_ context.Context, hash string, now time.Time) ([]byte, error) {
	s.Lock()
	defer s.Unlock()
	if s.claimed || s.state != hash || !now.Before(s.expiry) {
		return nil, errors.New("invalid state")
	}
	s.claimed = true
	return s.verifier, nil
}
func (s *driveSetupTest) SaveGrant(_ context.Context, sealed []byte, email string) error {
	if s.failSave {
		return errors.New("DB unavailable")
	}
	s.grant = sealed
	return nil
}
func (s *driveSetupTest) ReserveFolder(_ context.Context, id string) (string, error) {
	if s.folder == "" {
		s.folder = id
	}
	return s.folder, nil
}
func TestTaskFlowDriveOAuthSetup(t *testing.T) {
	for _, mode := range []string{"success", "scope", "owner", "state", "expired", "save", "redirect", "replay", "folder-shared", "folder-outage"} {
		t.Run(mode, func(t *testing.T) {
			store := &driveSetupTest{}
			tokenCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					tokenCalls++
					r.ParseForm()
					if len(r.Form.Get("code_verifier")) != 43 {
						t.Error("PKCE missing")
					}
					if mode == "redirect" {
						w.Header().Set("Location", "https://untrusted.invalid/")
						w.WriteHeader(307)
						return
					}
					scope := TaskFlowDriveScope
					if mode == "scope" {
						scope = "https://www.googleapis.com/auth/drive"
					}
					json.NewEncoder(w).Encode(map[string]any{"access_token": "fixture-access", "refresh_token": "fixture-refresh", "scope": scope, "token_type": "Bearer"})
					return
				}

				if strings.HasPrefix(r.URL.Path, "/drive/") {
					if mode == "folder-outage" {
						w.WriteHeader(503)
						return
					}
					if strings.Contains(r.URL.Path, "generateIds") {
						json.NewEncoder(w).Encode(map[string]any{"ids": []string{"test-folder"}})
						return
					}
					if r.Method == "POST" {
						json.NewEncoder(w).Encode(map[string]string{"id": "test-folder"})
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"id": "test-folder", "mimeType": "application/vnd.google-apps.folder", "ownedByMe": true, "shared": mode == "folder-shared", "appProperties": map[string]string{"taskflow_private_attachments": "v1"}})
					return
				}
				owner := "owner@example.invalid"
				if mode == "owner" {
					owner = "wrong@example.invalid"
				}
				json.NewEncoder(w).Encode(map[string]any{"user": map[string]string{"emailAddress": owner}})
			}))
			defer server.Close()
			setup := &TaskFlowDriveOAuthSetup{Client: server.Client(), ClientID: "fixture-client", ClientSecret: "fixture-client-secret", CallbackURL: "https://tf.example.invalid/auth/private-drive/callback", OwnerEmail: "owner@example.invalid", MasterSecret: strings.Repeat("m", 32), Store: store, tokenEndpoint: server.URL + "/token", aboutEndpoint: server.URL + "/about", driveEndpoint: server.URL}
			entry, e := setup.NewConnectionURL(context.Background())
			if e != nil {
				t.Fatal(e)
			}
			u, _ := url.Parse(entry)
			if u.Query().Get("scope") != TaskFlowDriveScope || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("include_granted_scopes") != "false" {
				t.Fatal("wrong scope/link")
			}
			state := u.Query().Get("state")
			if strings.Contains(entry, setup.ClientSecret) || store.state == state {
				t.Fatal("secret/raw state persisted")
			}
			if mode == "state" {
				state = strings.Repeat("x", 43)
			}
			if mode == "expired" {
				store.expiry = time.Now().Add(-time.Second)
			}
			if mode == "save" {
				store.failSave = true
			}
			request := func() *httptest.ResponseRecorder {
				req := httptest.NewRequest("GET", setup.CallbackURL+"?"+url.Values{"state": {state}, "code": {"fixture-code"}}.Encode(), nil)
				w := httptest.NewRecorder()
				setup.Callback(w, req)
				return w
			}
			w := request()
			if mode == "success" || mode == "replay" {
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
				if bytes.Contains(store.grant, []byte("fixture-refresh")) {
					t.Fatal("plaintext persisted")
				}
				plain, e := openDriveGrant(setup.MasterSecret, store.grant)
				if e != nil || !bytes.Contains(plain, []byte("fixture-refresh")) {
					t.Fatal("cannot decrypt own grant")
				}
				if mode == "replay" {
					if w = request(); w.Code == 200 || tokenCalls != 1 {
						t.Fatal("state replay accepted")
					}
				}
			} else if w.Code == 200 || store.grant != nil {
				t.Fatal("unsafe grant stored")
			}
			if strings.Contains(w.Body.String(), "fixture-") || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("secret leaked/cache allowed")
			}
		})
	}
}
func TestTaskFlowDriveGrantCipherTamper(t *testing.T) {
	sealed, e := sealDriveGrant(strings.Repeat("a", 32), []byte("fixture-grant"))
	if e != nil {
		t.Fatal(e)
	}
	sealed[len(sealed)-1] ^= 1
	if _, e = openDriveGrant(strings.Repeat("a", 32), sealed); e == nil {
		t.Fatal("tampered grant accepted")
	}
}
