package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/multica-ai/multica/server/internal/storage"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
)

type nativeDriveToken struct{}

func (nativeDriveToken) AccessToken(context.Context) (string, error) { return "fixture-access", nil }

type nativeDriveTransport struct {
	target *url.URL
	http.RoundTripper
}

func (t nativeDriveTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c := r.Clone(r.Context())
	u := *r.URL
	u.Scheme = t.target.Scheme
	u.Host = t.target.Host
	c.URL = &u
	c.Host = t.target.Host
	return t.RoundTripper.RoundTrip(c)
}

type nativeDriveIndex struct {
	sync.Mutex
	rows map[string]storage.TaskFlowDriveBinding
}

func (i *nativeDriveIndex) Lookup(_ context.Context, k string) (storage.TaskFlowDriveBinding, error) {
	i.Lock()
	defer i.Unlock()
	b, ok := i.rows[k]
	if !ok {
		return b, os.ErrNotExist
	}
	return b, nil
}
func (i *nativeDriveIndex) Reserve(_ context.Context, b storage.TaskFlowDriveBinding) (storage.TaskFlowDriveBinding, error) {
	i.Lock()
	defer i.Unlock()
	if prior, ok := i.rows[b.Key]; ok {
		return prior, nil
	}
	i.rows[b.Key] = b
	return b, nil
}
func (i *nativeDriveIndex) MarkReady(_ context.Context, k string) error {
	i.Lock()
	defer i.Unlock()
	b, ok := i.rows[k]
	if !ok {
		return errors.New("missing binding")
	}
	b.Ready = true
	i.rows[k] = b
	return nil
}
func (i *nativeDriveIndex) MarkDeleted(_ context.Context, k string) error {
	i.Lock()
	defer i.Unlock()
	b := i.rows[k]
	b.Deleted = true
	i.rows[k] = b
	return nil
}

type nativeDriveRemote struct {
	sync.Mutex
	dir           string
	count, status int
	hashes        map[string]string
	sizes         map[string]int64
	folders       map[string]map[string]any
	parents       map[string][]string
}

