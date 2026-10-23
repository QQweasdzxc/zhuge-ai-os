package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/middleware"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	workspaceA = "11111111-1111-4111-8111-111111111111"
	workspaceB = "22222222-2222-4222-8222-222222222222"
	adminUser  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	memberUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	agentA     = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	agentDup   = "abababab-abab-4aba-8aba-abababababab"
	projectA   = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	projectB   = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	issueAI    = "ffffffff-ffff-4fff-8fff-ffffffffffff"
	issueHuman = "99999999-9999-4999-8999-999999999999"
	taskAI     = "88888888-8888-4888-8888-888888888888"
	taskHuman  = "77777777-7777-4777-8777-777777777777"
)

type mappingView struct {
	ExecutorID    string `json:"executor_id"`
	State         string `json:"state"`
	Reason        string `json:"reason"`
	ProjectID     string `json:"project_id"`
	WorkspaceID   string `json:"workspace_id"`
	ProjectAccess string `json:"project_access"`
}

func TestNativeAIReadbackPostgres16(t *testing.T) {
	dsn := os.Getenv("TASKFLOW_NATIVE_AI_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("TASKFLOW_NATIVE_AI_DATABASE_URL is required in CI; PostgreSQL runtime tests may not skip")
		}
		t.Skip("TASKFLOW_NATIVE_AI_DATABASE_URL is unset; PostgreSQL runtime test not requested")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect isolated PostgreSQL: %v", err)
	}
	defer pool.Close()
	var version int
	if err := pool.QueryRow(ctx, `SELECT current_setting('server_version_num')::int`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version < 160000 || version >= 170000 {
		t.Fatalf("expected isolated PostgreSQL 16, got server_version_num=%d", version)
	}
	createNativeReadbackSchema(t, ctx, pool)
	if _, err := pool.Exec(ctx, `TRUNCATE agent_task_queue, issue, project, agent, member`); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO member(id,workspace_id,user_id,role) VALUES ($1,$2,$3,'admin')`, []any{"10000000-0000-4000-8000-000000000001", workspaceA, adminUser}},
		{`INSERT INTO member(id,workspace_id,user_id,role) VALUES ($1,$2,$3,'member')`, []any{"10000000-0000-4000-8000-000000000002", workspaceA, memberUser}},
	} {
		if _, err := pool.Exec(ctx, stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}

	queries := db.New(pool)
	h := handler.New(queries, pool, nil, nil, nil, nil, nil, analytics.NoopClient{}, handler.Config{})
	router := chi.NewRouter()
	router.Group(func(r chi.Router) {
		r.Use(middleware.RequireWorkspaceMember(queries))
		r.With(handler.RequireHumanActor).Get("/api/zhuge/ai/project-mappings", h.ListZhugeNativeExecutorProjects)
		r.With(handler.RequireHumanActor).Get("/api/zhuge/ai/tasks", h.ListZhugeNativeAITasks)
	})

	assert := func(method, path, actor, workspace, actorSource string, wantStatus int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		if actor != "" {
			req.Header.Set("X-User-ID", actor)
		}
		if workspace != "" {
			req.Header.Set("X-Workspace-ID", workspace)
		}
		if actorSource != "" {
			req.Header.Set("X-Actor-Source", actorSource)
		}
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		if resp.Code != wantStatus {
			t.Fatalf("%s %s status=%d want=%d body=%s", method, path, resp.Code, wantStatus, resp.Body.String())
		}
		return resp
	}

	assert(http.MethodGet, "/api/zhuge/ai/project-mappings", "", workspaceA, "", http.StatusUnauthorized)
	assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceB, "", http.StatusNotFound)
	assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "task_token", http.StatusForbidden)

	initial := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "", http.StatusOK)
	var envelope struct {
		WorkspaceID string `json:"workspace_id"`
		Mappings    []struct {
			ExecutorID string `json:"executor_id"`
			State      string `json:"state"`
			Reason     string `json:"reason"`
		} `json:"mappings"`
	}
	if err := json.Unmarshal(initial.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.WorkspaceID != workspaceA || len(envelope.Mappings) != 5 {
		t.Fatalf("empty mapping response must contain the five server identities for the requested Workspace: %+v", envelope)
	}
	for _, mapping := range envelope.Mappings {
		if mapping.State != "GAP" || mapping.Reason != "NATIVE_AGENT_NOT_FOUND" {
			t.Fatalf("missing native Agent must remain GAP: %+v", mapping)
		}
	}

	insertAgentAndProjects(t, ctx, pool, true)
	duplicate := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "", http.StatusOK)
	var duplicateEnvelope struct {
		Mappings []mappingView `json:"mappings"`
	}
	if err := json.Unmarshal(duplicate.Body.Bytes(), &duplicateEnvelope); err != nil {
		t.Fatal(err)
	}
	if got := mappingByExecutor(t, duplicateEnvelope.Mappings, "CO-01"); got.State != "GAP" || got.Reason != "DUPLICATE_PROJECT_BINDING" {
		t.Fatalf("two native Projects for one Executor must fail closed: %+v", got)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM project WHERE id=$1`, projectB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO project(id,workspace_id,title,status,lead_type,lead_id) VALUES ($1,$2,'Other Workspace Project','planned','agent',$3)`, projectB, workspaceB, agentA); err != nil {
		t.Fatal(err)
	}
	crossWorkspace := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "", http.StatusOK)
	var crossWorkspaceEnvelope struct {
		Mappings []mappingView `json:"mappings"`
	}
	if err := json.Unmarshal(crossWorkspace.Body.Bytes(), &crossWorkspaceEnvelope); err != nil {
		t.Fatal(err)
	}
	if got := mappingByExecutor(t, crossWorkspaceEnvelope.Mappings, "CO-01"); got.State != "VERIFIED" || got.ProjectID != projectA {
		t.Fatalf("a Project in another Workspace must not replace or leak into the native mapping: %+v", got)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM project WHERE id=$1`, projectB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO agent(id,workspace_id,system_key,permission_mode,kind) VALUES ($1,$2,'CO-01','private','user')`, agentDup, workspaceA); err != nil {
		t.Fatal(err)
	}
	duplicateIdentity := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "", http.StatusOK)
	var duplicateIdentityEnvelope struct {
		Mappings []mappingView `json:"mappings"`
	}
	if err := json.Unmarshal(duplicateIdentity.Body.Bytes(), &duplicateIdentityEnvelope); err != nil {
		t.Fatal(err)
	}
	if got := mappingByExecutor(t, duplicateIdentityEnvelope.Mappings, "CO-01"); got.State != "GAP" || got.Reason != "DUPLICATE_EXECUTOR_IDENTITY" {
		t.Fatalf("duplicate native Agent system identity must fail closed: %+v", got)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM agent WHERE id=$1`, agentDup); err != nil {
		t.Fatal(err)
	}

	verified := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", adminUser, workspaceA, "", http.StatusOK)
	var verifiedEnvelope struct {
		Mappings []mappingView `json:"mappings"`
	}
	if err := json.Unmarshal(verified.Body.Bytes(), &verifiedEnvelope); err != nil {
		t.Fatal(err)
	}
	co01 := mappingByExecutor(t, verifiedEnvelope.Mappings, "CO-01")
	if co01.State != "VERIFIED" || co01.ProjectID != projectA || co01.WorkspaceID != workspaceA || co01.ProjectAccess != "ALLOW" {
		t.Fatalf("native same-Workspace Project and Agent lead should read back the exact IDs: %+v", co01)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO issue(id,workspace_id,project_id,title,status,assignee_type,assignee_id)
		VALUES ($1,$2,$3,'Native AI issue','todo','agent',$4),
		       ($5,$2,$3,'Human issue','todo','member',$6),
		       ('66666666-6666-4666-8666-666666666666',$7,$3,'Cross Workspace issue','todo','agent',$4)`,
		issueAI, workspaceA, projectA, agentA, issueHuman, adminUser, workspaceB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO agent_task_queue(id,agent_id,issue_id,status)
		VALUES ($1,$2,$3,'queued'), ($4,$2,$5,'queued')`, taskAI, agentA, issueAI, taskHuman, issueHuman); err != nil {
		t.Fatal(err)
	}
	tasksResponse := assert(http.MethodGet, "/api/zhuge/ai/tasks?limit=20&offset=0", adminUser, workspaceA, "", http.StatusOK)
	var tasks struct {
		WorkspaceID string `json:"workspace_id"`
		Total       int64  `json:"total"`
		Tasks       []struct {
			IssueID              string `json:"issue_id"`
			WorkspaceID          string `json:"workspace_id"`
			ProjectID            string `json:"project_id"`
			ExecutorID           string `json:"executor_id"`
			IssueStatus          string `json:"issue_status"`
			TaskFlowTaskID       string `json:"taskflow_task_id"`
			TaskFlowTaskStatus   string `json:"taskflow_task_status"`
			ProviderRuntimeState string `json:"provider_runtime_state"`
			ProviderAck          string `json:"provider_ack"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(tasksResponse.Body.Bytes(), &tasks); err != nil {
		t.Fatal(err)
	}
	if tasks.WorkspaceID != workspaceA || tasks.Total != 1 || len(tasks.Tasks) != 1 {
		t.Fatalf("AI readback must include only the native Agent-assigned Issue in its mapped Project: %+v", tasks)
	}
	gotTask := tasks.Tasks[0]
	if gotTask.IssueID != issueAI || gotTask.ProjectID != projectA || gotTask.WorkspaceID != workspaceA || gotTask.ExecutorID != "CO-01" || gotTask.IssueStatus != "todo" || gotTask.TaskFlowTaskID != taskAI || gotTask.TaskFlowTaskStatus != "queued" {
		t.Fatalf("TaskFlow Native Issue and task queue identities diverged: %+v", gotTask)
	}
	if gotTask.ProviderRuntimeState != "UNVERIFIED" || gotTask.ProviderAck != "UNVERIFIED" {
		t.Fatalf("native queue must not be promoted to Provider evidence: %+v", gotTask)
	}

	if _, err := pool.Exec(ctx, `UPDATE agent SET permission_mode='private' WHERE id=$1`, agentA); err != nil {
		t.Fatal(err)
	}
	aclResponse := assert(http.MethodGet, "/api/zhuge/ai/project-mappings", memberUser, workspaceA, "", http.StatusOK)
	var aclEnvelope struct {
		Mappings []mappingView `json:"mappings"`
	}
	if err := json.Unmarshal(aclResponse.Body.Bytes(), &aclEnvelope); err != nil {
		t.Fatal(err)
	}
	if got := mappingByExecutor(t, aclEnvelope.Mappings, "CO-01"); got.State != "GAP" || got.Reason != "NATIVE_AGENT_ACL_DENIED" {
		t.Fatalf("private native Agent ACL must remain denied: %+v", got)
	}

	assert(http.MethodGet, "/api/zhuge/ai/tasks?limit=101", adminUser, workspaceA, "", http.StatusBadRequest)
}

func createNativeReadbackSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS member (id uuid primary key, workspace_id uuid not null, user_id uuid not null, role text not null, created_at timestamptz not null default now())`,
		`CREATE TABLE IF NOT EXISTS agent (id uuid primary key, workspace_id uuid not null, system_key text, owner_id uuid, permission_mode text not null default 'private', archived_at timestamptz, kind text not null default 'user')`,
		`CREATE TABLE IF NOT EXISTS project (id uuid primary key, workspace_id uuid not null, title text not null, status text not null default 'planned', lead_type text, lead_id uuid)`,
		`CREATE TABLE IF NOT EXISTS issue (id uuid primary key, workspace_id uuid not null, project_id uuid, title text not null, status text not null, assignee_type text, assignee_id uuid, updated_at timestamptz not null default now())`,
		`CREATE TABLE IF NOT EXISTS agent_task_queue (id uuid primary key, agent_id uuid not null, issue_id uuid not null, status text not null, created_at timestamptz not null default now())`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("create isolated schema: %v", err)
		}
	}
}

func insertAgentAndProjects(t *testing.T, ctx context.Context, pool *pgxpool.Pool, duplicate bool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO agent(id,workspace_id,system_key,permission_mode,kind) VALUES ($1,$2,'CO-01','public_to','user')`, agentA, workspaceA); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO project(id,workspace_id,title,status,lead_type,lead_id) VALUES ($1,$2,'Native CO-01','in_progress','agent',$3)`, projectA, workspaceA, agentA); err != nil {
		t.Fatal(err)
	}
	if duplicate {
		if _, err := pool.Exec(ctx, `INSERT INTO project(id,workspace_id,title,status,lead_type,lead_id) VALUES ($1,$2,'Duplicate CO-01','planned','agent',$3)`, projectB, workspaceA, agentA); err != nil {
			t.Fatal(err)
		}
	}
}

func mappingByExecutor(t *testing.T, mappings []mappingView, executor string) mappingView {
	t.Helper()
	for _, mapping := range mappings {
		if mapping.ExecutorID == executor {
			return mapping
		}
	}
	t.Fatalf("executor %s not present in native project mapping response", executor)
	return mappingView{}
}
