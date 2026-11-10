package storage

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The connection starter is called only by an operator-owned setup command.
// No public start endpoint, arbitrary redirect or user-supplied account is used.
type TaskFlowDriveSetupStore interface {
	Issue(context.Context, string, time.Time, []byte) error
	Claim(context.Context, string, time.Time) ([]byte, error)
	SaveGrant(context.Context, []byte, string) error
	ReserveFolder(context.Context, string) (string, error)
}
type TaskFlowDriveOAuthSetup struct {
	Client                                                    *http.Client
	ClientID, ClientSecret, CallbackURL, OwnerEmail           string
	MasterSecret                                              string
	Store                                                     TaskFlowDriveSetupStore
	authEndpoint, tokenEndpoint, aboutEndpoint, driveEndpoint string
}

func (s *TaskFlowDriveOAuthSetup) validate() error {
	u, e := url.Parse(s.CallbackURL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || s.Client == nil || s.ClientID == "" || s.ClientSecret == "" || s.OwnerEmail == "" || len(s.MasterSecret) < 32 || s.Store == nil {
		return errors.New("private Drive connection setup incomplete")
	}
	return nil
}
func driveStateHash(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])
}
func (s *TaskFlowDriveOAuthSetup) NewConnectionURL(ctx context.Context) (string, error) {
	if e := s.validate(); e != nil {
		return "", e
	}
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	state := base64.RawURLEncoding.EncodeToString(b)
	verifierBytes := make([]byte, 32)
	if _, e := rand.Read(verifierBytes); e != nil {
		return "", e
	}
	verifier := base64.RawURLEncoding.EncodeToString(verifierBytes)
	challengeBytes := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeBytes[:])
	sealedVerifier, e := sealDriveGrant(s.MasterSecret, []byte(verifier))
	if e != nil {
		return "", e
	}
	if e := s.Store.Issue(ctx, driveStateHash(state), time.Now().Add(15*time.Minute), sealedVerifier); e != nil {
		return "", errors.New("cannot prepare private Drive connection")
	}
	base := "https://accounts.google.com/o/oauth2/v2/auth"
	if s.authEndpoint != "" {
		base = s.authEndpoint
	}
	q := url.Values{"client_id": {s.ClientID}, "redirect_uri": {s.CallbackURL}, "response_type": {"code"}, "scope": {TaskFlowDriveScope}, "access_type": {"offline"}, "prompt": {"consent"}, "include_granted_scopes": {"false"}, "login_hint": {s.OwnerEmail}, "state": {state}, "code_challenge": {challenge}, "code_challenge_method": {"S256"}}
	return base + "?" + q.Encode(), nil
}
func sealDriveGrant(secret string, plain []byte) ([]byte, error) {
	sum := sha256.Sum256([]byte(secret))
	block, e := aes.NewCipher(sum[:])
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, plain, []byte("TF-private-Drive-grant-v1")), nil
}
func openDriveGrant(secret string, sealed []byte) ([]byte, error) {
	sum := sha256.Sum256([]byte(secret))
	block, e := aes.NewCipher(sum[:])
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil || len(sealed) < g.NonceSize() {
		return nil, errors.New("Drive grant cannot be decrypted")
	}
	return g.Open(nil, sealed[:g.NonceSize()], sealed[g.NonceSize():], []byte("TF-private-Drive-grant-v1"))
}
func (s *TaskFlowDriveOAuthSetup) Callback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fail := func() {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, "Drive 連線尚未完成。未啟用附件儲存，請回原對話重新取得授權入口。")
	}
	if r.Method != http.MethodGet || s.validate() != nil {
		fail()
		return
	}
	q := r.URL.Query()
	state := q.Get("state")
	code := q.Get("code")
	if len(q["state"]) != 1 || len(q["code"]) != 1 || len(state) != 43 || len(code) < 1 || len(code) > 4096 || q.Get("error") != "" {
		fail()
		return
	}
	sealedVerifier, e := s.Store.Claim(r.Context(), driveStateHash(state), time.Now())
	if e != nil {
		fail()
		return
	}
	verifier, e := openDriveGrant(s.MasterSecret, sealedVerifier)
	if e != nil {
		fail()
		return
	}
	defer clearDriveBytes(verifier)
	client := *s.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	endpoint := "https://oauth2.googleapis.com/token"
	if s.tokenEndpoint != "" {
		endpoint = s.tokenEndpoint
	}
	form := url.Values{"client_id": {s.ClientID}, "client_secret": {s.ClientSecret}, "redirect_uri": {s.CallbackURL}, "grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {string(verifier)}}
	req, e := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if e != nil {
		fail()
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, e := client.Do(req)
	if e != nil {
		fail()
		return
	}
	defer res.Body.Close()
	var grant struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Scope   string `json:"scope"`
		Type    string `json:"token_type"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 16384)).Decode(&grant) != nil || grant.Access == "" || grant.Refresh == "" || grant.Scope != TaskFlowDriveScope || !strings.EqualFold(grant.Type, "Bearer") {
		fail()
		return
	}
	about := "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)"
	if s.aboutEndpoint != "" {
		about = s.aboutEndpoint
	}
	req, e = http.NewRequestWithContext(r.Context(), http.MethodGet, about, nil)
	if e != nil {
		fail()
		return
	}
	req.Header.Set("Authorization", "Bearer "+grant.Access)
	res2, e := client.Do(req)
	if e != nil {
		fail()
		return
	}
	defer res2.Body.Close()
	var identity struct {
		User struct {
			Email string `json:"emailAddress"`
		} `json:"user"`
	}
	if res2.StatusCode != 200 || json.NewDecoder(io.LimitReader(res2.Body, 8192)).Decode(&identity) != nil || !strings.EqualFold(identity.User.Email, s.OwnerEmail) {
		fail()
		return
	}
	folder, e := s.provisionFolder(r.Context(), &client, grant.Access)
	if e != nil {
		fail()
		return
	}
	// Only the app's refresh grant is sealed, not access tokens or raw responses.
	payload, _ := json.Marshal(map[string]string{"refresh_token": grant.Refresh, "scope": TaskFlowDriveScope, "owner_email": identity.User.Email, "folder_id": folder})
	sealed, e := sealDriveGrant(s.MasterSecret, payload)
	clearDriveBytes(payload)
	if e != nil {
		fail()
		return
	}
	if e = s.Store.SaveGrant(r.Context(), sealed, identity.User.Email); e != nil {
		fail()
		return
	}
	io.WriteString(w, "Drive 連線授權已保存。附件儲存尚未啟用，完成檢查後會在原對話通知。")
}
func clearDriveBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
