package storage

// Issue drafts and description-editor uploads carry no task number yet (the
// issue does not exist, or the client deliberately uploads first to avoid
// orphans), so those files start at the authorized root. Once the server
// binds them to an issue, FileUnderTaskFolder files them under the task's
// subfolder. Organization only: the immutable binding (file ID/hash/size)
// is untouched and every serve still verifies private ownership and
// placement under the authorized tree.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// FileUnderTaskFolder moves a ready Drive attachment into the task-number
// subfolder. Unknown, unready, or deleted keys are a no-op so the post-bind
// sweep can run unconditionally. A file with any parent outside the
// authorized root tree is left untouched (fail closed).
func (s *TaskFlowDriveStorage) FileUnderTaskFolder(ctx context.Context, key, label string) error {
	label = normalizeTaskFlowDriveFolderLabel(label)
	if !validTaskFlowDriveObjectKey(key) || label == "" {
		return errors.New("invalid attachment key or task label")
	}
	return s.fileUnderPrivateFolder(ctx, key, label)
}

// FileWorkspaceIcon is deliberately separate from user-supplied task labels.
func (s *TaskFlowDriveStorage) FileWorkspaceIcon(ctx context.Context, key string) error {
	if !validTaskFlowDriveObjectKey(key) {
		return errors.New("invalid workspace icon key")
	}
	return s.fileUnderPrivateFolder(ctx, key, WorkspaceIconFolderName)
}

func (s *TaskFlowDriveStorage) fileUnderPrivateFolder(ctx context.Context, key, label string) error {
	if s.readOnly {
		return errors.New("Drive storage is read-only")
	}
	ctx, release, err := s.BeginTransfer(ctx)
	if err != nil {
		return err
	}
	defer release()
	if v, ok := s.filed.Load(key); ok && v == label {
		return nil
	}
	b, e := s.index.Lookup(ctx, key)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	if e != nil {
		return ErrTaskFlowDriveUnavailable
	}
	if b.Deleted || !b.Ready || !validDriveID(b.FileID) {
		return nil
	}
	target, e := s.ensurePrivateFolder(ctx, label)
	if e != nil {
		return e
	}
	// Bound into this folder at upload time already; nothing to do.
	if b.FolderID == target {
		s.filed.Store(key, label)
		return nil
	}
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+b.FileID+"?fields=id,trashed,shared,ownedByMe,parents", nil, "")
	if e != nil {
		return e
	}
	defer closeDriveResponse(r)
	if r.StatusCode != 200 {
		return ErrTaskFlowDriveUnavailable
	}
	var m driveObjectMeta
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&m) != nil || m.ID != b.FileID {
		return ErrTaskFlowDriveUnavailable
	}
	if m.Trashed || m.Shared == nil || *m.Shared || !m.Owned {
		return ErrTaskFlowDriveMissing
	}
	for _, p := range m.Parents {
		if p == target {
			s.filed.Store(key, label)
			return nil
		}
	}
	// Only parents inside the authorized tree are replaced; any other parent
	// means the object was deliberately placed elsewhere and stays untouched.
	for _, p := range m.Parents {
		if p == s.folder {
			continue
		}
		pm, e := s.folderMeta(ctx, p)
		if e != nil || !pm.privateChildOf(s.folder) {
			return errors.New("attachment has a parent outside the authorized attachments tree")
		}
	}
	q := "addParents=" + url.QueryEscape(target) + "&removeParents=" + url.QueryEscape(strings.Join(m.Parents, ",")) + "&fields=id,parents"
	r2, e := s.request(ctx, http.MethodPatch, "/drive/v3/files/"+b.FileID+"?"+q, strings.NewReader("{}"), "application/json")
	if e != nil {
		return e
	}
	status := r2.StatusCode
	closeDriveResponse(r2)
	if status != 200 {
		return ErrTaskFlowDriveUnavailable
	}
	if e = s.verifyMeta(ctx, b); e != nil {
		return e
	}
	s.filed.Store(key, label)
	return nil
}

// FilingWarned reports whether this key's one filing-failure comment was
// already posted (or safely deduplicated) this process.
func (s *TaskFlowDriveStorage) FilingWarned(key string) bool {
	_, ok := s.filingWarned.Load(key)
	return ok
}

// MarkFilingWarned suppresses any further filing-failure comment for a key.
func (s *TaskFlowDriveStorage) MarkFilingWarned(key string) {
	s.filingWarned.Store(key, true)
}
