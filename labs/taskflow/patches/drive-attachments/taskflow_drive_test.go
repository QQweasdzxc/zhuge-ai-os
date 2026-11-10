package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type driveTokenTest struct{ fail bool }

func (t driveTokenTest) AccessToken(context.Context) (string, error) {
	if t.fail {
		return "", errors.New("revoked")
	}
	return "fixture-token", nil
}

type driveIndexTest struct {
	sync.Mutex
	m         map[string]TaskFlowDriveBinding
	failReady bool
}

func (i *driveIndexTest) Lookup(_ context.Context, k string) (TaskFlowDriveBinding, error) {
	i.Lock()
	defer i.Unlock()
	b, ok := i.m[k]
	if !ok {
		return b, os.ErrNotExist
	}
	return b, nil
}
func (i *driveIndexTest) Reserve(_ context.Context, b TaskFlowDriveBinding) (TaskFlowDriveBinding, error) {
	i.Lock()
	defer i.Unlock()
	if x, ok := i.m[b.Key]; ok {
		return x, nil
	}
	i.m[b.Key] = b
	return b, nil
}
func (i *driveIndexTest) MarkReady(_ context.Context, k string) error {
	i.Lock()
	defer i.Unlock()
	if i.failReady {
		return errors.New("ledger down")
	}
	b := i.m[k]
	b.Ready = true
	i.m[k] = b
	return nil
}
func (i *driveIndexTest) MarkDeleted(_ context.Context, k string) error {
	i.Lock()
	defer i.Unlock()
	b, ok := i.m[k]
	if !ok {
		return nil
	}
	b.Deleted = true
	i.m[k] = b
	return nil
}

type driveFixture struct {
	sync.Mutex
	body                                                            []byte
	uploads, ids                                                    int
	folderShared, fileShared, corrupt, missing, dropUpload, trashed bool
	status                                                          int
}

