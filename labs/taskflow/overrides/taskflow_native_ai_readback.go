package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// The Executor identities are stable product-owned Agent.system_key values.
// Display names and Project titles are never used to establish ownership.
var zhugeNativeExecutorIDs = []string{"CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"}

const (
	zhugeNativeProjectMapSchema = "taskflow-native-executor-project-mapping-v1"
	zhugeNativeProjectMapSource = "TASKFLOW_NATIVE_EXECUTOR_REGISTRY"
	zhugeNativeTasksSchema      = "taskflow-native-ai-task-readback-v1"
	zhugeNativeTasksSource      = "TASKFLOW_NATIVE_ISSUE_AGENT_QUEUE"
)

type zhugeNativeProjectMapping struct {
	ExecutorID      string `json:"executor_id"`
	State           string `json:"state"`
	Reason          string `json:"reason,omitempty"`
	ProjectID       string `json:"project_id,omitempty"`
	ProjectTitle    string `json:"project_title,omitempty"`
	WorkspaceID     string `json:"workspace_id"`
	WorkspaceAccess string `json:"workspace_access"`
	ProjectAccess   string `json:"project_access"`
	Source          string `json:"source"`

	// These server-only fields are used by the AI task query and are never
	// serialized. They come from the native Agent and Project rows above.
	agentID pgtype.UUID
}

type zhugeNativeProjectAggregate struct {
	executorID   string
	agentCount   int64
	projectCount int64
	agentID      pgtype.Text
	ownerID      pgtype.Text
	permission   pgtype.Text
	agentKind    pgtype.Text
	projectID    pgtype.Text
	projectTitle pgtype.Text
}

func zhugeWorkspaceID(h *Handler, w http.ResponseWriter, r *http.Request) (string, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id or workspace_slug is required")
		return "", false
	}
	if _, ok := h.workspaceMember(w, r, workspaceID); !ok {
		return "", false
	}
	if _, err := util.ParseUUID(workspaceID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid workspace_id")
		return "", false
	}
	return workspaceID, true
}

// loadZhugeNativeProjectMappings derives mappings exclusively from TaskFlow's
// native Agent.system_key and Project.lead fields. It adds no mapping table and
// treats missing, duplicate, cross-workspace, or inaccessible records as GAP.
func (h *Handler) loadZhugeNativeProjectMappings(r *http.Request, workspaceID string, member db.Member) ([]zhugeNativeProjectMapping, error) {
	if h.DB == nil {
		return nil, errors.New("database unavailable")
	}
	rows, err := h.DB.Query(r.Context(), `
		WITH required(executor_id) AS (
			SELECT unnest($2::text[])
		), native_agents AS (
			SELECT id, workspace_id, system_key, owner_id, permission_mode, kind
			FROM agent
			WHERE workspace_id = $1
			  AND system_key = ANY($2::text[])
			  AND archived_at IS NULL
	)
		SELECT required.executor_id,
		       count(DISTINCT native_agents.id)::bigint AS agent_count,
		       count(DISTINCT project.id)::bigint AS project_count,
	       min(native_agents.id::text),
	       min(native_agents.owner_id::text),
	       min(native_agents.permission_mode),
	       min(native_agents.kind),
	       min(project.id::text),
	       min(project.title)
		FROM required
		LEFT JOIN native_agents ON native_agents.system_key = required.executor_id
		LEFT JOIN project
		  ON project.workspace_id = $1
		 AND project.lead_type = 'agent'
		 AND project.lead_id = native_agents.id
		GROUP BY required.executor_id
		ORDER BY array_position($2::text[], required.executor_id)`, workspaceID, zhugeNativeExecutorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]zhugeNativeProjectMapping, 0, len(zhugeNativeExecutorIDs))
	for rows.Next() {
		var agg zhugeNativeProjectAggregate
		if err := rows.Scan(&agg.executorID, &agg.agentCount, &agg.projectCount, &agg.agentID, &agg.ownerID, &agg.permission, &agg.agentKind, &agg.projectID, &agg.projectTitle); err != nil {
			return nil, err
		}
		mapping := zhugeNativeProjectMapping{
			ExecutorID: agg.executorID, State: "GAP", WorkspaceID: workspaceID,
			WorkspaceAccess: "ALLOW", ProjectAccess: "UNVERIFIED", Source: zhugeNativeProjectMapSource,
		}
		switch {
		case agg.agentCount == 0:
			mapping.Reason = "NATIVE_AGENT_NOT_FOUND"
		case agg.agentCount != 1:
			mapping.Reason = "DUPLICATE_EXECUTOR_IDENTITY"
		case agg.projectCount == 0:
			mapping.Reason = "NATIVE_PROJECT_NOT_BOUND"
		case agg.projectCount != 1:
			mapping.Reason = "DUPLICATE_PROJECT_BINDING"
		default:
			agentID, parseErr := util.ParseUUID(agg.agentID.String)
			if parseErr != nil || !agg.agentID.Valid || !agg.projectID.Valid {
				mapping.Reason = "NATIVE_IDENTITY_INVALID"
				break
			}
			workspaceUUID, workspaceErr := util.ParseUUID(workspaceID)
			if workspaceErr != nil {
				mapping.Reason = "WORKSPACE_ID_INVALID"
				break
			}
			agent := db.Agent{ID: agentID, WorkspaceID: workspaceUUID, Kind: agg.agentKind.String}
			if agg.ownerID.Valid {
				agent.OwnerID, _ = util.ParseUUID(agg.ownerID.String)
			}
			agent.PermissionMode = agg.permission.String
			memberID := uuidToString(member.UserID)
			if !h.canAccessPrivateAgent(r.Context(), agent, "member", memberID, workspaceID) {
				mapping.Reason = "NATIVE_AGENT_ACL_DENIED"
				mapping.ProjectAccess = "DENY"
				break
			}
			mapping.State = "VERIFIED"
			mapping.Reason = ""
			mapping.ProjectID = agg.projectID.String
			mapping.ProjectTitle = agg.projectTitle.String
			mapping.ProjectAccess = "ALLOW"
			mapping.agentID = agentID
		}
		result = append(result, mapping)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(result) != len(zhugeNativeExecutorIDs) {
		return nil, strconv.ErrSyntax
	}
	return result, nil
}

