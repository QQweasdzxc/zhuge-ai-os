package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
)

type driveUploadedFile struct {
	body    []byte
	parents []string
	trashed bool
}

type driveSubfolderFixture struct {
	sync.Mutex
	rootShared, folderShared, ambiguous, missing bool
	ids, creates, uploads, queries, moves        int
	folders                                      map[string]driveFolderMeta
	files                                        map[string]*driveUploadedFile
}

func sharedPtr(b bool) *bool { return &b }

func (f *driveSubfolderFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.Lock()
	defer f.Unlock()
	if r.Header.Get("Authorization") != "Bearer fixture-token" {
		http.Error(w, "unauth", 401)
		return
	}
	switch {
	case r.URL.Path == "/drive/v3/files/folder":
		json.NewEncoder(w).Encode(map[string]any{"id": "folder", "mimeType": "application/vnd.google-apps.folder", "trashed": false, "shared": f.rootShared, "ownedByMe": true})
	case r.URL.Path == "/drive/v3/files" && r.Method == http.MethodGet:
		f.queries++
		name := ""
		if m := regexp.MustCompile(`name = '([^']*)'`).FindStringSubmatch(r.URL.Query().Get("q")); len(m) == 2 {
			name = m[1]
		}
		out := []driveFolderMeta{}
		for _, fm := range f.folders {
			if fm.Name == name {
				out = append(out, fm)
			}
		}
		if f.ambiguous && name != "" {
			dup := driveFolderMeta{Mime: "application/vnd.google-apps.folder", Name: name, Owned: true, Shared: sharedPtr(false), Parents: []string{"folder"}}
			dup.ID = "dup-a"
			out = append(out, dup)
			dup.ID = "dup-b"
			out = append(out, dup)
		}
		json.NewEncoder(w).Encode(map[string]any{"files": out})
	case r.URL.Path == "/drive/v3/files" && r.Method == http.MethodPost:
		var v struct {
			ID      string   `json:"id"`
			Name    string   `json:"name"`
			Parents []string `json:"parents"`
		}
		if json.NewDecoder(r.Body).Decode(&v) != nil || v.ID == "" || v.Name == "" {
			http.Error(w, "bad folder create", 400)
			return
		}
		f.creates++
		f.folders[v.ID] = driveFolderMeta{ID: v.ID, Name: v.Name, Mime: "application/vnd.google-apps.folder", Parents: v.Parents, Owned: true, Shared: sharedPtr(f.folderShared)}
		json.NewEncoder(w).Encode(map[string]any{"id": v.ID})
	case strings.Contains(r.URL.Path, "generateIds"):
		f.ids++
		json.NewEncoder(w).Encode(map[string]any{"ids": []string{fmt.Sprintf("gen-%d", f.ids)}})
	case strings.HasPrefix(r.URL.Path, "/upload/"):
		_, p, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		m := multipart.NewReader(r.Body, p["boundary"])
		meta, _ := m.NextPart()
		var v struct {
			ID      string   `json:"id"`
			Parents []string `json:"parents"`
		}
		if json.NewDecoder(meta).Decode(&v) != nil || v.ID == "" {
			http.Error(w, "ID missing", 400)
			return
		}
		data, e := m.NextPart()
		if e != nil {
			http.Error(w, "part missing", 400)
			return
		}
		body, _ := io.ReadAll(data)
		f.files[v.ID] = &driveUploadedFile{body: body, parents: v.Parents}
		f.uploads++
		json.NewEncoder(w).Encode(map[string]any{"id": v.ID})
	case strings.HasPrefix(r.URL.Path, "/drive/v3/files/"):
		id := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
		if fm, ok := f.folders[id]; ok {
			json.NewEncoder(w).Encode(fm)
			return
		}
		up, ok := f.files[id]
		if !ok || f.missing || up.body == nil {
			w.WriteHeader(404)
			return
		}
		if r.Method == http.MethodPatch {
			if add := r.URL.Query().Get("addParents"); add != "" {
				keep := []string{}
				drop := map[string]bool{}
				for _, p := range strings.Split(r.URL.Query().Get("removeParents"), ",") {
					drop[p] = true
				}
				for _, p := range up.parents {
					if !drop[p] {
						keep = append(keep, p)
					}
				}
				up.parents = append(keep, add)
				f.moves++
				json.NewEncoder(w).Encode(map[string]any{"id": id, "parents": up.parents})
				return
			}
			up.trashed = true
			json.NewEncoder(w).Encode(map[string]any{"id": id, "trashed": true})
			return
		}
		if r.URL.Query().Get("alt") == "media" {
			w.Write(up.body)
			return
		}
		h := sha256.Sum256(up.body)
		json.NewEncoder(w).Encode(map[string]any{"id": id, "size": stringMustJSONLen(len(up.body)), "sha256Checksum": hex.EncodeToString(h[:]), "parents": up.parents, "shared": false, "ownedByMe": true, "trashed": up.trashed})
	default:
		http.NotFound(w, r)
	}
}

