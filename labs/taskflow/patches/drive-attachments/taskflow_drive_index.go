package storage

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"os"
)

type TaskFlowDriveDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}
type TaskFlowSQLDriveIndex struct{ DB TaskFlowDriveDB }

func (i TaskFlowSQLDriveIndex) Lookup(ctx context.Context, key string) (TaskFlowDriveBinding, error) {
	b := TaskFlowDriveBinding{Key: key}
	e := i.DB.QueryRow(ctx, `SELECT file_id,sha256,folder_id,size_bytes,ready,deleted FROM taskflow.attachment_drive_object WHERE object_key=$1`, key).Scan(&b.FileID, &b.SHA256, &b.FolderID, &b.Size, &b.Ready, &b.Deleted)
	if errors.Is(e, pgx.ErrNoRows) {
		return b, os.ErrNotExist
	}
	return b, e
}
func (i TaskFlowSQLDriveIndex) Reserve(ctx context.Context, b TaskFlowDriveBinding) (TaskFlowDriveBinding, error) {
	_, e := i.DB.Exec(ctx, `INSERT INTO taskflow.attachment_drive_object(object_key,file_id,sha256,folder_id,size_bytes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_key) DO NOTHING`, b.Key, b.FileID, b.SHA256, b.FolderID, b.Size)
	if e != nil {
		return TaskFlowDriveBinding{}, e
	}
	return i.Lookup(ctx, b.Key)
}
func (i TaskFlowSQLDriveIndex) MarkReady(ctx context.Context, key string) error {
	r, e := i.DB.Exec(ctx, `UPDATE taskflow.attachment_drive_object SET ready=true WHERE object_key=$1 AND NOT deleted`, key)
	if e == nil && r.RowsAffected() != 1 {
		return errors.New("attachment Drive binding not active")
	}
	return e
}
func (i TaskFlowSQLDriveIndex) MarkDeleted(ctx context.Context, key string) error {
	_, e := i.DB.Exec(ctx, `UPDATE taskflow.attachment_drive_object SET deleted=true WHERE object_key=$1`, key)
	return e
}
