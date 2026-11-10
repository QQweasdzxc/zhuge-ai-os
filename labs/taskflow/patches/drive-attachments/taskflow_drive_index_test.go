package storage

import (
	"bytes"
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
)

func TestTaskFlowDriveSQLLedger(t *testing.T) {
	dsn := os.Getenv("TASKFLOW_DRIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated Drive ledger database required")
	}
	ctx := context.Background()
	p, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	if _, e = p.Exec(ctx, "TRUNCATE taskflow.attachment_drive_object,taskflow.attachment_drive_setup_state,taskflow.attachment_drive_grant,taskflow.attachment_drive_folder,taskflow.attachment CASCADE"); e != nil {
		t.Fatal(e)
	}
	runtimeCfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	runtimeCfg.ConnConfig.RuntimeParams["role"] = "taskflow_runtime"
	runtime, e := pgxpool.NewWithConfig(ctx, runtimeCfg)
	if e != nil {
		t.Fatal(e)
	}
	defer runtime.Close()
	i := TaskFlowSQLDriveIndex{runtime}
	setup := TaskFlowSQLDriveSetup{runtime}
	if f, e := setup.ReserveFolder(ctx, "first-folder"); e != nil || f != "first-folder" {
		t.Fatal("folder reserve", e)
	}
	if f, e := setup.ReserveFolder(ctx, "second-folder"); e != nil || f != "first-folder" {
		t.Fatal("folder reservation changed", e)
	}
	if _, e := runtime.Exec(ctx, "UPDATE taskflow.attachment_drive_folder SET file_id='replacement'"); e == nil {
		t.Fatal("folder replacement allowed")
	}
	hash := strings.Repeat("a", 64)
	verifier := bytes.Repeat([]byte{42}, 64)
	if e = setup.Issue(ctx, hash, time.Now().Add(time.Minute), verifier); e != nil {
		t.Fatal(e)
	}
	if v, e := setup.Claim(ctx, hash, time.Now()); e != nil || !bytes.Equal(v, verifier) {
		t.Fatal("state claim", e)
	}
	if _, e = setup.Claim(ctx, hash, time.Now()); e == nil {
		t.Fatal("state replay allowed")
	}
	sealed := bytes.Repeat([]byte{7}, 80)
	if e = setup.SaveGrant(ctx, sealed, "owner@example.invalid"); e != nil {
		t.Fatal(e)
	}
	if b, owner, e := setup.LoadGrant(ctx); e != nil || owner != "owner@example.invalid" || !bytes.Equal(b, sealed) {
		t.Fatal("grant store", e)
	}

	b := TaskFlowDriveBinding{Key: "workspaces/ws/key", FileID: "first-file", FolderID: "folder", SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Size: 8}
	got, e := i.Reserve(ctx, b)
	if e != nil || got.FileID != b.FileID || got.Ready {
		t.Fatal("reserve", got, e)
	}
	other := b
	other.FileID = "replacement"
	got, e = i.Reserve(ctx, other)
	if e != nil || got.FileID != "first-file" {
		t.Fatal("immutable retry failed", got, e)
	}
	if e = i.MarkReady(ctx, b.Key); e != nil {
		t.Fatal(e)
	}
	got, e = i.Lookup(ctx, b.Key)
	if e != nil || !got.Ready {
		t.Fatal(e)
	}
	for _, q := range []string{"UPDATE taskflow.attachment_drive_object SET file_id='changed'", "DELETE FROM taskflow.attachment_drive_object", "ALTER TABLE taskflow.attachment_drive_object ADD COLUMN x text"} {
		if _, e = runtime.Exec(ctx, q); e == nil {
			t.Fatal("runtime exceeded authority", q)
		}
	}

	// Queue is created by the native attachment deletion transaction, never by
	// arbitrary runtime INSERT, and rolls back together with a failed delete.
	if _, e = runtime.Exec(ctx, "INSERT INTO taskflow.attachment_drive_delete_queue(object_key) VALUES($1)", b.Key); e == nil {
		t.Fatal("runtime manufactured deletion authority")
	}
	if _, e = runtime.Exec(ctx, "INSERT INTO taskflow.attachment(id,url) VALUES('a',$1),('b',$1)", "/uploads/"+b.Key); e != nil {
		t.Fatal(e)
	}
	tx, e := runtime.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, "DELETE FROM taskflow.attachment WHERE id='a'"); e != nil {
		t.Fatal(e)
	}
	tx.Rollback(ctx)
	keys, e := i.PendingTrash(ctx, 10)
	if e != nil || len(keys) != 0 {
		t.Fatal("rollback leaked trash request", e, keys)
	}
	if _, e = runtime.Exec(ctx, "DELETE FROM taskflow.attachment WHERE id='a'"); e != nil {
		t.Fatal(e)
	}
	if _, e = i.TrashBinding(ctx, b.Key); e == nil {
		t.Fatal("surviving attachment reference eligible for trash")
	}
	if _, e = runtime.Exec(ctx, "DELETE FROM taskflow.attachment WHERE id='b'"); e != nil {
		t.Fatal(e)
	}
	pending, e := i.TrashBinding(ctx, b.Key)
	if e != nil || pending.FileID != b.FileID {
		t.Fatal("committed native delete not queued", e)
	}
	if _, e = runtime.Exec(ctx, "INSERT INTO taskflow.attachment(id,url) VALUES('late',$1)", "/uploads/"+b.Key); e == nil {
		t.Fatal("new reference raced into claimed trash")
	}
	if e = i.MarkTrashed(ctx, b.Key); e != nil {
		t.Fatal(e)
	}
	keys, e = i.PendingTrash(ctx, 10)
	if e != nil || len(keys) != 0 {
		t.Fatal("completed trash repeated", e)
	}
	if e = i.MarkDeleted(ctx, b.Key); e != nil {
		t.Fatal(e)
	}
	if _, e = runtime.Exec(ctx, "UPDATE taskflow.attachment_drive_object SET deleted=false"); e == nil {
		t.Fatal("deleted key resurrected")
	}
	if e = i.MarkReady(ctx, b.Key); e == nil {
		t.Fatal("deleted key accepted")
	}
	if _, e = i.Lookup(ctx, "workspaces/ws/missing"); !errors.Is(e, os.ErrNotExist) {
		t.Fatal(e)
	}
	for _, role := range []string{"anon", "authenticated"} {
		cfg, _ := pgxpool.ParseConfig(dsn)
		cfg.ConnConfig.RuntimeParams["role"] = role
		r, e := pgxpool.NewWithConfig(ctx, cfg)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = r.Exec(ctx, "SELECT * FROM taskflow.attachment_drive_grant"); e == nil {
			t.Fatal("API role read private ledger", role)
		}
		r.Close()
	}
}