func (d *nativeDriveRemote) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.Lock()
	defer d.Unlock()
	if d.status != 0 {
		w.WriteHeader(d.status)
		return
	}
	if r.Header.Get("Authorization") != "Bearer fixture-access" {
		w.WriteHeader(401)
		return
	}
	if strings.Contains(r.URL.Path, "generateIds") {
		d.count++
		json.NewEncoder(w).Encode(map[string]any{"ids": []string{fmt.Sprintf("fixture-%d", d.count)}})
		return
	}
	if r.URL.Path == "/drive/v3/files/folder" {
		json.NewEncoder(w).Encode(map[string]any{"id": "folder", "mimeType": "application/vnd.google-apps.folder", "trashed": false, "shared": false, "ownedByMe": true})
		return
	}
	if r.URL.Path == "/drive/v3/files" {
		switch r.Method {
		case http.MethodGet:
			match := regexp.MustCompile(`name = '([^']*)'`).FindStringSubmatch(r.URL.Query().Get("q"))
			out := []map[string]any{}
			if len(match) == 2 {
				for _, folder := range d.folders {
					if folder["name"] == match[1] {
						out = append(out, folder)
					}
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"files": out})
		case http.MethodPost:
			var meta struct {
				ID      string   `json:"id"`
				Name    string   `json:"name"`
				Mime    string   `json:"mimeType"`
				Parents []string `json:"parents"`
			}
			if json.NewDecoder(r.Body).Decode(&meta) != nil || meta.ID == "" || meta.Name == "" || meta.Mime != "application/vnd.google-apps.folder" || len(meta.Parents) != 1 || meta.Parents[0] != "folder" {
				http.Error(w, "invalid private task folder", 400)
				return
			}
			d.folders[meta.ID] = map[string]any{"id": meta.ID, "name": meta.Name, "mimeType": meta.Mime, "parents": meta.Parents, "shared": false, "ownedByMe": true, "trashed": false}
			json.NewEncoder(w).Encode(map[string]any{"id": meta.ID})
		default:
			http.Error(w, "unexpected folder method", 405)
		}
		return
	}
	if folder, ok := d.folders[strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")]; ok {
		json.NewEncoder(w).Encode(folder)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/upload/") {
		_, params, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if e != nil {
			w.WriteHeader(400)
			return
		}
		m := multipart.NewReader(r.Body, params["boundary"])
		p, e := m.NextPart()
		if e != nil {
			w.WriteHeader(400)
			return
		}
		var meta struct {
			ID      string   `json:"id"`
			Parents []string `json:"parents"`
		}
		if json.NewDecoder(p).Decode(&meta) != nil || !strings.HasPrefix(meta.ID, "fixture-") {
			w.WriteHeader(400)
			return
		}
		if _, exists := d.hashes[meta.ID]; exists {
			w.WriteHeader(409)
			return
		}
		p, e = m.NextPart()
		if e != nil {
			w.WriteHeader(400)
			return
		}
		f, e := os.Create(d.dir + "/" + meta.ID)
		if e != nil {
			w.WriteHeader(500)
			return
		}
		h := sha256.New()
		n, e := io.Copy(io.MultiWriter(f, h), p)
		f.Close()
		if e != nil {
			w.WriteHeader(500)
			return
		}
		d.hashes[meta.ID] = hex.EncodeToString(h.Sum(nil))
		d.sizes[meta.ID] = n
		d.parents[meta.ID] = meta.Parents
		json.NewEncoder(w).Encode(map[string]any{"id": meta.ID})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
	hash, ok := d.hashes[id]
	if !ok {
		w.WriteHeader(404)
		return
	}
	if r.Method == http.MethodPatch {
		add := r.URL.Query().Get("addParents")
		if _, ok := d.folders[add]; !ok {
			http.Error(w, "unknown task folder", 400)
			return
		}
		drop := map[string]bool{}
		for _, p := range strings.Split(r.URL.Query().Get("removeParents"), ",") {
			drop[p] = true
		}
		keep := []string{}
		for _, p := range d.parents[id] {
			if !drop[p] {
				keep = append(keep, p)
			}
		}
		d.parents[id] = append(keep, add)
		json.NewEncoder(w).Encode(map[string]any{"id": id, "parents": d.parents[id]})
		return
	}
	if r.URL.Query().Get("alt") == "media" {
		f, e := os.Open(d.dir + "/" + id)
		if e != nil {
			w.WriteHeader(500)
			return
		}
		defer f.Close()
		io.Copy(w, f)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"id": id, "size": strconv.FormatInt(d.sizes[id], 10), "sha256Checksum": hash, "parents": d.parents[id], "shared": false, "ownedByMe": true, "trashed": false})
}
func nativeDriveFixture(t *testing.T) (*storage.TaskFlowDriveStorage, *nativeDriveRemote, *nativeDriveIndex, *http.Client) {
	t.Helper()
	remote := &nativeDriveRemote{dir: t.TempDir(), hashes: map[string]string{}, sizes: map[string]int64{}, folders: map[string]map[string]any{}, parents: map[string][]string{}}
	server := httptest.NewServer(remote)
	t.Cleanup(server.Close)
	target, _ := url.Parse(server.URL)
	client := &http.Client{Transport: nativeDriveTransport{target, server.Client().Transport}}
	index := &nativeDriveIndex{rows: map[string]storage.TaskFlowDriveBinding{}}
	store, e := storage.NewTaskFlowDriveStorage(client, nativeDriveToken{}, index, "folder")
	if e != nil {
		t.Fatal(e)
	}
	return store, remote, index, client
}
func TestTaskFlowDriveNativeAttachmentHTTP(t *testing.T) {
	original := testHandler.Storage
	defer func() { testHandler.Storage = original }()
	store, remote, index, client := nativeDriveFixture(t)
	testHandler.Storage = store
	issue := createIssueForTest(t, map[string]any{"title": "isolated Drive native roundtrip", "status": "backlog"})
	data := []byte("original private Drive attachment")
	upload := func(name string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		m := multipart.NewWriter(&body)
		p, _ := m.CreateFormFile("file", name)
		p.Write(data)
		m.WriteField("issue_id", issue.ID)
		m.Close()
		req := httptest.NewRequest("POST", "/api/upload-file", &body)
		req.Header.Set("Content-Type", m.FormDataContentType())
		req.Header.Set("X-User-ID", testUserID)
		req.Header.Set("X-Workspace-ID", testWorkspaceID)
		w := httptest.NewRecorder()
		testHandler.UploadFile(w, req)
		return w
	}
	w := upload("private-original.txt")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var a AttachmentResponse
	if e := json.Unmarshal(w.Body.Bytes(), &a); e != nil {
		t.Fatal(e)
	}
	if a.ID == "" || a.SizeBytes != int64(len(data)) || a.IssueID == nil || *a.IssueID != issue.ID {
		t.Fatal("native row mismatch", a)
	}
	remote.Lock()
	if len(remote.folders) != 1 {
		t.Fatalf("expected one task folder, got %d", len(remote.folders))
	}
	for id, folder := range remote.folders {
		if folder["name"] != issue.Identifier {
			t.Fatalf("wrong task folder: %v", folder)
		}
		for _, parents := range remote.parents {
			if len(parents) != 1 || parents[0] != id {
				t.Fatalf("upload not filed under task: %v", parents)
			}
		}
	}
	remote.Unlock()
	// Only the remote objects and index survive a reconstructed backend.
	reopened, e := storage.NewTaskFlowDriveStorage(client, nativeDriveToken{}, index, "folder")
	if e != nil {
		t.Fatal(e)
	}
	testHandler.Storage = reopened
	request := func(user, rangeHeader string) *httptest.ResponseRecorder {
		r := withURLParam(httptest.NewRequest("GET", "/api/attachments/"+a.ID+"/download", nil), "id", a.ID)
		if user != "" {
			r.Header.Set("X-User-ID", user)
		}
		if rangeHeader != "" {
			r.Header.Set("Range", rangeHeader)
		}
		w := httptest.NewRecorder()
		testHandler.DownloadAttachment(w, r)
		return w
	}
	w = request(testUserID, "")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("reopened original not private/exact", w.Code)
	}
	w = request(testUserID, "bytes=0-7")
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), data[:8]) {
		t.Fatal("range failed", w.Code)
	}
	if w = request("", ""); w.Code != 401 {
		t.Fatal("anonymous served", w.Code)
	}
	if w = request("00000000-0000-0000-0000-000000000099", ""); w.Code != 404 {
		t.Fatal("nonmember served", w.Code)
	}
	r := httptest.NewRequest("GET", a.URL, nil)
	w = httptest.NewRecorder()
	testHandler.ServeLocalUpload(w, r)
	if w.Code != 404 {
		t.Fatal("raw Drive object served publicly", w.Code)
	}
	remote.Lock()
	remote.status = 401
	remote.Unlock()
	if w = request(testUserID, ""); w.Code != 503 {
		t.Fatal("revoked connection misreported", w.Code, w.Body.String())
	}
	remote.Lock()
	remote.status = 0
	remote.Unlock()
	reopened.SetReadOnly()
	if w = upload("maintenance.txt"); w.Code != 503 {
		t.Fatal("readonly accepted upload", w.Code)
	}
	if w = request(testUserID, ""); w.Code != 200 {
		t.Fatal("readonly lost original", w.Code)
	}
}
func TestTaskFlowDriveSetupOwnerGuard(t *testing.T) {
	for _, kind := range []string{"anonymous", "wrong-owner", "machine", "bearer", "disabled"} {
		t.Run(kind, func(t *testing.T) {
			t.Setenv("TASKFLOW_DRIVE_SETUP_OWNER_USER_ID", testUserID)
			t.Setenv("TASKFLOW_DRIVE_SETUP_ENABLED", "0")
			r := httptest.NewRequest("POST", "/api/taskflow-drive/setup", nil)
			if kind != "anonymous" {
				r.Header.Set("X-User-ID", testUserID)
			}
			want := 403
			switch kind {
			case "anonymous":
				want = 401
			case "wrong-owner":
				r.Header.Set("X-User-ID", "wrong")
			case "machine":
				r.Header.Set("X-Actor-Source", "task_token")
			case "bearer":
				r.Header.Set("Authorization", "Bearer fixture")
			case "disabled":
				want = 503
			}
			w := httptest.NewRecorder()
			testHandler.StartTaskFlowDriveSetup(w, r)
			if w.Code != want {
				t.Fatal(kind, w.Code, w.Body.String())
			}
		})
	}
}

