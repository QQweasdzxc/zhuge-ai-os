package storage

// Private candidate. No router registration or credential setup is included.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
)

const TaskFlowDriveMaxObjectBytes int64 = 100 * 1024 * 1024

var ErrTaskFlowDriveReadOnly = errors.New("private Drive uploads temporarily read-only")

func validTaskFlowDriveObjectKey(key string) bool {
	if key == "" || len(key) > 1024 || strings.ContainsAny(key, "\\\x00?#%") || strings.HasPrefix(key, "/") || path.Clean(key) != key {
		return false
	}
	p := strings.Split(key, "/")
	if len(p) < 3 || (p[0] != "workspaces" && p[0] != "users") {
		return false
	}
	for _, v := range p {
		if v == "" || v == "." || v == ".." {
			return false
		}
	}
	return true
}

var ErrTaskFlowDriveUnavailable = errors.New("private Drive storage unavailable")
var ErrTaskFlowDriveIntegrity = errors.New("original Drive file integrity mismatch; no bytes served")
var ErrTaskFlowDriveMissing = errors.New("original Drive object missing or moved; no replacement served")

// Reserve atomically inserts a binding or returns the immutable prior binding.
// It must not change an existing key's file ID/hash/size, including after deletion.
type TaskFlowDriveBinding struct {
	Key, FileID, SHA256, FolderID string
	Size                          int64
	Ready, Deleted                bool
}
type TaskFlowDriveIndex interface {
	Lookup(context.Context, string) (TaskFlowDriveBinding, error)
	Reserve(context.Context, TaskFlowDriveBinding) (TaskFlowDriveBinding, error)
	MarkReady(context.Context, string) error
	MarkDeleted(context.Context, string) error
}
type TaskFlowDriveToken interface {
	AccessToken(context.Context) (string, error)
}
type TaskFlowDriveStorage struct {
	trashEnabled bool
	client       *http.Client
	tokens       TaskFlowDriveToken
	index        TaskFlowDriveIndex
	folder, base string
	transfers    chan struct{}
	readOnly     bool
	// filed records keys confirmed inside their task folder this process,
	// so serve-time re-filing stays a cheap no-op instead of a Drive lookup.
	filed sync.Map
	// filingWarned records keys whose persistent filing failure already
	// produced its one system comment, so retries never repost.
	filingWarned sync.Map
}

func NewTaskFlowDriveStorage(c *http.Client, t TaskFlowDriveToken, i TaskFlowDriveIndex, folder string) (*TaskFlowDriveStorage, error) {
	if c == nil || t == nil || i == nil || !validDriveID(folder) {
		return nil, errors.New("incomplete private Drive configuration")
	}
	cc := *c
	// Never forward credentials to a redirect supplied by a remote response.
	cc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &TaskFlowDriveStorage{client: &cc, tokens: t, index: i, folder: folder, base: "https://www.googleapis.com", transfers: make(chan struct{}, 1)}, nil
}
func validDriveID(v string) bool {
	if len(v) < 1 || len(v) > 256 {
		return false
	}
	for _, r := range v {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-') {
			return false
		}
	}
	return true
}
func (s *TaskFlowDriveStorage) SetReadOnly()      { s.readOnly = true }
func (s *TaskFlowDriveStorage) CdnDomain() string { return "" }
func (s *TaskFlowDriveStorage) ObjectURL(k string) string {
	if !validTaskFlowDriveObjectKey(k) {
		return ""
	}
	return "/uploads/" + k
}
func (s *TaskFlowDriveStorage) KeyFromURL(raw string) string {
	u, e := url.Parse(raw)
	if e != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, "/uploads/") {
		return ""
	}
	k := strings.TrimPrefix(u.Path, "/uploads/")
	if !validTaskFlowDriveObjectKey(k) {
		return ""
	}
	return k
}

type taskFlowDrivePermit struct{}