// ListZhugeNativeExecutorProjects returns only server-read native Project
// ownership, scoped by the authenticated user's current Workspace membership.
func (h *Handler) ListZhugeNativeExecutorProjects(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := zhugeWorkspaceID(h, w, r)
	if !ok {
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		member, ok = h.workspaceMember(w, r, workspaceID)
		if !ok {
			return
		}
	}
	mappings, err := h.loadZhugeNativeProjectMappings(r, workspaceID, member)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "native project mappings unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schema": zhugeNativeProjectMapSchema, "source": zhugeNativeProjectMapSource,
		"workspace_id": workspaceID, "checked_at": time.Now().UTC().Format(time.RFC3339Nano), "mappings": mappings,
	})
}

type zhugeNativeTask struct {
	IssueID              string `json:"issue_id"`
	WorkspaceID          string `json:"workspace_id"`
	ProjectID            string `json:"project_id"`
	ProjectTitle         string `json:"project_title"`
	Title                string `json:"title"`
	IssueStatus          string `json:"issue_status"`
	ExecutorID           string `json:"executor_id"`
	TaskFlowTaskID       string `json:"taskflow_task_id"`
	TaskFlowTaskStatus   string `json:"taskflow_task_status"`
	ProviderRuntimeState string `json:"provider_runtime_state"`
	ProviderAck          string `json:"provider_ack"`
	UpdatedAt            string `json:"updated_at"`
}

func parseNativeTaskPage(r *http.Request) (int32, int32, bool) {
	limit := int64(50)
	offset := int64(0)
	var err error
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		limit, err = strconv.ParseInt(raw, 10, 32)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, false
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		offset, err = strconv.ParseInt(raw, 10, 32)
		if err != nil || offset < 0 || offset > 10000 {
			return 0, 0, false
		}
	}
	return int32(limit), int32(offset), true
}

