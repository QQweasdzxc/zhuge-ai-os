package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const TaskFlowSupabaseAttachmentBucket = "taskflow-attachments"

// Supabase Free supports at most 50 MB per uploaded file (decimal bytes).
// The project or bucket may impose a lower limit; Storage still enforces it.
const TaskFlowSupabaseAttachmentMaxBytes int64 = 50_000_000

type taskFlowSupabaseJWTContextKey struct{}

// WithTaskFlowSupabaseJWT adds the already-verified Zhuge access token to the
// request context used by the private Storage adapter. The JWT is never put in
// a URL, persisted, or logged.
func WithTaskFlowSupabaseJWT(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, taskFlowSupabaseJWTContextKey{}, strings.TrimSpace(token))
}

func taskFlowSupabaseJWT(ctx context.Context) (string, bool) {
	token, ok := ctx.Value(taskFlowSupabaseJWTContextKey{}).(string)
	token = strings.TrimSpace(token)
	return token, ok && token != ""
}

func TaskFlowSupabaseJWTFromContext(ctx context.Context) (string, bool) {
	return taskFlowSupabaseJWT(ctx)
}

// TaskFlowSupabaseStorageError intentionally contains no upstream response
// body. Storage error payloads can contain paths and request details that
// should not be copied into user-facing logs.
type TaskFlowSupabaseStorageError struct {
	Status int
	Cause  string
}

func (e *TaskFlowSupabaseStorageError) Error() string {
	if e == nil {
		return "TaskFlow Supabase Storage error"
	}
	if e.Status != 0 {
		return fmt.Sprintf("TaskFlow Supabase Storage returned HTTP %d", e.Status)
	}
	return "TaskFlow Supabase Storage request failed"
}

func (e *TaskFlowSupabaseStorageError) HTTPStatusCode() int { return e.Status }

type TaskFlowSupabaseStorage struct {
	baseURL    string
	tusBaseURL string
	anonKey    string
	client     *http.Client
	maxBytes   int64
}

// NewTaskFlowSupabaseStorageFromEnv is used only by the TaskFlow build
// overlay. It deliberately does not accept S3 keys, service_role credentials,
// or an alternate bucket.
func NewTaskFlowSupabaseStorageFromEnv() (*TaskFlowSupabaseStorage, error) {
	baseURL := strings.TrimSpace(os.Getenv("ZHUGE_SUPABASE_URL"))
	anonKey := strings.TrimSpace(os.Getenv("ZHUGE_SUPABASE_ANON_KEY"))
	if baseURL == "" || anonKey == "" {
		return nil, errors.New("TaskFlow Supabase Storage requires the existing Zhuge Supabase URL and anon key")
	}
	adapter, err := NewTaskFlowSupabaseStorage(baseURL, anonKey, &http.Client{
		Timeout: 90 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	})
	if err != nil {
		return nil, err
	}
	if configured := strings.TrimSpace(os.Getenv("TASKFLOW_STORAGE_MAX_BYTES")); configured != "" {
		limit, parseErr := strconv.ParseInt(configured, 10, 64)
		if parseErr != nil || limit < 1 || limit > TaskFlowSupabaseAttachmentMaxBytes {
			return nil, errors.New("TaskFlow object cap must be between 1 and 50000000 bytes")
		}
		adapter.maxBytes = limit
	}
	return adapter, nil
}

