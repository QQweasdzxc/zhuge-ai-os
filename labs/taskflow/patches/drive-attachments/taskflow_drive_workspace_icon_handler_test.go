package handler

import (
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"testing"
)

func TestTaskFlowWorkspaceIconIdentity(t *testing.T) {
	id := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	other := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	ws := db.Workspace{ID: id}
	base := db.Attachment{WorkspaceID: id}
	key := "workspaces/ws/icon.webp"
	if !taskFlowWorkspaceIconMatches(base, ws, key, key) {
		t.Fatal("valid standalone icon refused")
	}
	for _, kind := range []string{"workspace", "issue", "comment", "chat", "task", "key", "type"} {
		t.Run(kind, func(t *testing.T) {
			a := base
			k := key
			ak := key
			switch kind {
			case "workspace":
				a.WorkspaceID = other
			case "issue":
				a.IssueID = id
			case "comment":
				a.CommentID = id
			case "chat":
				a.ChatSessionID = id
			case "task":
				a.TaskID = id
			case "key":
				ak = "different.webp"
			case "type":
				k = "workspaces/ws/data.txt"
				ak = k
			}
			if taskFlowWorkspaceIconMatches(a, ws, k, ak) {
				t.Fatal("unrelated content filed as icon")
			}
		})
	}
}