// ListZhugeNativeAITasks reads only canonical Issues that are assigned to a
// verified Executor Agent, live in that Agent's verified native Project, and
// have a native TaskFlow queue row. Metadata, PRs, comments and Provider claims
// do not qualify an Issue. Provider state remains UNVERIFIED by design.
func (h *Handler) ListZhugeNativeAITasks(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := zhugeWorkspaceID(h, w, r)
	if !ok {
		return
	}
	limit, offset, ok := parseNativeTaskPage(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid native AI task pagination")
		return
	}
	member, ok := ctxMember(r.Context())
	if !ok {
		member, ok = h.workspaceMember(w, r, workspaceID)
		if !ok {
			return
		}
	}
	mappings, err := h.loadZhugeNativeProjectMappings(r, workspaceID, member)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "native project mappings unavailable")
		return
	}
	var executorIDs []string
	var agentIDs, projectIDs []pgtype.UUID
	for _, mapping := range mappings {
		if mapping.State == "VERIFIED" {
			projectID, parseErr := util.ParseUUID(mapping.ProjectID)
			if parseErr != nil {
				writeError(w, http.StatusServiceUnavailable, "native project mappings unavailable")
				return
			}
			executorIDs = append(executorIDs, mapping.ExecutorID)
			agentIDs = append(agentIDs, mapping.agentID)
			projectIDs = append(projectIDs, projectID)
		}
	}
	tasks := make([]zhugeNativeTask, 0)
	var total int64
	if len(agentIDs) > 0 {
		if err := h.DB.QueryRow(r.Context(), `
			WITH mapping AS (
				SELECT * FROM unnest($2::text[], $3::uuid[], $4::uuid[])
					AS m(executor_id, agent_id, project_id)
			), latest_queue AS (
				SELECT DISTINCT ON (q.issue_id) q.issue_id, q.agent_id
				FROM agent_task_queue q
				ORDER BY q.issue_id, q.created_at DESC, q.id DESC
			)
			SELECT count(*)::bigint
			FROM mapping m
			JOIN agent a ON a.id = m.agent_id AND a.workspace_id = $1
			JOIN project p ON p.id = m.project_id AND p.workspace_id = $1
			                 AND p.lead_type = 'agent' AND p.lead_id = a.id
			JOIN issue i ON i.workspace_id = $1 AND i.project_id = p.id
			                AND i.assignee_type = 'agent' AND i.assignee_id = a.id
			JOIN latest_queue q ON q.issue_id = i.id AND q.agent_id = a.id`,
			workspaceID, executorIDs, agentIDs, projectIDs).Scan(&total); err != nil {
			writeError(w, http.StatusServiceUnavailable, "native AI tasks unavailable")
			return
		}
		rows, err := h.DB.Query(r.Context(), `
			WITH mapping AS (
				SELECT * FROM unnest($2::text[], $3::uuid[], $4::uuid[])
					AS m(executor_id, agent_id, project_id)
			), latest_queue AS (
				SELECT DISTINCT ON (q.issue_id) q.issue_id, q.agent_id, q.id, q.status, q.created_at
				FROM agent_task_queue q
				ORDER BY q.issue_id, q.created_at DESC, q.id DESC
			)
			SELECT i.id::text, i.workspace_id::text, p.id::text, p.title, i.title, i.status,
			       m.executor_id, q.id::text, q.status, i.updated_at
			FROM mapping m
			JOIN agent a ON a.id = m.agent_id AND a.workspace_id = $1
			JOIN project p ON p.id = m.project_id AND p.workspace_id = $1
			                 AND p.lead_type = 'agent' AND p.lead_id = a.id
			JOIN issue i ON i.workspace_id = $1 AND i.project_id = p.id
			                AND i.assignee_type = 'agent' AND i.assignee_id = a.id
			JOIN latest_queue q ON q.issue_id = i.id AND q.agent_id = a.id
			ORDER BY i.updated_at DESC, i.id DESC
			LIMIT $5 OFFSET $6`, workspaceID, executorIDs, agentIDs, projectIDs, limit, offset)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "native AI tasks unavailable")
			return
		}
		defer rows.Close()
		for rows.Next() {
			var item zhugeNativeTask
			var updated time.Time
			if err := rows.Scan(&item.IssueID, &item.WorkspaceID, &item.ProjectID, &item.ProjectTitle, &item.Title, &item.IssueStatus, &item.ExecutorID, &item.TaskFlowTaskID, &item.TaskFlowTaskStatus, &updated); err != nil {
				writeError(w, http.StatusServiceUnavailable, "native AI tasks unavailable")
				return
			}
			item.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
			item.ProviderRuntimeState = "UNVERIFIED"
			item.ProviderAck = "UNVERIFIED"
			tasks = append(tasks, item)
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusServiceUnavailable, "native AI tasks unavailable")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schema": zhugeNativeTasksSchema, "source": zhugeNativeTasksSource,
		"workspace_id": workspaceID, "observed_at": time.Now().UTC().Format(time.RFC3339Nano),
		"limit": limit, "offset": offset, "total": total, "tasks": tasks,
		"consistency": "NON_ATOMIC_OFFSET", "provider_runtime_state": "UNVERIFIED",
	})
}
