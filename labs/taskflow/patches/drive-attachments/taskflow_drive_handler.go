package handler

import (
	"github.com/multica-ai/multica/server/internal/storage"
	"net/http"
	"os"
)

// This route stays inside the existing authenticated/CSRF group.
// Optional native owner-session recognition is explicit and default-off.
// A task-agent, plugin or service credential cannot start owner authorization.
func (h *Handler) StartTaskFlowDriveSetup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := requireUserID(w, r)
	if !ok {
		return
	}
	owner := os.Getenv("TASKFLOW_DRIVE_SETUP_OWNER_USER_ID")
	if owner == "" || user != owner {
		writeError(w, http.StatusForbidden, "owner browser session required")
		return
	}
	if r.Header.Get("Authorization") != "" {
		if os.Getenv("TASKFLOW_DRIVE_OWNER_NATIVE_SETUP") != "1" || !taskflowDriveOwnerNativeSession(r, user, owner, os.Getenv("TASKFLOW_DRIVE_OWNER_EMAIL"), os.Getenv("TASKFLOW_DRIVE_SETUP_WEB_ORIGIN")) {
			writeError(w, http.StatusForbidden, "owner browser session required")
			return
		}
	} else if r.Header.Get("X-Actor-Source") != "" {
		writeError(w, http.StatusForbidden, "owner browser session required")
		return
	}
	setup, e := storage.TaskFlowDriveSetupFromEnv(h.DB)
	if e != nil || setup == nil {
		writeError(w, http.StatusServiceUnavailable, "Drive 專用連線尚未準備完成。")
		return
	}
	entry, e := setup.NewConnectionURL(r.Context())
	if e != nil {
		writeError(w, http.StatusServiceUnavailable, "Drive 授權入口尚未建立，請稍後再試。")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"authorization_url": entry})
}
