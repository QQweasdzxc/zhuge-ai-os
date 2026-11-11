package storage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Outbox rows are created by the attachment DELETE transaction. The worker
// cannot manufacture a request to delete an arbitrary Drive file.
type TaskFlowDriveTrashIndex interface {
	PendingTrash(context.Context, int) ([]string, error)
	TrashBinding(context.Context, string) (TaskFlowDriveBinding, error)
	MarkTrashed(context.Context, string) error
}

func (i TaskFlowSQLDriveIndex) PendingTrash(ctx context.Context, limit int) ([]string, error) {
	var data []byte
	e := i.DB.QueryRow(ctx, `SELECT coalesce(json_agg(object_key),'[]'::json) FROM (SELECT object_key FROM taskflow.attachment_drive_delete_queue WHERE NOT done ORDER BY queued_at LIMIT $1)x`, limit).Scan(&data)
	if e != nil {
		return nil, e
	}
	var keys []string
	e = json.Unmarshal(data, &keys)
	return keys, e
}
func (i TaskFlowSQLDriveIndex) TrashBinding(ctx context.Context, key string) (TaskFlowDriveBinding, error) {
	b := TaskFlowDriveBinding{Key: key}
	e := i.DB.QueryRow(ctx, `SELECT file_id,sha256,folder_id,size_bytes,ready,deleted FROM taskflow.claim_drive_trash($1)`, key).Scan(&b.FileID, &b.SHA256, &b.FolderID, &b.Size, &b.Ready, &b.Deleted)
	return b, e
}
func (i TaskFlowSQLDriveIndex) MarkTrashed(ctx context.Context, key string) error {
	_, e := i.DB.Exec(ctx, `UPDATE taskflow.attachment_drive_delete_queue SET done=true,finished_at=clock_timestamp() WHERE object_key=$1`, key)
	return e
}
func (s *TaskFlowDriveStorage) tryTrash(ctx context.Context, key string) error {
	if !s.trashEnabled {
		return errors.New("Drive trash policy not enabled; original retained")
	}
	queue, ok := s.index.(TaskFlowDriveTrashIndex)
	if !ok {
		return errors.New("Drive transactional delete queue unavailable")
	}
	b, e := queue.TrashBinding(ctx, key)
	if e != nil {
		return errors.New("Drive delete is not queued or surviving reference exists")
	}
	if !b.Ready || !validDriveID(b.FolderID) || !validDriveID(b.FileID) {
		return errors.New("unsafe Drive delete binding")
	}
	if e = s.checkFolder(ctx); e != nil {
		return e
	}
	r, e := s.request(ctx, http.MethodGet, "/drive/v3/files/"+b.FileID+"?fields=id,size,sha256Checksum,parents,trashed,shared,ownedByMe", nil, "")
	if e != nil {
		return e
	}
	if r.StatusCode != 200 {
		closeDriveResponse(r)
		return ErrTaskFlowDriveUnavailable
	}
	var m driveObjectMeta
	e = json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&m)
	closeDriveResponse(r)
	if e != nil {
		return ErrTaskFlowDriveUnavailable
	}
	// The original must still sit under the authorized root tree (directly or
	// in its task subfolder) before it may be trashed.
	if m.ID != b.FileID || m.Shared == nil || *m.Shared || !m.Owned || m.SHA256 != b.SHA256 || m.Size != strconv.FormatInt(b.Size, 10) || !s.authorizedParent(ctx, m.Parents) {
		return errors.New("Drive trash refused: original ownership/integrity changed")
	}
	// The queue was committed with the native deletion. Only that unique original
	// is eligible; no Drive permanent-delete or empty-trash endpoint is used.
	if !m.Trashed {
		r, e = s.request(ctx, http.MethodPatch, "/drive/v3/files/"+b.FileID+"?fields=id,trashed", strings.NewReader(`{"trashed":true}`), "application/json")
		if e != nil {
			return e
		}
		if r.StatusCode != 200 {
			closeDriveResponse(r)
			return ErrTaskFlowDriveUnavailable
		}
		var result struct {
			ID      string `json:"id"`
			Trashed bool   `json:"trashed"`
		}
		e = json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&result)
		closeDriveResponse(r)
		if e != nil || result.ID != b.FileID || !result.Trashed {
			return ErrTaskFlowDriveUnavailable
		}
	}
	if e = s.index.MarkDeleted(ctx, key); e != nil {
		return e
	}
	return queue.MarkTrashed(ctx, key)
}
func (s *TaskFlowDriveStorage) RunTrashWorker(ctx context.Context) {
	if !s.trashEnabled || s.readOnly {
		return
	}
	queue, ok := s.index.(TaskFlowDriveTrashIndex)
	if !ok {
		return
	}
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		cycle, cancel := context.WithTimeout(ctx, 45*time.Second)
		keys, e := queue.PendingTrash(cycle, 10)
		if e == nil {
			for _, key := range keys {
				if e = s.tryTrash(cycle, key); e != nil {
					slog.Warn("private Drive cleanup remains pending")
				}
			}
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