func (f *driveFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.Lock()
	defer f.Unlock()
	if r.Header.Get("Authorization") != "Bearer fixture-token" {
		http.Error(w, "unauth", 401)
		return
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	switch {
	case r.URL.Path == "/drive/v3/files/folder":
		json.NewEncoder(w).Encode(map[string]any{"id": "folder", "mimeType": "application/vnd.google-apps.folder", "trashed": false, "shared": f.folderShared, "ownedByMe": true})
	case strings.Contains(r.URL.Path, "generateIds"):
		f.ids++
		json.NewEncoder(w).Encode(map[string]any{"ids": []string{"generated-file"}})
	case strings.HasPrefix(r.URL.Path, "/upload/"):
		if f.body != nil {
			w.WriteHeader(409)
			return
		}
		_, p, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		m := multipart.NewReader(r.Body, p["boundary"])
		meta, _ := m.NextPart()
		var v map[string]any
		json.NewDecoder(meta).Decode(&v)
		if v["id"] != "generated-file" {
			http.Error(w, "ID missing", 400)
			return
		}
		data, e := m.NextPart()
		if e != nil {
			http.Error(w, "part missing", 400)
			return
		}
		f.body, _ = io.ReadAll(data)
		f.uploads++
		if f.dropUpload {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "generated-file"})
	case r.URL.Path == "/drive/v3/files/generated-file":
		if r.Method == http.MethodPatch {
			var v struct {
				Trashed bool `json:"trashed"`
			}
			json.NewDecoder(r.Body).Decode(&v)
			if !v.Trashed {
				w.WriteHeader(400)
				return
			}
			f.trashed = true
			json.NewEncoder(w).Encode(map[string]any{"id": "generated-file", "trashed": true})
			return
		}

		if f.missing || f.body == nil {
			w.WriteHeader(404)
			return
		}
		if r.URL.Query().Get("alt") == "media" {
			if f.corrupt {
				w.Write([]byte("corrupt"))
			} else {
				w.Write(f.body)
			}
			return
		}
		h := sha256.Sum256(f.body)
		json.NewEncoder(w).Encode(map[string]any{"id": "generated-file", "size": stringMustJSONLen(len(f.body)), "sha256Checksum": hex.EncodeToString(h[:]), "parents": []string{"folder"}, "shared": f.fileShared, "ownedByMe": true, "trashed": f.trashed})
	default:
		http.NotFound(w, r)
	}
}
func stringMustJSONLen(n int) string { b, _ := json.Marshal(n); return string(b) }
func fixtureDrive(t *testing.T) (*TaskFlowDriveStorage, *driveFixture, *driveIndexTest) {
	t.Helper()
	f := &driveFixture{}
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	i := &driveIndexTest{m: map[string]TaskFlowDriveBinding{}}
	s, e := NewTaskFlowDriveStorage(server.Client(), driveTokenTest{}, i, "folder")
	if e != nil {
		t.Fatal(e)
	}
	s.base = server.URL
	return s, f, i
}
func TestTaskFlowDrivePrivateRoundtrip(t *testing.T) {
	s, f, i := fixtureDrive(t)
	ctx := context.Background()
	key := "workspaces/ws/attachment.png"
	data := []byte("original file bytes")
	if raw, e := s.Upload(ctx, key, data, "image/png", "原圖.png"); e != nil || raw != "/uploads/"+key {
		t.Fatal(raw, e)
	}
	// Reconstruct the driver with only durable ledger and remote bytes.
	reopened, _ := NewTaskFlowDriveStorage(s.client, s.tokens, i, "folder")
	reopened.base = s.base
	r, e := reopened.GetReader(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	filename := r.(*taskFlowDriveReader).Name()
	b, _ := io.ReadAll(r)
	if !bytes.Equal(data, b) {
		t.Fatal("bytes changed")
	}
	if _, ok := r.(io.ReadSeeker); !ok {
		t.Fatal("range support lost")
	}
	r.Close()
	r.Close()
	if _, e = os.Stat(filename); !os.IsNotExist(e) {
		t.Fatal("temp retained")
	}
	if _, e = s.Upload(ctx, key, data, "image/png", "rename.png"); e != nil {
		t.Fatal(e)
	}
	if f.uploads != 1 || f.ids != 1 {
		t.Fatal("duplicate object created")
	}
	if _, e = s.Upload(ctx, key, []byte("changed"), "x", "x"); e == nil {
		t.Fatal("immutable overwrite allowed")
	}
	if e = s.DeleteObject(ctx, key); e == nil {
		t.Fatal("unapproved deletion falsely succeeded")
	}

	if f.body == nil {
		t.Fatal("original permanently deleted")
	}
}
func TestTaskFlowDriveAmbiguousUploadRetry(t *testing.T) {
	s, f, i := fixtureDrive(t)
	ctx := context.Background()
	key := "workspaces/ws/id"
	f.dropUpload = true
	if _, e := s.Upload(ctx, key, []byte("original"), "x", "x"); e == nil {
		t.Fatal("503 acknowledged")
	}
	f.dropUpload = false
	if _, e := s.Upload(ctx, key, []byte("original"), "x", "x"); e != nil {
		t.Fatal(e)
	}
	if f.uploads != 1 || f.ids != 1 {
		t.Fatal("retry duplicated bytes")
	}
	b, _ := i.Lookup(ctx, key)
	if !b.Ready {
		t.Fatal("ledger not ready")
	}
}
func TestTaskFlowDriveFailsClosed(t *testing.T) {
	for _, kind := range []string{"folder-share", "file-share", "missing", "corrupt", "revoked", "rate-limit", "ledger"} {
		t.Run(kind, func(t *testing.T) {
			s, f, i := fixtureDrive(t)
			ctx := context.Background()
			key := "workspaces/ws/id"
			if _, e := s.Upload(ctx, key, []byte("original"), "x", "x"); e != nil {
				t.Fatal(e)
			}
			switch kind {
			case "folder-share":
				f.folderShared = true
			case "file-share":
				f.fileShared = true
			case "missing":
				f.missing = true
			case "corrupt":
				f.corrupt = true
			case "revoked":
				s.tokens = driveTokenTest{true}
			case "rate-limit":
				f.status = 429
			case "ledger":
				i.Lock()
				b := i.m[key]
				b.Ready = false
				i.m[key] = b
				i.Unlock()
			}
			if r, e := s.GetReader(ctx, key); e == nil {
				r.Close()
				t.Fatal("unsafe bytes served")
			}
			wait, cancel := context.WithTimeout(ctx, time.Second)
			defer cancel()
			_, release, e := s.BeginTransfer(wait)
			if e != nil {
				t.Fatal("permit leaked", e)
			}
			release()
		})
	}
}
func TestTaskFlowDriveAdmissionAndRollback(t *testing.T) {
	s, _, _ := fixtureDrive(t)
	ctx := context.Background()
	_, release, _ := s.BeginTransfer(ctx)
	wait, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	if _, _, e := s.BeginTransfer(wait); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	release()
	s.SetReadOnly()
	if _, e := s.Upload(ctx, "workspaces/ws/id", []byte("a"), "x", "x"); !errors.Is(e, ErrTaskFlowDriveReadOnly) {
		t.Fatal(e)
	}
	if s.CdnDomain() != "" {
		t.Fatal("public URL advertised")
	}
}
