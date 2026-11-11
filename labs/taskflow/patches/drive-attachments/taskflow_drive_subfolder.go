package storage

// Task-number subfolders keep each task's attachments together inside the
// single authorized private root folder ("TRQN TF 附件" -> "TQ-103" -> file).
// Organization only: binding integrity (file ID/hash/size) is unchanged, and
// every serve still verifies the object stays private, owned, and under the
// authorized root tree.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type taskFlowDriveFolderLabelKey struct{}

// WithTaskFlowDriveFolderLabel carries the resolved issue identifier (for
// example "TQ-103") from the authenticated upload handler to Drive storage.
func WithTaskFlowDriveFolderLabel(ctx context.Context, label string) context.Context {
	return context.WithValue(ctx, taskFlowDriveFolderLabelKey{}, label)
}

// Valid labels look like issue identifiers: PREFIX-123. Anything else falls
// back to the root attachments folder rather than failing the upload.
func normalizeTaskFlowDriveFolderLabel(label string) string {
	label = strings.ToUpper(strings.TrimSpace(label))
	if len(label) < 3 || len(label) > 24 {
		return ""
	}
	dash := strings.LastIndexByte(label, '-')
	if dash < 1 || dash == len(label)-1 {
		return ""
	}
	for _, r := range label[:dash] {
		if !((r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-') {
			return ""
		}
	}
	for _, r := range label[dash+1:] {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return label
}

func taskFlowDriveFolderLabel(ctx context.Context) string {
	v, _ := ctx.Value(taskFlowDriveFolderLabelKey{}).(string)
	return normalizeTaskFlowDriveFolderLabel(v)
}

type driveFolderMeta struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Mime    string   `json:"mimeType"`
	Trashed bool     `json:"trashed"`
	Shared  *bool    `json:"shared"`
	Owned   bool     `json:"ownedByMe"`
	Parents []string `json:"parents"`
}

// A usable task folder is a private, owner-held direct child of the
// authorized root folder. Shared or foreign folders are never trusted to hold
// task attachments.
func (m driveFolderMeta) privateChildOf(root string) bool {
	if m.ID == "" || m.Mime != "application/vnd.google-apps.folder" || m.Trashed || m.Shared == nil || *m.Shared || !m.Owned {
		return false
	}
	for _, p := range m.Parents {
		if p == root {
			return true
		}
	}
	return false
}

func (s *TaskFlowDriveStorage) folderMeta(ctx context.Context, id string) (driveFolderMeta, error) {
	var m driveFolderMeta
	if !validDriveID(id) {
		return m, errors.New("invalid Drive folder ID")
	}
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+id+"?fields=id,mimeType,trashed,shared,ownedByMe,parents", nil, "")
	if e != nil {
		return m, e
	}
	defer closeDriveResponse(r)
	if r.StatusCode != 200 {
		return m, ErrTaskFlowDriveUnavailable
	}
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&m) != nil || m.ID != id {
		return m, ErrTaskFlowDriveUnavailable
	}
	return m, nil
}

// An object is acceptably placed when at least one parent is the authorized
// root folder itself or a verified private child folder of it. This covers
// new task-folder uploads and pre-existing root objects later filed under a
// task folder; the file ID/hash/size binding still pins the original bytes.
func (s *TaskFlowDriveStorage) authorizedParent(ctx context.Context, parents []string) bool {
	for _, p := range parents {
		if p == s.folder {
			return true
		}
	}
	for _, p := range parents {
		if m, e := s.folderMeta(ctx, p); e == nil && m.privateChildOf(s.folder) {
			return true
		}
	}
	return false
}

// ensureTaskFolder finds or creates the task-number subfolder under the
// authorized root. Lookups run before creation so a retry after a lost create
// response reuses the existing folder, and the single-transfer permit
// serializes creation within this process. An ambiguous or shared folder
// fails closed instead of mixing attachments into an untrusted location.
func (s *TaskFlowDriveStorage) ensureTaskFolder(ctx context.Context, label string) (string, error) {
	q := "'" + s.folder + "' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '" + label + "' and trashed = false"
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files?q="+url.QueryEscape(q)+"&pageSize=10&fields=files(id,name,mimeType,trashed,shared,ownedByMe,parents)", nil, "")
	if e != nil {
		return "", e
	}
	var list struct {
		Files []driveFolderMeta `json:"files"`
	}
	e = json.NewDecoder(io.LimitReader(r.Body, 65536)).Decode(&list)
	closeDriveResponse(r)
	if e != nil || r.StatusCode != 200 {
		return "", ErrTaskFlowDriveUnavailable
	}
	found := ""
	for _, f := range list.Files {
		if f.Name != label {
			continue
		}
		if !f.privateChildOf(s.folder) {
			return "", errors.New("task attachment folder is not a private child of the authorized root")
		}
		if found != "" {
			return "", errors.New("ambiguous task attachment folder; refusing to choose")
		}
		found = f.ID
	}
	if found != "" {
		return found, nil
	}
	id, e := s.generateID(ctx)
	if e != nil {
		return "", e
	}
	payload, _ := json.Marshal(map[string]any{"id": id, "name": label, "mimeType": "application/vnd.google-apps.folder", "parents": []string{s.folder}, "appProperties": map[string]string{"taskflow_private_attachments": "v1", "taskflow_task_folder": label}})
	r, e = s.request(ctx, http.MethodPost, "/drive/v3/files?fields=id", strings.NewReader(string(payload)), "application/json")
	if e != nil {
		return "", e
	}
	status := r.StatusCode
	closeDriveResponse(r)
	if status != 200 && status != 201 {
		return "", errors.New("task attachment folder creation incomplete")
	}
	m, e := s.folderMeta(ctx, id)
	if e != nil {
		return "", e
	}
	if !m.privateChildOf(s.folder) {
		return "", errors.New("created task attachment folder is not private and app-owned")
	}
	return id, nil
}
