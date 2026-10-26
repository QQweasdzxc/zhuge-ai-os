package storage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// VerifyTaskFlowSupabaseIdentity asks Supabase Auth to validate the Zhuge
// user's access token. TaskFlow JWTs are intentionally not accepted as
// Supabase credentials. The returned UUID is compared with the already
// authenticated TaskFlow principal before the token enters request context.
func VerifyTaskFlowSupabaseIdentity(ctx context.Context, token string) (string, error) {
	client := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	return verifyTaskFlowSupabaseIdentity(ctx, token, os.Getenv("ZHUGE_SUPABASE_URL"), os.Getenv("ZHUGE_SUPABASE_ANON_KEY"), client)
}

func verifyTaskFlowSupabaseIdentity(ctx context.Context, token, rawBaseURL, anonKey string, client *http.Client) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 16*1024 || strings.ContainsAny(token, " \r\n\t") || strings.Count(token, ".") != 2 {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusForbidden}
	}
	parsedBase, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil || parsedBase.Host == "" || parsedBase.User != nil || parsedBase.RawQuery != "" || parsedBase.Fragment != "" || (parsedBase.Path != "" && parsedBase.Path != "/") || (parsedBase.Scheme != "https" && !(parsedBase.Scheme == "http" && isLoopbackStorageHost(parsedBase.Hostname()))) || strings.TrimSpace(anonKey) == "" || isTaskFlowServiceRoleCredential(anonKey) {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusServiceUnavailable}
	}
	baseURL := strings.TrimRight(parsedBase.String(), "/")
	requestCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, baseURL+"/auth/v1/user", nil)
	if err != nil {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusServiceUnavailable}
	}
	req.Header.Set("apikey", anonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusServiceUnavailable}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusForbidden}
	}
	if resp.StatusCode != http.StatusOK {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusBadGateway}
	}
	var identity struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&identity); err != nil {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusBadGateway}
	}
	parsed, err := uuid.Parse(strings.TrimSpace(identity.ID))
	if err != nil {
		return "", &TaskFlowSupabaseIdentityError{Status: http.StatusForbidden}
	}
	return parsed.String(), nil
}

// TaskFlowSupabaseIdentityError contains only a response class, never an
// upstream body, credential or user-provided value.
type TaskFlowSupabaseIdentityError struct{ Status int }

func (e *TaskFlowSupabaseIdentityError) Error() string {
	if e == nil {
		return "TaskFlow Storage identity verification failed"
	}
	return "TaskFlow Storage identity verification failed"
}

func (e *TaskFlowSupabaseIdentityError) HTTPStatusCode() int { return e.Status }
