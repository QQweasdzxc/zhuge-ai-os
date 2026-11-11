package storage

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestTaskFlowDriveFileUnderTaskFolderMove(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	data := []byte("draft upload bytes")
	// Issue-draft upload: no task label yet, so it lands at the root.
	if _, e := s.Upload(ctx, "workspaces/ws/draft.png", data, "image/png", "draft.png"); e != nil {
		t.Fatal(e)
	}
	b, _ := i.Lookup(ctx, "workspaces/ws/draft.png")
	if b.FolderID != "folder" {
		t.Fatal("draft binding expected at root", b.FolderID)
	}
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/draft.png", "tq-103"); e != nil {
		t.Fatal(e)
	}
	if f.creates != 1 || f.moves != 1 {
		t.Fatal("expected one folder create and one move", f.creates, f.moves)
	}
	var folderID string
	for id, fm := range f.folders {
		if fm.Name == "TQ-103" {
			folderID = id
		}
	}
	up := f.files[f.fileIDFor("workspaces/ws/draft.png", i)]
	if folderID == "" || len(up.parents) != 1 || up.parents[0] != folderID {
		t.Fatal("file not filed under task folder", up.parents)
	}
	// The immutable binding still pins the original reservation folder.
	b, _ = i.Lookup(ctx, "workspaces/ws/draft.png")
	if b.FolderID != "folder" {
		t.Fatal("binding folder mutated", b.FolderID)
	}
	// Serve path still verifies and returns the same bytes after the move.
	r, e := s.GetReader(ctx, "workspaces/ws/draft.png")
	if e != nil {
		t.Fatal(e)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != string(data) {
		t.Fatal("bytes changed after move")
	}
	// Repeat filing is a no-op: folder already held, and the filed cache
	// skips even the Drive folder lookup.
	queries := f.queries
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/draft.png", "TQ-103"); e != nil {
		t.Fatal(e)
	}
	if f.moves != 1 || f.creates != 1 || f.queries != queries {
		t.Fatal("repeat filing wrote to Drive", f.moves, f.creates, f.queries, queries)
	}
}

func TestTaskFlowDriveFileUnderTaskFolderForeignParentRefused(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	if _, e := s.Upload(ctx, "workspaces/ws/x.png", []byte("x"), "x", "x"); e != nil {
		t.Fatal(e)
	}
	f.files[f.fileIDFor("workspaces/ws/x.png", i)].parents = []string{"someone-elses-folder"}
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/x.png", "TQ-103"); e == nil {
		t.Fatal("foreign-parent attachment moved")
	}
	if f.moves != 0 {
		t.Fatal("Drive move issued for foreign-parent attachment")
	}
}

func TestTaskFlowDriveFileUnderTaskFolderNoops(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	// Unknown key: not a Drive-bound object, nothing to file.
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/absent.png", "TQ-103"); e != nil {
		t.Fatal(e)
	}
	// Invalid label: rejected before any Drive call.
	if _, e := s.Upload(ctx, "workspaces/ws/y.png", []byte("y"), "y", "y"); e != nil {
		t.Fatal(e)
	}
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/y.png", "bad label!"); e == nil {
		t.Fatal("invalid label accepted")
	}
	// Upload bound into the task folder from the start: filing is a no-op.
	lctx := WithTaskFlowDriveFolderLabel(ctx, "TQ-103")
	if _, e := s.Upload(lctx, "workspaces/ws/z.png", []byte("z"), "z", "z"); e != nil {
		t.Fatal(e)
	}
	if e := s.FileUnderTaskFolder(lctx, "workspaces/ws/z.png", "TQ-103"); e != nil {
		t.Fatal(e)
	}
	if f.moves != 0 {
		t.Fatal("no-op cases wrote Drive moves", f.moves)
	}
	b, _ := i.Lookup(ctx, "workspaces/ws/z.png")
	for id := range f.folders {
		if b.FolderID == id {
			return
		}
	}
	t.Fatal("labeled upload binding not pinned to task folder", b.FolderID)
}

func TestTaskFlowDriveFileUnderTaskFolderMoveQueryShape(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	if _, e := s.Upload(ctx, "workspaces/ws/q.png", []byte("q"), "q", "q"); e != nil {
		t.Fatal(e)
	}
	if e := s.FileUnderTaskFolder(ctx, "workspaces/ws/q.png", "TQ-7"); e != nil {
		t.Fatal(e)
	}
	up := f.files[f.fileIDFor("workspaces/ws/q.png", i)]
	if len(up.parents) != 1 || strings.Contains(strings.Join(up.parents, ","), "folder") {
		t.Fatal("root parent not replaced", up.parents)
	}
}