func NewTaskFlowSupabaseStorage(baseURL, anonKey string, client *http.Client) (*TaskFlowSupabaseStorage, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("TaskFlow Supabase URL must be an HTTPS service origin")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackStorageHost(parsed.Hostname())) {
		return nil, errors.New("TaskFlow Supabase URL must use HTTPS")
	}
	if strings.TrimSpace(anonKey) == "" || isTaskFlowServiceRoleCredential(anonKey) {
		return nil, errors.New("TaskFlow Supabase anon key is required")
	}
	if client == nil {
		client = &http.Client{
			Timeout: 90 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &TaskFlowSupabaseStorage{
		baseURL:    strings.TrimRight(parsed.String(), "/"),
		tusBaseURL: taskFlowTUSBaseURL(parsed),
		anonKey:    strings.TrimSpace(anonKey),
		maxBytes:   TaskFlowSupabaseAttachmentMaxBytes,
		client:     client,
	}, nil
}

// Supabase recommends the project-specific Storage hostname for TUS uploads.
// Other URL forms, including isolated test servers and custom domains, keep
// their configured origin.
func taskFlowTUSBaseURL(projectURL *url.URL) string {
	if projectURL == nil {
		return ""
	}
	if projectURL.Port() != "" {
		return strings.TrimRight(projectURL.String(), "/")
	}
	host := strings.ToLower(projectURL.Hostname())
	projectRef := strings.TrimSuffix(host, ".supabase.co")
	if projectRef == host || projectRef == "" || strings.Contains(projectRef, ".") {
		return strings.TrimRight(projectURL.String(), "/")
	}
	copyURL := *projectURL
	copyURL.Host = projectRef + ".storage.supabase.co"
	copyURL.Path = ""
	copyURL.RawPath = ""
	copyURL.RawQuery = ""
	copyURL.Fragment = ""
	return strings.TrimRight(copyURL.String(), "/")
}

func isTaskFlowServiceRoleCredential(key string) bool {
	key = strings.TrimSpace(key)
	if strings.HasPrefix(key, "sb_secret_") {
		return true
	}
	parts := strings.Split(key, ".")
	if len(parts) != 3 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var claims struct {
		Role string `json:"role"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(claims.Role), "service_role")
}

func isLoopbackStorageHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func (s *TaskFlowSupabaseStorage) CdnDomain() string { return "" }

// ObjectURL is a stable, private Storage URL. It is persisted in the existing
// attachment row, but is never returned as a public URL or signed URL.
func (s *TaskFlowSupabaseStorage) ObjectURL(key string) string {
	clean, err := normalizeTaskFlowStorageKey(key)
	if err != nil {
		return ""
	}
	return s.baseURL + "/storage/v1/object/authenticated/" + TaskFlowSupabaseAttachmentBucket + "/" + escapedStorageKey(clean)
}

// KeyFromURL recognizes only objects in this project's TaskFlow bucket. The
// scoped router leaves legacy Render-local URLs to the existing local adapter.
func (s *TaskFlowSupabaseStorage) KeyFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	if parsed.IsAbs() && (parsed.Scheme != mustScheme(s.baseURL) || !strings.EqualFold(parsed.Host, mustHost(s.baseURL))) {
		return ""
	}
	p := parsed.Path
	const authenticatedPrefix = "/storage/v1/object/authenticated/" + TaskFlowSupabaseAttachmentBucket + "/"
	const signedPrefix = "/storage/v1/object/sign/" + TaskFlowSupabaseAttachmentBucket + "/"
	for _, prefix := range []string{authenticatedPrefix, signedPrefix} {
		if strings.HasPrefix(p, prefix) {
			candidate, err := normalizeTaskFlowStorageKey(strings.TrimPrefix(p, prefix))
			if err == nil {
				return candidate
			}
			return ""
		}
	}
	return ""
}

func mustHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Host
}

func mustScheme(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Scheme
}

func normalizeTaskFlowStorageKey(key string) (string, error) {
	key = strings.TrimPrefix(strings.TrimSpace(key), "/")
	if key == "" || strings.ContainsAny(key, "\\\x00\r\n") {
		return "", errors.New("invalid TaskFlow Storage object key")
	}
	parts := strings.Split(key, "/")
	if len(parts) != 3 || parts[2] == "" || parts[2] == "." || parts[2] == ".." || strings.ContainsAny(parts[2], "\\\x00\r\n") {
		return "", errors.New("invalid TaskFlow Storage object key")
	}
	if parts[0] != "workspaces" && parts[0] != "users" {
		return "", errors.New("TaskFlow attachment Storage key must be workspace- or user-scoped")
	}
	id, err := uuid.Parse(parts[1])
	if err != nil || id.String() != strings.ToLower(parts[1]) {
		return "", errors.New("TaskFlow Storage key has an invalid scope UUID")
	}
	if path.Clean(key) != key {
		return "", errors.New("TaskFlow Storage key contains traversal components")
	}
	return key, nil
}

func escapedStorageKey(key string) string {
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}

func (s *TaskFlowSupabaseStorage) request(ctx context.Context, method, endpoint string, body io.Reader, contentType string) (*http.Response, error) {
	return s.requestURL(ctx, method, s.baseURL+endpoint, body, contentType)
}

func (s *TaskFlowSupabaseStorage) requestURL(ctx context.Context, method, target string, body io.Reader, contentType string) (*http.Response, error) {
	token, ok := taskFlowSupabaseJWT(ctx)
	if !ok {
		return nil, &TaskFlowSupabaseStorageError{Status: http.StatusForbidden, Cause: "missing scoped user credential"}
	}
	parsedTarget, err := url.Parse(target)
	parsedBase, _ := url.Parse(s.baseURL)
	if err != nil || parsedTarget == nil || parsedBase == nil || parsedTarget.User != nil || !strings.EqualFold(parsedTarget.Host, parsedBase.Host) || parsedTarget.Scheme != parsedBase.Scheme {
		return nil, &TaskFlowSupabaseStorageError{Cause: "storage request origin rejected"}
	}
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, &TaskFlowSupabaseStorageError{Cause: "request construction failed"}
	}
	req.Header.Set("apikey", s.anonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, &TaskFlowSupabaseStorageError{Cause: "upstream request failed"}
	}
	return resp, nil
}

func (s *TaskFlowSupabaseStorage) objectEndpoint(prefix, key string) string {
	return "/storage/v1/object/" + prefix + TaskFlowSupabaseAttachmentBucket + "/" + escapedStorageKey(key)
}

func (s *TaskFlowSupabaseStorage) Upload(ctx context.Context, key string, data []byte, contentType string, filename string) (string, error) {
	clean, err := normalizeTaskFlowStorageKey(key)
	if err != nil {
		return "", err
	}
	if int64(len(data)) > s.maxBytes {
		return "", &TaskFlowSupabaseStorageError{Status: http.StatusRequestEntityTooLarge, Cause: "object exceeds TaskFlow bucket limit"}
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if taskFlowLifecycleEnabled() {
		if err := s.lifecycleReserve(ctx, clean, filename, len(data)); err != nil {
			return "", err
		}
	}
	if err := s.uploadResumable(ctx, clean, data, contentType); err != nil {
		return "", err
	}

	// Confirm the uploaded object is visible to this same user before the
	// database row is created. This small metadata request avoids downloading
	// the whole (potentially 25 MiB) object a second time.
	info, err := s.objectInfo(ctx, clean)
	if err != nil {
		_ = s.DeleteObject(ctx, clean)
		return "", err
	}
	if info.SizeBytes() != int64(len(data)) {
		_ = s.DeleteObject(ctx, clean)
		return "", &TaskFlowSupabaseStorageError{Cause: "uploaded object size did not match"}
	}
	_ = filename // download names are supplied by the short-lived signed URL.
	return s.ObjectURL(clean), nil
}

// uploadResumable follows Supabase Storage's TUS endpoint. The fixed 6 MiB
// chunks match Supabase's documented chunk size and allow 13.5 MiB Office
// files to resume safely instead of relying on a single large POST.
func (s *TaskFlowSupabaseStorage) uploadResumable(ctx context.Context, key string, data []byte, contentType string) error {
	metadata := []string{
		"bucketName " + tusBase64(TaskFlowSupabaseAttachmentBucket),
		"objectName " + tusBase64(key),
		"contentType " + tusBase64(contentType),
		"cacheControl " + tusBase64("3600"),
		"upsert " + tusBase64("false"),
	}
	token, ok := taskFlowSupabaseJWT(ctx)
	if !ok {
		return &TaskFlowSupabaseStorageError{Status: http.StatusForbidden, Cause: "missing scoped user credential"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tusBaseURL+"/storage/v1/upload/resumable", nil)
	if err != nil {
		return &TaskFlowSupabaseStorageError{Cause: "resumable upload creation failed"}
	}
	request.Header.Set("apikey", s.anonKey)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Tus-Resumable", "1.0.0")
	request.Header.Set("Upload-Length", strconv.Itoa(len(data)))
	request.Header.Set("Upload-Metadata", strings.Join(metadata, ","))
	request.Header.Set("x-upsert", "false")
	response, err := s.client.Do(request)
	if err != nil {
		return &TaskFlowSupabaseStorageError{Cause: "resumable upload creation failed"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		return &TaskFlowSupabaseStorageError{Status: response.StatusCode, Cause: "resumable upload creation rejected"}
	}
	location := response.Header.Get("Location")
	if location == "" {
		return &TaskFlowSupabaseStorageError{Cause: "resumable upload location missing"}
	}
	parsed, err := url.Parse(location)
	if err != nil {
		return &TaskFlowSupabaseStorageError{Cause: "resumable upload location invalid"}
	}
	if !parsed.IsAbs() {
		parsed = mustParseURL(s.tusBaseURL).ResolveReference(parsed)
	}
	base := mustParseURL(s.tusBaseURL)
	if parsed.User != nil || !strings.EqualFold(parsed.Host, base.Host) || parsed.Scheme != base.Scheme || !strings.HasPrefix(parsed.Path, "/storage/v1/upload/resumable/") {
		return &TaskFlowSupabaseStorageError{Cause: "resumable upload location origin rejected"}
	}

	const chunkSize = 6 << 20
	offset := 0
	for offset < len(data) {
		end := offset + chunkSize
		if end > len(data) {
			end = len(data)
		}
		patch, err := http.NewRequestWithContext(ctx, http.MethodPatch, parsed.String(), bytes.NewReader(data[offset:end]))
		if err != nil {
			return &TaskFlowSupabaseStorageError{Cause: "resumable upload chunk construction failed"}
		}
		patch.Header.Set("apikey", s.anonKey)
		patch.Header.Set("Authorization", "Bearer "+token)
		patch.Header.Set("Tus-Resumable", "1.0.0")
		patch.Header.Set("Upload-Offset", strconv.Itoa(offset))
		patch.Header.Set("Content-Type", "application/offset+octet-stream")
		chunkResponse, err := s.client.Do(patch)
		if err != nil {
			return &TaskFlowSupabaseStorageError{Cause: "resumable upload chunk failed"}
		}
		chunkResponse.Body.Close()
		if chunkResponse.StatusCode != http.StatusNoContent {
			return &TaskFlowSupabaseStorageError{Status: chunkResponse.StatusCode, Cause: "resumable upload chunk rejected"}
		}
		if chunkResponse.Header.Get("Upload-Offset") != strconv.Itoa(end) {
			return &TaskFlowSupabaseStorageError{Cause: "resumable upload offset mismatch"}
		}
		offset = end
	}
	return nil
}

func tusBase64(value string) string {
	return base64.StdEncoding.EncodeToString([]byte(value))
}

func mustParseURL(raw string) *url.URL {
	parsed, _ := url.Parse(raw)
	return parsed
}

type taskFlowObjectInfo struct {
	Size json.RawMessage `json:"size"`
}

func (s *TaskFlowSupabaseStorage) objectInfo(ctx context.Context, key string) (taskFlowObjectInfo, error) {
	if taskFlowLifecycleEnabled() {
		data, err := s.lifecycleRequest(ctx, map[string]string{"module": "taskflow", "id": strings.TrimSuffix(path.Base(key), path.Ext(key)), "intent": "verify"})
		if err != nil {
			return taskFlowObjectInfo{}, err
		}
		var info taskFlowObjectInfo
		if json.Unmarshal(data, &info) != nil {
			return info, &TaskFlowSupabaseStorageError{Cause: "invalid verification"}
		}
		return info, nil
	}
	resp, err := s.request(ctx, http.MethodGet, s.objectEndpoint("info/", key), nil, "")
	if err != nil {
		return taskFlowObjectInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return taskFlowObjectInfo{}, &TaskFlowSupabaseStorageError{Status: resp.StatusCode, Cause: "object read-back failed"}
	}
	var info taskFlowObjectInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16*1024)).Decode(&info); err != nil {
		return taskFlowObjectInfo{}, &TaskFlowSupabaseStorageError{Cause: "object read-back response invalid"}
	}
	var size int64
	if len(info.Size) == 0 || json.Unmarshal(info.Size, &size) != nil {
		var asString string
		if json.Unmarshal(info.Size, &asString) != nil {
			return taskFlowObjectInfo{}, &TaskFlowSupabaseStorageError{Cause: "object read-back size missing"}
		}
		if _, err := fmt.Sscan(asString, &size); err != nil {
			return taskFlowObjectInfo{}, &TaskFlowSupabaseStorageError{Cause: "object read-back size invalid"}
		}
	}
	info.Size = json.RawMessage(fmt.Sprintf("%d", size))
	return taskFlowObjectInfo{Size: json.RawMessage(fmt.Sprintf("%d", size))}, nil
}

func (i taskFlowObjectInfo) SizeBytes() int64 {
	var size int64
	_ = json.Unmarshal(i.Size, &size)
	return size
}

func (s *TaskFlowSupabaseStorage) GetReader(ctx context.Context, key string) (io.ReadCloser, error) {
	clean, err := normalizeTaskFlowStorageKey(key)
	if err != nil {
		return nil, err
	}
	if taskFlowLifecycleEnabled() {
		signed, err := s.lifecycleAccess(ctx, clean, "preview")
		if err != nil {
			return nil, err
		}
		response, err := s.requestURL(ctx, http.MethodGet, signed, nil, "")
		if err != nil {
			return nil, err
		}
		if response.StatusCode != 200 {
			response.Body.Close()
			return nil, &TaskFlowSupabaseStorageError{Status: response.StatusCode, Cause: "attachment unavailable"}
		}
		return response.Body, nil
	}
	resp, err := s.request(ctx, http.MethodGet, s.objectEndpoint("authenticated/", clean), nil, "")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, &TaskFlowSupabaseStorageError{Status: resp.StatusCode, Cause: "object read failed"}
	}
	return resp.Body, nil
}

func (s *TaskFlowSupabaseStorage) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	clean, err := normalizeTaskFlowStorageKey(key)
	if err != nil {
		return "", err
	}
	if taskFlowLifecycleEnabled() {
		return s.lifecycleAccess(ctx, clean, "preview")
	}
	seconds := int64(ttl.Seconds())
	if seconds < 1 || seconds > int64((24*time.Hour).Seconds()) {
		return "", errors.New("TaskFlow attachment signed URL expiry is outside the allowed range")
	}
	body, _ := json.Marshal(map[string]int64{"expiresIn": seconds})
	resp, err := s.request(ctx, http.MethodPost, s.objectEndpoint("sign/", clean), bytes.NewReader(body), "application/json")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", &TaskFlowSupabaseStorageError{Status: resp.StatusCode, Cause: "signed URL request failed"}
	}
	var result struct {
		SignedURL string `json:"signedURL"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16*1024)).Decode(&result); err != nil || strings.TrimSpace(result.SignedURL) == "" {
		return "", &TaskFlowSupabaseStorageError{Cause: "signed URL response invalid"}
	}
	return s.normalizeSignedURL(result.SignedURL)
}