func (s *TaskFlowDriveStorage) BeginTransfer(ctx context.Context) (context.Context, func(), error) {
	if ctx.Value(taskFlowDrivePermit{}) == s {
		return ctx, func() {}, nil
	}
	if e := ctx.Err(); e != nil {
		return ctx, func() {}, e
	}
	select {
	case s.transfers <- struct{}{}:
		var once sync.Once
		return context.WithValue(ctx, taskFlowDrivePermit{}, s), func() { once.Do(func() { <-s.transfers }) }, nil
	case <-ctx.Done():
		return ctx, func() {}, ctx.Err()
	}
}
func (s *TaskFlowDriveStorage) BeginUpload(ctx context.Context) (context.Context, func(), error) {
	if s.readOnly {
		return ctx, func() {}, ErrTaskFlowDriveReadOnly
	}
	return s.BeginTransfer(ctx)
}
func (s *TaskFlowDriveStorage) request(ctx context.Context, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	token, e := s.tokens.AccessToken(ctx)
	if e != nil || token == "" {
		return nil, ErrTaskFlowDriveUnavailable
	}
	req, e := http.NewRequestWithContext(ctx, method, s.base+path, body)
	if e != nil {
		return nil, ErrTaskFlowDriveUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	response, e := s.client.Do(req)
	if e != nil {
		return nil, ErrTaskFlowDriveUnavailable
	}
	return response, nil
}
func closeDriveResponse(r *http.Response) {
	io.Copy(io.Discard, io.LimitReader(r.Body, 4096))
	r.Body.Close()
}

// Reject public/shared or foreign-owned folders rather than silently expanding
// the task audience through inherited Drive permissions.
func (s *TaskFlowDriveStorage) checkFolder(ctx context.Context) error {
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+s.folder+"?fields=id,mimeType,trashed,shared,ownedByMe", nil, "")
	if e != nil {
		return e
	}
	defer closeDriveResponse(r)
	if r.StatusCode != 200 {
		return ErrTaskFlowDriveUnavailable
	}
	var f struct {
		ID      string `json:"id"`
		Mime    string `json:"mimeType"`
		Trashed bool   `json:"trashed"`
		Shared  *bool  `json:"shared"`
		Owned   bool   `json:"ownedByMe"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&f) != nil || f.ID != s.folder || f.Mime != "application/vnd.google-apps.folder" || f.Trashed || f.Shared == nil || *f.Shared || !f.Owned {
		return errors.New("Drive folder must remain private and owned by the authorized account")
	}
	return nil
}
func (s *TaskFlowDriveStorage) generateID(ctx context.Context) (string, error) {
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/generateIds?count=1&space=drive&type=files", nil, "")
	if e != nil {
		return "", e
	}
	defer closeDriveResponse(r)
	var x struct {
		IDs []string `json:"ids"`
	}
	if r.StatusCode != 200 || json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&x) != nil || len(x.IDs) != 1 || !validDriveID(x.IDs[0]) {
		return "", ErrTaskFlowDriveUnavailable
	}
	return x.IDs[0], nil
}

type driveObjectMeta struct {
	Owned   bool     `json:"ownedByMe"`
	Shared  *bool    `json:"shared"`
	ID      string   `json:"id"`
	Size    string   `json:"size"`
	SHA256  string   `json:"sha256Checksum"`
	Parents []string `json:"parents"`
	Trashed bool     `json:"trashed"`
}

func (s *TaskFlowDriveStorage) verifyMeta(ctx context.Context, b TaskFlowDriveBinding) error {
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+b.FileID+"?fields=id,size,sha256Checksum,parents,trashed,shared,ownedByMe", nil, "")
	if e != nil {
		return e
	}
	defer closeDriveResponse(r)
	if r.StatusCode == 404 {
		return ErrTaskFlowDriveMissing
	}
	if r.StatusCode != 200 {
		return ErrTaskFlowDriveUnavailable
	}
	var m driveObjectMeta
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&m) != nil {
		return ErrTaskFlowDriveUnavailable
	}
	if m.ID != b.FileID || m.Size != strconv.FormatInt(b.Size, 10) || m.Trashed || m.Shared == nil || *m.Shared || !m.Owned {
		return ErrTaskFlowDriveMissing
	}
	// Root placement and verified task-subfolder placement are both
	// authorized; anywhere else is treated as moved away.
	if !s.authorizedParent(ctx, m.Parents) {
		return ErrTaskFlowDriveMissing
	}
	// Some Drive objects omit SHA256; the download is still verified before serving.
	if m.SHA256 != "" && m.SHA256 != b.SHA256 {
		return ErrTaskFlowDriveIntegrity
	}
	return nil
}
func (s *TaskFlowDriveStorage) Upload(ctx context.Context, key string, data []byte, contentType, filename string) (string, error) {
	ctx, release, e := s.BeginUpload(ctx)
	if e != nil {
		return "", e
	}
	defer release()
	if !validTaskFlowDriveObjectKey(key) || len(data) > int(TaskFlowDriveMaxObjectBytes) {
		return "", errors.New("invalid attachment key or size")
	}
	if e = s.checkFolder(ctx); e != nil {
		return "", e
	}
	// Attachments bound to a task are filed under that task's own subfolder;
	// anything without a valid task label keeps the existing root placement.
	target := s.folder
	if label := taskFlowDriveFolderLabel(ctx); label != "" {
		if target, e = s.ensureTaskFolder(ctx, label); e != nil {
			return "", e
		}
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	b, e := s.index.Lookup(ctx, key)
	if errors.Is(e, os.ErrNotExist) {
		id, err := s.generateID(ctx)
		if err != nil {
			return "", err
		}
		b, e = s.index.Reserve(ctx, TaskFlowDriveBinding{Key: key, FileID: id, SHA256: hash, FolderID: target, Size: int64(len(data))})
	}
	if e != nil {
		return "", ErrTaskFlowDriveUnavailable
	}
	// The bound folder is pinned at reservation; retries complete into that
	// same folder, and Ready objects are proven by verifyMeta regardless of
	// which subfolder a later re-upload would choose today.
	if b.Size < 0 || b.Size > TaskFlowDriveMaxObjectBytes || b.Deleted || b.SHA256 != hash || b.Size != int64(len(data)) || !validDriveID(b.FolderID) || !validDriveID(b.FileID) {
		return "", errors.New("immutable attachment binding mismatch")
	}
	if b.Ready {
		if e = s.verifyMeta(ctx, b); e != nil {
			return "", e
		}
		r, err := s.verifiedReader(ctx, b)
		if err != nil {
			return "", err
		}
		r.Close()
		return s.ObjectURL(key), nil
	}
	// Multipart data are streamed with a small metadata prefix/suffix. The file ID
	// was durably reserved before the request so a lost response can be retried
	// without creating a duplicate object. A conflict is never taken as proof.
	var pre bytes.Buffer
	mw := multipart.NewWriter(&pre)
	h := textproto.MIMEHeader{}
	h.Set("Content-Type", "application/json; charset=UTF-8")
	p, _ := mw.CreatePart(h)
	meta := map[string]any{"id": b.FileID, "name": filename, "parents": []string{b.FolderID}, "mimeType": contentType}
	json.NewEncoder(p).Encode(meta)
	h = textproto.MIMEHeader{}
	h.Set("Content-Type", "application/octet-stream")
	mw.CreatePart(h)
	prefix := append([]byte(nil), pre.Bytes()...)
	pre.Reset()
	mw.Close()
	suffix := append([]byte(nil), pre.Bytes()...)
	reader := io.MultiReader(bytes.NewReader(prefix), bytes.NewReader(data), bytes.NewReader(suffix))
	r, e := s.request(ctx, http.MethodPost, "/upload/drive/v3/files?uploadType=multipart&fields=id", reader, "multipart/related; boundary="+mw.Boundary())
	if e != nil {
		return "", e
	}
	status := r.StatusCode
	closeDriveResponse(r)
	if status != 200 && status != 201 && status != 409 {
		return "", ErrTaskFlowDriveUnavailable
	}
	if e = s.verifyMeta(ctx, b); e != nil {
		return "", e
	}
	// Verify actual bytes before acknowledging success, including409 retries.
	verified, e := s.verifiedReader(ctx, b)
	if e != nil {
		return "", e
	}
	verified.Close()
	if e = s.index.MarkReady(ctx, key); e != nil {
		return "", ErrTaskFlowDriveUnavailable
	}
	return s.ObjectURL(key), nil
}

type taskFlowDriveReader struct {
	*os.File
	release func()
	once    sync.Once
}

func (r *taskFlowDriveReader) Close() error {
	var err error
	r.once.Do(func() { err = r.File.Close(); os.Remove(r.File.Name()); r.release() })
	return err
}
func (s *TaskFlowDriveStorage) verifiedReader(ctx context.Context, b TaskFlowDriveBinding) (io.ReadCloser, error) {
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+b.FileID+"?alt=media", nil, "")
	if e != nil {
		return nil, e
	}
	defer closeDriveResponse(r)
	if r.StatusCode == 404 {
		return nil, ErrTaskFlowDriveMissing
	}
	if r.StatusCode != 200 {
		return nil, ErrTaskFlowDriveUnavailable
	}
	file, e := os.CreateTemp("", "tf-drive-read-*")
	if e != nil {
		return nil, e
	}
	fail := func(err error) (io.ReadCloser, error) { file.Close(); os.Remove(file.Name()); return nil, err }
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(file, hash), io.LimitReader(r.Body, b.Size+1))
	if e != nil {
		return fail(ErrTaskFlowDriveUnavailable)
	}
	if n != b.Size || hex.EncodeToString(hash.Sum(nil)) != b.SHA256 {
		return fail(ErrTaskFlowDriveIntegrity)
	}
	if _, e = file.Seek(0, io.SeekStart); e != nil {
		return fail(e)
	}
	return &taskFlowDriveReader{File: file, release: func() {}}, nil
}
func (s *TaskFlowDriveStorage) GetReader(ctx context.Context, key string) (io.ReadCloser, error) {
	if !validTaskFlowDriveObjectKey(key) {
		return nil, errors.New("invalid attachment key")
	}
	ctx, release, e := s.BeginTransfer(ctx)
	if e != nil {
		return nil, e
	}
	if e = s.checkFolder(ctx); e != nil {
		release()
		return nil, e
	}
	b, e := s.index.Lookup(ctx, key)
	if e != nil {
		release()
		if errors.Is(e, os.ErrNotExist) {
			return nil, ErrTaskFlowDriveMissing
		}
		return nil, ErrTaskFlowDriveUnavailable
	}
	// The bound folder is organizational; the object's live placement is
	// verified against the authorized root tree in verifyMeta below.
	if b.Size < 0 || b.Size > TaskFlowDriveMaxObjectBytes || !b.Ready || b.Deleted || !validDriveID(b.FolderID) || !validDriveID(b.FileID) {
		release()
		return nil, ErrTaskFlowDriveMissing
	}
	if e = s.verifyMeta(ctx, b); e != nil {
		release()
		return nil, e
	}
	r, e := s.verifiedReader(ctx, b)
	if e != nil {
		release()
		return nil, e
	}
	r.(*taskFlowDriveReader).release = release
	return r, nil
}
func (s *TaskFlowDriveStorage) DeleteObject(ctx context.Context, key string) error {
	if !validTaskFlowDriveObjectKey(key) {
		return errors.New("invalid attachment key")
	}
	return s.tryTrash(ctx, key)
}

func (s *TaskFlowDriveStorage) Delete(ctx context.Context, key string) {
	if err := s.DeleteObject(ctx, key); err != nil {
		slog.Warn("private Drive cleanup remains pending")
	}
}
func (s *TaskFlowDriveStorage) DeleteKeys(ctx context.Context, keys []string) {
	for _, k := range keys {
		s.Delete(ctx, k)
	}
}

var _ Storage = (*TaskFlowDriveStorage)(nil)

func ReadTaskFlowDriveUpload(r io.Reader, size int64) ([]byte, error) {
	if size < 0 || size > TaskFlowDriveMaxObjectBytes {
		return nil, errors.New("invalid attachment size")
	}
	b := make([]byte, int(size))
	if _, e := io.ReadFull(r, b); e != nil {
		return nil, e
	}
	var extra [1]byte
	n, e := r.Read(extra[:])
	if n != 0 || e != io.EOF {
		return nil, errors.New("attachment stream size mismatch")
	}
	return b, nil
}
