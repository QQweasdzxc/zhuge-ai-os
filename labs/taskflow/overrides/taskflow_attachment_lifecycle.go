package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

type taskFlowCardContextKey struct{}

// The API resolves comment ownership itself before calling Storage.
func WithTaskFlowAttachmentCard(ctx context.Context, card string) context.Context {
	return context.WithValue(ctx, taskFlowCardContextKey{}, card)
}
func (s *TaskFlowSupabaseStorage) lifecycleRequest(ctx context.Context, body any) ([]byte, error) {
	b, _ := json.Marshal(body)
	response, err := s.request(ctx, http.MethodPost, "/functions/v1/attachment-lifecycle", bytes.NewReader(b), "application/json")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, &TaskFlowSupabaseStorageError{Status: response.StatusCode, Cause: "attachment policy denied"}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 32*1024))
	if err != nil {
		return nil, &TaskFlowSupabaseStorageError{Cause: "attachment policy unavailable"}
	}
	return data, nil
}
func taskFlowLifecycleEnabled() bool { return os.Getenv("TASKFLOW_ATTACHMENT_LIFECYCLE") == "true" }
func (s *TaskFlowSupabaseStorage) lifecycleAccess(ctx context.Context, key, intent string) (string, error) {
	id := strings.TrimSuffix(path.Base(key), path.Ext(key))
	data, err := s.lifecycleRequest(ctx, map[string]string{"module": "taskflow", "id": id, "intent": intent})
	if err != nil {
		return "", err
	}
	var response struct {
		Enabled bool   `json:"enabled"`
		URL     string `json:"url"`
	}
	if json.Unmarshal(data, &response) != nil || !response.Enabled || response.URL == "" {
		return "", &TaskFlowSupabaseStorageError{Cause: "attachment policy inactive"}
	}
	parsed, err := url.Parse(response.URL)
	if err != nil || parsed.Scheme != mustScheme(s.baseURL) || !strings.EqualFold(parsed.Host, mustHost(s.baseURL)) || parsed.User != nil || parsed.Path != "/functions/v1/attachment-lifecycle" || parsed.Query().Get("cap") == "" {
		return "", errors.New("unexpected attachment capability origin")
	}
	return parsed.String(), nil
}
func (s *TaskFlowSupabaseStorage) lifecycleReserve(ctx context.Context, key, name string, size int) error {
	parts := strings.Split(key, "/")
	if len(parts) != 3 || parts[0] != "workspaces" {
		return &TaskFlowSupabaseStorageError{Status: 403, Cause: "card workspace is required"}
	}
	id := strings.TrimSuffix(parts[2], path.Ext(parts[2]))
	card, _ := ctx.Value(taskFlowCardContextKey{}).(string)
	var parent any
	if card != "" {
		parent = card
	}
	body, _ := json.Marshal(map[string]any{"p_id": id, "p_card": parent, "p_workspace": parts[1], "p_key": key, "p_name": name, "p_size": size})
	response, err := s.request(ctx, http.MethodPost, "/rest/v1/rpc/attachment_reserve_taskflow", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return &TaskFlowSupabaseStorageError{Status: response.StatusCode, Cause: "attachment reservation denied"}
	}
	return nil
}
