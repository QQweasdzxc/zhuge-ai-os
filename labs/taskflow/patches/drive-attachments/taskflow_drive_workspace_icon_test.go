package storage

import (
	"context"
	"io"
	"testing"
)

func TestTaskFlowWorkspaceIconPrivateFolder(t *testing.T) {
	s, f, i := fixtureDriveSubfolder(t)
	ctx := context.Background()
	key := "workspaces/ws/icon.webp"
	data := []byte("confirmed icon")
	if _, e := s.Upload(ctx, key, data, "image/webp", "icon.webp"); e != nil {
		t.Fatal(e)
	}
	// The old externally-created folder is not used or deleted.
	f.folders["external-empty"] = driveFolderMeta{ID: "external-empty", Name: "工作區圖示", Mime: "application/vnd.google-apps.folder", Owned: true, Shared: sharedPtr(false), Parents: []string{"folder"}}
	if e := s.FileWorkspaceIcon(ctx, key); e != nil {
		t.Fatal(e)
	}
	b, _ := i.Lookup(ctx, key)
	if b.FolderID != "folder" {
		t.Fatal("immutable binding changed")
	}
	file := f.files[b.FileID]
	if len(file.parents) != 1 || f.folders[file.parents[0]].Name != WorkspaceIconFolderName {
		t.Fatal("wrong icon folder")
	}
	if _, ok := f.folders["external-empty"]; !ok {
		t.Fatal("old folder removed")
	}
	r, e := s.GetReader(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != string(data) {
		t.Fatal("bytes changed")
	}
	moves := f.moves
	if e := s.FileWorkspaceIcon(ctx, key); e != nil {
		t.Fatal(e)
	}
	if f.moves != moves {
		t.Fatal("duplicate move")
	}
	if normalizeTaskFlowDriveFolderLabel(WorkspaceIconFolderName) != "" {
		t.Fatal("icon label admitted as task")
	}
}
func TestTaskFlowWorkspaceIconReadOnlyAndForeign(t *testing.T) {
	for _, mode := range []string{"readonly", "foreign", "shared", "ambiguous"} {
		t.Run(mode, func(t *testing.T) {
			s, f, i := fixtureDriveSubfolder(t)
			ctx := context.Background()
			key := "workspaces/ws/icon.webp"
			if _, e := s.Upload(ctx, key, []byte("icon"), "image/webp", "icon.webp"); e != nil {
				t.Fatal(e)
			}
			b, _ := i.Lookup(ctx, key)
			switch mode {
			case "readonly":
				s.SetReadOnly()
			case "foreign":
				f.files[b.FileID].parents = []string{"foreign"}
			case "shared":
				f.folderShared = true
			case "ambiguous":
				f.ambiguous = true
			}
			if e := s.FileWorkspaceIcon(ctx, key); e == nil {
				t.Fatal("unsafe filing accepted")
			}
			if f.moves != 0 {
				t.Fatal("unsafe file move")
			}
		})
	}
}