func TestTaskFlowDriveLargeNativeUploads(t *testing.T) {
	original := testHandler.Storage
	defer func() { testHandler.Storage = original }()
	store, remote, _, _ := nativeDriveFixture(t)
	testHandler.Storage = store
	issue := createIssueForTest(t, map[string]any{"title": "isolated Drive concurrent large uploads", "status": "backlog"})
	var wg sync.WaitGroup
	for n := 0; n < 3; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f, e := os.CreateTemp("", "tf-drive-http-large-*")
			if e != nil {
				t.Error(e)
				return
			}
			defer f.Close()
			defer os.Remove(f.Name())
			m := multipart.NewWriter(f)
			p, e := m.CreateFormFile("file", "isolated-large.bin")
			if e != nil {
				t.Error(e)
				return
			}
			chunk := bytes.Repeat([]byte{0x4b}, 1<<20)
			for i := 0; i < 80; i++ {
				if _, e = p.Write(chunk); e != nil {
					t.Error(e)
					return
				}
			}
			m.WriteField("issue_id", issue.ID)
			m.Close()
			f.Seek(0, 0)
			req := httptest.NewRequest("POST", "/api/upload-file", f)
			req.Header.Set("Content-Type", m.FormDataContentType())
			req.Header.Set("X-User-ID", testUserID)
			req.Header.Set("X-Workspace-ID", testWorkspaceID)
			w := httptest.NewRecorder()
			testHandler.UploadFile(w, req)
			if w.Code != 200 {
				t.Errorf("large native upload=%d %s", w.Code, w.Body.String())
			}
		}()
	}
	wg.Wait()
	remote.Lock()
	defer remote.Unlock()
	if len(remote.hashes) != 3 {
		t.Fatal("lost concurrent object", len(remote.hashes))
	}
	if len(remote.folders) != 1 {
		t.Fatalf("concurrent uploads created %d task folders", len(remote.folders))
	}
	for id := range remote.hashes {
		parents := remote.parents[id]
		if len(parents) != 1 || remote.folders[parents[0]]["name"] != issue.Identifier {
			t.Fatalf("concurrent upload filed incorrectly: %s %v", id, parents)
		}
	}
	for _, size := range remote.sizes {
		if size != 80*1024*1024 {
			t.Fatal("truncated original", size)
		}
	}
}
