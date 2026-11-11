package handler

import (
	"context"
	"crypto/sha256"
	"log/slog"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/storage"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Best-effort filing of newly issue-bound Drive attachments under the task's
// subfolder. Upload-time labeling covers comment uploads; issue drafts and
// description-editor uploads carry no task number yet, so they are filed here
// once the bind commits. Wired as IssueService.Filer so every create path
// (web, quick-create, agent runs) files uniformly. Failures are logged and
// never fail the issue write: the immutable binding keeps serving the file,
// and the next bind or serve retries the filing.
func (h *Handler) taskFlowDriveFileBoundAttachments(ctx context.Context, issue db.Issue, attachmentIDs []pgtype.UUID) {
	if _, ok := h.Storage.(*storage.TaskFlowDriveStorage); !ok || len(attachmentIDs) == 0 {
		return
	}
	for _, id := range attachmentIDs {
		att, err := h.Queries.GetAttachment(ctx, db.GetAttachmentParams{ID: id, WorkspaceID: issue.WorkspaceID})
		if err != nil || att.IssueID != issue.ID {
			continue
		}
		h.taskFlowDriveFileAttachment(ctx, att)
	}
}

// taskFlowDriveFileAttachment re-files one issue-bound Drive attachment that
// is still outside its task folder. It is the self-healing backstop for
// filings that raced a Drive outage: every preview or download of the
// attachment retries the filing. A confirmed filing is cached in the storage
// layer, so steady-state serves add no Drive traffic. A failure streak that
// reaches the threshold posts one deduplicated system comment on the task so
// the user sees the unfiled attachment without auditing Drive.
func (h *Handler) taskFlowDriveFileAttachment(ctx context.Context, att db.Attachment) {
	drive, ok := h.Storage.(*storage.TaskFlowDriveStorage)
	if !ok || !att.IssueID.Valid {
		return
	}
	key := h.Storage.KeyFromURL(att.Url)
	if key == "" {
		return
	}
	issue, err := h.Queries.GetIssueInWorkspace(ctx, db.GetIssueInWorkspaceParams{ID: att.IssueID, WorkspaceID: att.WorkspaceID})
	if err != nil {
		return
	}
	label := h.getIssuePrefix(ctx, att.WorkspaceID) + "-" + strconv.Itoa(int(issue.Number))
	if err := drive.FileUnderTaskFolder(ctx, key, label); err != nil {
		slog.WarnContext(ctx, "Drive task-folder filing failed", "attachment_id", uuidToString(att.ID), "error", err)
		if !drive.FilingWarned(key) {
			h.taskFlowDriveWarnFilingFailed(ctx, drive, att, issue, label, key)
		}
	}
}

// taskFlowDriveFilingWarnID derives one stable comment ID per attachment, so
// a repeated warning attempt conflicts on the primary key instead of posting
// a duplicate: deduplication survives restarts and does not depend on
// scanning a bounded window of recent comments.
func taskFlowDriveFilingWarnID(attachmentID pgtype.UUID) pgtype.UUID {
	sum := sha256.Sum256([]byte("taskflow-drive-filing-warning:" + uuidToString(attachmentID)))
	var id [16]byte
	copy(id[:], sum[:16])
	id[6] = (id[6] & 0x0f) | 0x50
	id[8] = (id[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: id, Valid: true}
}

// taskFlowDriveWarnFilingFailed posts the attachment's one actionable
// Traditional Chinese system comment on its task: the first actual filing
// failure is surfaced, exactly once per attachment (deterministic comment ID
// plus a process-local flag; a primary-key conflict means the warning already
// stands). The copy names the unfiled attachment, tells the user not to
// delete anything, and asks them to report the prompt; it promises no
// automatic recovery. Bytes and the immutable binding are untouched.
func (h *Handler) taskFlowDriveWarnFilingFailed(ctx context.Context, drive *storage.TaskFlowDriveStorage, att db.Attachment, issue db.Issue, label, key string) {
	content := "系統提示：附件『" + att.Filename + "』尚未歸入『" + label + "』資料夾，目前仍保存在『TRQN TF 附件』，可預覽及下載。請勿刪除檔案或資料夾；請回報此提示，以核對歸檔失敗原因。"
	_, err := h.Queries.CreateComment(ctx, db.CreateCommentParams{IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, AuthorType: "system", Type: "system", Content: content, SuppressedAgentIds: []pgtype.UUID{}, ID: taskFlowDriveFilingWarnID(att.ID)})
	if err == nil || strings.Contains(err.Error(), "duplicate key") {
		drive.MarkFilingWarned(key)
		return
	}
	slog.WarnContext(ctx, "Drive filing warning comment failed", "attachment_id", uuidToString(att.ID), "error", err)
}