func (f *driveSubfolderFixture) fileIDFor(key string, i *driveIndexTest) string {
	f.Lock()
	defer f.Unlock()
	b, e := i.Lookup(context.Background(), key)
	if e != nil {
		return ""
	}
	return b.FileID
}

func fixtureDriveSubfolder(t *testing.T) (*TaskFlowDriveStorage, *driveSubfolderFixture, *driveIndexTest) {
	t.Helper()
	f := &driveSubfolderFixture{folders: map[string]driveFolderMeta{}, files: map[string]*driveUploadedFile{}}
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

func TestTaskFlowDriveTaskFolderUpload(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := WithTaskFlowDriveFolderLabel(context.Background(), "tq-103")
	data := []byte("business card bytes")
	if raw, e := s.Upload(ctx, "workspaces/ws/card.png", data, "image/png", "名片.png"); e != nil || raw != "/uploads/workspaces/ws/card.png" {
		t.Fatal(raw, e)
	}
	if f.creates != 1 || f.uploads != 1 {
		t.Fatal("expected one folder create and one upload", f.creates, f.uploads)
	}
	var folderID string
	for id, fm := range f.folders {
		if fm.Name != "TQ-103" || len(fm.Parents) != 1 || fm.Parents[0] != "folder" {
			t.Fatal("task folder misfiled", fm)
		}
		folderID = id
	}
	up := f.files[f.fileIDFor("workspaces/ws/card.png", i)]
	if up == nil || len(up.parents) != 1 || up.parents[0] != folderID {
		t.Fatal("file not placed in task folder", up)
	}
	b, _ := i.Lookup(ctx, "workspaces/ws/card.png")
	if b.FolderID != folderID || !b.Ready {
		t.Fatal("binding not pinned to task folder", b)
	}
	// Same key retry reuses the binding without a duplicate object or folder.
	if _, e := s.Upload(ctx, "workspaces/ws/card.png", data, "image/png", "rename.png"); e != nil {
		t.Fatal(e)
	}
	// A second attachment for the same task reuses the existing folder.
	if _, e := s.Upload(ctx, "workspaces/ws/other.png", []byte("other"), "image/png", "other.png"); e != nil {
		t.Fatal(e)
	}
	if f.creates != 1 || f.uploads != 2 {
		t.Fatal("folder not reused across task uploads", f.creates, f.uploads)
	}
	// Roundtrip from the task folder.
	r, e := s.GetReader(ctx, "workspaces/ws/card.png")
	if e != nil {
		t.Fatal(e)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != string(data) {
		t.Fatal("bytes changed")
	}
}

func TestTaskFlowDriveTaskFolderAmbiguousRefused(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	f.ambiguous = true
	ctx := WithTaskFlowDriveFolderLabel(context.Background(), "TQ-103")
	if _, e := s.Upload(ctx, "workspaces/ws/id", []byte("x"), "x", "x"); e == nil {
		t.Fatal("ambiguous task folder accepted")
	}
	if _, e := i.Lookup(ctx, "workspaces/ws/id"); e == nil {
		t.Fatal("binding reserved despite ambiguous folder")
	}
	if f.creates != 0 || f.uploads != 0 {
		t.Fatal("ambiguous folder wrote to Drive")
	}
}

func TestTaskFlowDriveTaskFolderSharedRefused(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	f.folderShared = true
	ctx := WithTaskFlowDriveFolderLabel(context.Background(), "TQ-103")
	if _, e := s.Upload(ctx, "workspaces/ws/id", []byte("x"), "x", "x"); e == nil {
		t.Fatal("shared task folder accepted")
	}
	if _, e := i.Lookup(ctx, "workspaces/ws/id"); e == nil {
		t.Fatal("binding reserved into shared folder")
	}
	if f.uploads != 0 {
		t.Fatal("bytes sent to shared folder")
	}
}

func TestTaskFlowDriveMovedLegacyObjectReadable(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	data := []byte("legacy root object")
	if _, e := s.Upload(ctx, "workspaces/ws/legacy.png", data, "image/png", "legacy.png"); e != nil {
		t.Fatal(e)
	}
	b, _ := i.Lookup(ctx, "workspaces/ws/legacy.png")
	if b.FolderID != "folder" {
		t.Fatal("legacy binding expected at root", b.FolderID)
	}
	// Later filed under a task folder in Drive: same file ID and bytes, new parent.
	f.folders["task-folder"] = driveFolderMeta{ID: "task-folder", Name: "TQ-103", Mime: "application/vnd.google-apps.folder", Parents: []string{"folder"}, Owned: true, Shared: sharedPtr(false)}
	f.files[f.fileIDFor("workspaces/ws/legacy.png", i)].parents = []string{"task-folder"}
	r, e := s.GetReader(ctx, "workspaces/ws/legacy.png")
	if e != nil {
		t.Fatal("moved original no longer readable", e)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != string(data) {
		t.Fatal("bytes changed")
	}
	// Placement outside the authorized tree is still refused.
	f.files[f.fileIDFor("workspaces/ws/legacy.png", i)].parents = []string{"someone-elses-folder"}
	if r, e = s.GetReader(ctx, "workspaces/ws/legacy.png"); e == nil {
		r.Close()
		t.Fatal("object outside authorized tree served")
	}
}

func TestTaskFlowDriveInvalidLabelUsesRoot(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	for _, label := range []string{"", "no-dash", "bad label!", "TQ-", "-103", strings.Repeat("A", 30) + "-1"} {
		ctx := WithTaskFlowDriveFolderLabel(context.Background(), label)
		key := "workspaces/ws/" + fmt.Sprintf("%d", len(label)) + ".bin"
		if _, e := s.Upload(ctx, key, []byte("x"), "x", "x"); e != nil {
			t.Fatal(label, e)
		}
		b, _ := i.Lookup(ctx, key)
		if b.FolderID != "folder" {
			t.Fatal("invalid label escaped root", label, b.FolderID)
		}
	}
	if f.creates != 0 {
		t.Fatal("invalid label created a folder")
	}
}

func TestTaskFlowDriveTaskFolderTrash(t *testing.T) {
	s, f, original := fixtureDriveSubfolder(t)
	ctx := WithTaskFlowDriveFolderLabel(context.Background(), "TQ-103")
	key := "workspaces/ws/id"
	if _, e := s.Upload(ctx, key, []byte("original"), "x", "x"); e != nil {
		t.Fatal(e)
	}
	q := &driveTrashTest{driveIndexTest: original, key: key, queued: true}
	s.index = q
	s.trashEnabled = true
	if e := s.DeleteObject(ctx, key); e != nil || !f.files[f.fileIDFor(key, original)].trashed || !q.done {
		t.Fatal("task-folder original not trashed", e)
	}
}
