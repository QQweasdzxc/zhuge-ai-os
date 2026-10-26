package handler

import (
	"context"
	"github.com/multica-ai/multica/server/internal/storage"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"net/http"
	"os"
	"strings"
)

// Metadata stays readable after preview expiry so the download button can
// obtain its own fresh, forced-download capability. Never return a stale URL.
func (h *Handler) taskFlowLifecycleMetadata(w http.ResponseWriter, r *http.Request, att db.Attachment) bool {
	if os.Getenv("TASKFLOW_ATTACHMENT_LIFECYCLE") != "true" || !strings.Contains(att.Url, "/storage/v1/object/authenticated/taskflow-attachments/") {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	response := h.attachmentToResponse(att, attachmentURLModeStable)
	response.URL = ""
	response.DownloadURL = ""
	presigner, ok := h.Storage.(storage.DownloadPresigner)
	if !ok {
		writeError(w, 503, "attachment storage unavailable")
		return true
	}
	key := h.Storage.KeyFromURL(att.Url)
	if status, ok := h.Storage.(interface {
		LifecycleStatus(context.Context, string) map[string]any
	}); ok {
		response.Lifecycle = status.LifecycleStatus(r.Context(), key)
	}
	preview, previewErr := presigner.PresignGetWithContentDisposition(r.Context(), key, h.attachmentDownloadURLTTL(), "")
	download, downloadErr := presigner.PresignGetWithContentDisposition(r.Context(), key, h.attachmentDownloadURLTTL(), storage.AttachmentContentDisposition(att.Filename))
	response.PreviewAvailable = previewErr == nil
	if previewErr == nil {
		response.DownloadURL = preview
	}
	if downloadErr == nil {
		response.AttachmentDownloadURL = download
	}
	writeJSON(w, http.StatusOK, response)
	return true
}

func (h *Handler) taskFlowLifecycleDelete(w http.ResponseWriter, r *http.Request, att db.Attachment) bool {
	if os.Getenv("TASKFLOW_ATTACHMENT_LIFECYCLE") != "true" || !strings.Contains(att.Url, "/storage/v1/object/authenticated/taskflow-attachments/") {
		return false
	}
	deleter, ok := h.Storage.(interface {
		LifecycleDelete(context.Context, string) error
	})
	if !ok {
		writeError(w, 503, "attachment deletion unavailable")
		return true
	}
	if err := deleter.LifecycleDelete(r.Context(), h.Storage.KeyFromURL(att.Url)); err != nil {
		writeError(w, 502, "attachment deletion was not confirmed")
		return true
	}
	w.WriteHeader(http.StatusNoContent)
	return true
}

func taskFlowLifecycleObject(rawURL string) bool {
	return os.Getenv("TASKFLOW_ATTACHMENT_LIFECYCLE") == "true" && strings.Contains(rawURL, "/storage/v1/object/authenticated/taskflow-attachments/")
}