func (s *TaskFlowSupabaseStorage) normalizeSignedURL(raw string) (string, error) {
	if strings.HasPrefix(raw, "/object/") {
		raw = s.baseURL + "/storage/v1" + raw
	} else if strings.HasPrefix(raw, "/storage/v1/") {
		raw = s.baseURL + raw
	} else if strings.HasPrefix(raw, "/") {
		raw = s.baseURL + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, mustHost(s.baseURL)) || !strings.Contains(u.Path, "/storage/v1/object/sign/"+TaskFlowSupabaseAttachmentBucket+"/") {
		return "", errors.New("TaskFlow Storage returned an unexpected signed URL origin")
	}
	return u.String(), nil
}

func (s *TaskFlowSupabaseStorage) PresignGetWithContentDisposition(ctx context.Context, key string, ttl time.Duration, contentDisposition string) (string, error) {
	if taskFlowLifecycleEnabled() {
		intent := "preview"
		if strings.HasPrefix(contentDisposition, "attachment") {
			intent = "download"
		}
		return s.lifecycleAccess(ctx, key, intent)
	}
	signed, err := s.PresignGet(ctx, key, ttl)
	if err != nil {
		return "", err
	}
	downloadName := ""
	if strings.TrimSpace(contentDisposition) != "" {
		_, params, parseErr := mime.ParseMediaType(contentDisposition)
		if parseErr == nil {
			downloadName = strings.TrimSpace(params["filename"])
		}
	}
	if downloadName == "" {
		return signed, nil
	}
	if strings.ContainsAny(downloadName, "\r\n\x00") {
		return "", errors.New("invalid attachment download filename")
	}
	u, err := url.Parse(signed)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("download", downloadName)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (s *TaskFlowSupabaseStorage) Delete(ctx context.Context, key string) {
	if err := s.DeleteObject(ctx, key); err != nil {
		slog.Warn("TaskFlow Supabase Storage delete failed", "error", err)
	}
}

func (s *TaskFlowSupabaseStorage) DeleteObject(ctx context.Context, key string) error {
	clean, err := normalizeTaskFlowStorageKey(key)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string][]string{"prefixes": {clean}})
	resp, err := s.request(ctx, http.MethodDelete, "/storage/v1/object/"+TaskFlowSupabaseAttachmentBucket, bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return &TaskFlowSupabaseStorageError{Status: resp.StatusCode, Cause: "object delete failed"}
	}
	return nil
}

func (s *TaskFlowSupabaseStorage) DeleteKeys(ctx context.Context, keys []string) {
	for _, key := range keys {
		s.Delete(ctx, key)
	}
}
