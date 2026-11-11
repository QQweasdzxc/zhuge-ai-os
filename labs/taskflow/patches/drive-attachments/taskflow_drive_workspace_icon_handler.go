package handler

import (
	"context"
	"github.com/multica-ai/multica/server/internal/storage"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"log/slog"
	"net/http"
)

// Called only after an authenticated workspace-avatar update commits.
// No read endpoint files images and no task-bound attachment is accepted.
func (h *Handler) taskFlowDriveFileWorkspaceIcon(ctx context.Context, ws db.Workspace) {
	drive, ok := h.Storage.(*storage.TaskFlowDriveStorage)
	if !ok || !ws.AvatarUrl.Valid {
		return
	}
	key := h.Storage.KeyFromURL(ws.AvatarUrl.String)
	id, ok := attachmentIDFromStorageKey(key)
	if !ok {
		return
	}
	att, err := h.Queries.GetAttachment(ctx, db.GetAttachmentParams{ID: id, WorkspaceID: ws.ID})
	if err != nil || !taskFlowWorkspaceIconMatches(att, ws, key, h.Storage.KeyFromURL(att.Url)) {
		return
	}
	if err := drive.FileWorkspaceIcon(ctx, key); err != nil {
		slog.WarnContext(ctx, "Drive workspace-icon filing failed; original retained", "attachment_id", uuidToString(id), "error", err)
	}
}

// Recheck owner workspace, standalone class, image type and immutable key.
func taskFlowWorkspaceIconMatches(att db.Attachment, ws db.Workspace, key, attachmentKey string) bool {
	return att.WorkspaceID == ws.ID && !attachmentIsBound(att) && key != "" && key == attachmentKey && avatarContentType(key) != ""
}

// OrganizeTaskFlowWorkspaceIcon is a deliberate human admin action. GETs and
// startup never move files. The workspace setting and old records are unchanged.
func (h *Handler) OrganizeTaskFlowWorkspaceIcon(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "id")
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, 403, "insufficient permissions")
		return
	}
	drive, ok := h.Storage.(*storage.TaskFlowDriveStorage)
	if !ok {
		writeError(w, 409, "目前儲存方式不支援圖示歸檔，原圖未變更。")
		return
	}
	ws, err := h.Queries.GetWorkspace(r.Context(), member.WorkspaceID)
	if err != nil || !ws.AvatarUrl.Valid {
		writeError(w, 409, "工作區尚無可歸檔圖示。")
		return
	}
	key := h.Storage.KeyFromURL(ws.AvatarUrl.String)
	id, ok := attachmentIDFromStorageKey(key)
	if !ok {
		writeError(w, 409, "圖示不是可歸檔的私人上傳檔案。")
		return
	}
	att, err := h.Queries.GetAttachment(r.Context(), db.GetAttachmentParams{ID: id, WorkspaceID: ws.ID})
	if err != nil || !taskFlowWorkspaceIconMatches(att, ws, key, h.Storage.KeyFromURL(att.Url)) {
		writeError(w, 409, "圖示紀錄不符，未搬動任何檔案。")
		return
	}
	// Verify the current original before touching its placement.
	reader, err := drive.GetReader(r.Context(), key)
	if err != nil {
		writeError(w, 409, "目前無法讀取圖示原檔，未搬動任何檔案。")
		return
	}
	reader.Close()
	if err := drive.FileWorkspaceIcon(r.Context(), key); err != nil {
		writeError(w, 503, "圖示歸檔未完成，請保留原檔後重試；不要刪除或重傳。")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "filed", "folder": storage.WorkspaceIconFolderName})
}
