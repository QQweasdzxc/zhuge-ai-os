package storage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const TaskFlowDriveScope = "https://www.googleapis.com/auth/drive.file"

// Credentials must come only from the app's own approved runtime secret store,
// never a browser cookie, another app's connection or the public repository.
type TaskFlowDriveOAuthToken struct {
	mu                                   sync.Mutex
	Client                               *http.Client
	ClientID, ClientSecret, RefreshToken string
	access                               string
	expiry                               time.Time
	endpoint                             string
	PersistRefresh                       func(context.Context, string) error
}

func (t *TaskFlowDriveOAuthToken) AccessToken(ctx context.Context) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.access != "" && time.Until(t.expiry) > time.Minute {
		return t.access, nil
	}
	if t.Client == nil || t.ClientID == "" || t.ClientSecret == "" || t.RefreshToken == "" {
		return "", ErrTaskFlowDriveUnavailable
	}
	endpoint := "https://oauth2.googleapis.com/token"
	if t.endpoint != "" {
		endpoint = t.endpoint
	}
	values := url.Values{"grant_type": {"refresh_token"}, "client_id": {t.ClientID}, "client_secret": {t.ClientSecret}, "refresh_token": {t.RefreshToken}}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if e != nil {
		return "", ErrTaskFlowDriveUnavailable
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := *t.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	r, e := client.Do(req)
	if e != nil {
		return "", ErrTaskFlowDriveUnavailable
	}
	defer r.Body.Close()
	var result struct {
		Access  string `json:"access_token"`
		Expires int64  `json:"expires_in"`
		Type    string `json:"token_type"`
		Scope   string `json:"scope"`
		Refresh string `json:"refresh_token"`
	}
	if r.StatusCode != 200 || json.NewDecoder(io.LimitReader(r.Body, 16384)).Decode(&result) != nil || result.Access == "" || !strings.EqualFold(result.Type, "Bearer") || result.Expires < 60 || result.Expires > 86400 {
		return "", ErrTaskFlowDriveUnavailable
	}
	if result.Scope != "" && result.Scope != TaskFlowDriveScope {
		return "", errors.New("TF Drive grant must have only the approved per-file scope")
	}
	// Persist a rotated grant before acknowledging the new token. If durable
	// sealing fails, fail closed rather than silently lose the refresh grant.
	if result.Refresh != "" && result.Refresh != t.RefreshToken {
		if t.PersistRefresh == nil || t.PersistRefresh(ctx, result.Refresh) != nil {
			return "", ErrTaskFlowDriveUnavailable
		}
		t.RefreshToken = result.Refresh
	}
	t.access = result.Access
	t.expiry = time.Now().Add(time.Duration(result.Expires) * time.Second)
	return t.access, nil
}
