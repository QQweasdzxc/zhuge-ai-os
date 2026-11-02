package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/auth"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func authenticateServiceAgentToken(w http.ResponseWriter, r *http.Request, q *db.Queries, token string) bool {
	requestedWS := r.Header.Values("X-Workspace-ID")
	r.Header.Del("X-Workspace-ID")
	if q == nil {
		writeError(w, 401, "invalid token")
		return false
	}
	t, slug, err := q.AuthenticateServiceAgentToken(r.Context(), auth.HashToken(token))
	if err != nil {
		writeError(w, 401, "invalid token")
		return false
	}
	if rejectTemporarilyDisabledUser(w, r, t.CreatedBy, "", "service_agent_token") {
		return false
	}
	// Validate EVERY selector (including duplicate query values); never silently
	// prefer a server header over a conflicting client workspace/slug.
	for _, v := range append(requestedWS, r.URL.Query()["workspace_id"]...) {
		parsed, e := uuid.Parse(v)
		if e != nil || parsed.String() != t.WorkspaceID {
			writeError(w, 403, "workspace outside token scope")
			return false
		}
	}
	for _, v := range append(r.Header.Values("X-Workspace-Slug"), r.URL.Query()["workspace_slug"]...) {
		if v != slug {
			writeError(w, 403, "workspace outside token scope")
			return false
		}
	}
	if !serviceAgentRouteAllowed(w, r, q, t.WorkspaceID) {
		return false
	}
	r.Header.Set("X-User-ID", t.CreatedBy)
	r.Header.Set("X-Agent-ID", t.AgentID)
	r.Header.Set("X-Workspace-ID", t.WorkspaceID)
	r.Header.Set("X-Actor-Source", "service_agent_token")
	return true
}

func serviceAgentRouteAllowed(w http.ResponseWriter, r *http.Request, q *db.Queries, ws string) bool {
	deny := func() bool { writeError(w, http.StatusForbidden, "route outside service agent scope"); return false }
	// Match canonical paths only, before chi dispatch; avoid path-cleaning or
	// percent-encoding changing what the auth gate and the router interpret.
	if r.URL.RawPath != "" || strings.Contains(r.URL.Path, "//") {
		return deny()
	}
	p := strings.TrimSuffix(r.URL.Path, "/")
	if r.Method == "GET" && (p == "/api/issues" || p == "/api/issues/search") {
		return true
	}
	if r.Method == "POST" && p == "/api/upload-file" {
		r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			return deny()
		}
		// Files are only for issue work, never chat, task outputs, or user uploads.
		if r.FormValue("issue_id") == "" || r.FormValue("chat_session_id") != "" || r.FormValue("task_id") != "" {
			return deny()
		}
		if !q.ServiceAgentResourceInWorkspace(r.Context(), "issue", r.FormValue("issue_id"), ws) {
			return deny()
		}
		return true
	}
	parts := strings.Split(strings.TrimPrefix(p, "/api/"), "/")
	if len(parts) < 2 || !strings.HasPrefix(p, "/api/") {
		return deny()
	}
	if _, err := uuid.Parse(parts[1]); err != nil {
		return deny()
	}
	if parts[0] == "issues" {
		if !q.ServiceAgentResourceInWorkspace(r.Context(), "issue", parts[1], ws) {
			return deny()
		}
		if len(parts) == 2 && r.Method == "GET" {
			return true
		}
		if len(parts) == 2 && r.Method == "PUT" {
			// The native PUT updates many fields. SAT is authorized ONLY for status.
			var req struct {
				Status           string `json:"status"`
				ExpectedRevision *int64 `json:"expected_revision,omitempty"`
			}
			dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			dec.DisallowUnknownFields()
			if dec.Decode(&req) != nil || req.Status == "" {
				return deny()
			}
			var extra any
			if dec.Decode(&extra) != io.EOF {
				return deny()
			}
			body, _ := json.Marshal(req)
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
			return true
		}
		if len(parts) == 3 {
			switch parts[2] {
			case "comments":
				if r.Method == "GET" || r.Method == "POST" {
					return true
				}
			case "attachments", "timeline":
				if r.Method == "GET" {
					return true
				}
			}
		}
	}
	if parts[0] == "attachments" && q.ServiceAgentResourceInWorkspace(r.Context(), "attachment", parts[1], ws) {
		if len(parts) == 2 && (r.Method == "GET" || r.Method == "DELETE") {
			return true
		}
		if len(parts) == 3 && r.Method == "GET" && (parts[2] == "content" || parts[2] == "download") {
			return true
		}
	}
	return deny()
}
