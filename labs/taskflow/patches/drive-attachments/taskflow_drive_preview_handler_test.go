package handler

import (
 "testing"
 "github.com/multica-ai/multica/server/internal/storage"
 db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestTaskFlowDrivePrivatePreviewMarker(t *testing.T) {
 row:=db.Attachment{Url:"/uploads/workspaces/fixture/fixture.png",Filename:"fixture.png",ContentType:"image/png",SizeBytes:12}
 for _,tc:=range []struct{name string;store storage.Storage;private bool}{{"drive",&storage.TaskFlowDriveStorage{},true},{"local",&storage.LocalStorage{},false},{"unset",nil,false}} {
 t.Run(tc.name,func(t *testing.T){h:=&Handler{Storage:tc.store};got:=h.attachmentToResponse(row,attachmentURLModeSigned);if got.PrivateStorage!=tc.private{t.Fatal("private marker mismatch")};if got.URL!=row.Url{t.Fatal("storage reference changed")};if got.MarkdownURL==row.Url||got.DownloadURL==row.Url{t.Fatal("canonical authenticated route missing")}})
 }
}
