package handler

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"net/http/httptest"
	"os"
	"testing"
)

// Isolated G1 fixture only, explicitly selected by the caller. This test cannot
// fall back to production or pass by silently skipping its database checks.
func TestG1NativePluralProjectsOwnerACL(t *testing.T) {
	url := os.Getenv("G1_READBACK_TEST_URL")
	if url == "" {
		if os.Getenv("G1_READBACK_REQUIRED") == "1" {
			t.Fatal("required isolated fixture missing")
		}
		t.Skip("isolated readback fixture not selected")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ws, _ := util.ParseUUID("01a1247f-520e-78eb-aa58-0a0e458185f6")
	owner, _ := util.ParseUUID("ac5afcc7-f045-41a9-8827-eaf085a04c0d")
	h := &Handler{DB: pool}
	r := httptest.NewRequest("GET", "/", nil)
	rows, err := h.loadZhugeNativeProjectMappings(r, "01a1247f-520e-78eb-aa58-0a0e458185f6", db.Member{UserID: owner, WorkspaceID: ws, Role: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 5 {
		t.Fatalf("want 5 mappings, got %d", len(rows))
	}
	for _, row := range rows {
		if row.State != "VERIFIED" {
			t.Fatalf("not verified: %+v", row)
		}
		if row.ExecutorID == "CO-01" {
			if len(row.Projects) != 2 || row.ProjectID != "" || row.ProjectTitle != "" {
				t.Fatalf("plural must not silently select singular: %+v", row)
			}
		} else if len(row.Projects) != 1 || row.ProjectID == "" {
			t.Fatalf("singular compatibility lost: %+v", row)
		}
	}
}

func TestNativeDispatchPluralProjectMembership(t *testing.T) {
	aid, _ := util.ParseUUID("9a8b5560-909c-5f30-82d7-9e330f5d28fc")
	m := zhugeNativeProjectMapping{ExecutorID: "CO-01", State: "VERIFIED", WorkspaceID: "ws", ProjectAccess: "ALLOW", agentID: aid, Projects: []zhugeNativeProject{{ID: "p1", Title: "renamed"}, {ID: "p2", Title: "same title"}}}
	for _, id := range []string{"p1", "p2"} {
		if !nativeDispatchProjectMatchesIssue([]zhugeNativeProjectMapping{m}, "CO-01", "ws", id) {
			t.Fatalf("lost plural project %s", id)
		}
	}
	if nativeDispatchProjectMatchesIssue([]zhugeNativeProjectMapping{m}, "CO-01", "ws", "p3") {
		t.Fatal("unrelated project admitted")
	}
}

func TestG1NativeAssignedNoProjectNoQueueAndPrivate(t *testing.T) {
	url := os.Getenv("G1_READBACK_TEST_URL")
	if url == "" {
		if os.Getenv("G1_READBACK_REQUIRED") == "1" {
			t.Fatal("required isolated fixture missing")
		}
		t.Skip("isolated readback fixture not selected")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ws := util.MustParseUUID("01a1247f-520e-78eb-aa58-0a0e458185f6")
	owner := util.MustParseUUID("ac5afcc7-f045-41a9-8827-eaf085a04c0d")
	h := &Handler{DB: pool, Queries: db.New(pool)}
	ctx := context.Background()
	_, err = pool.Exec(ctx, `ALTER TABLE taskflow.issue ADD COLUMN IF NOT EXISTS status text DEFAULT 'todo';ALTER TABLE taskflow.agent_task_queue ADD COLUMN IF NOT EXISTS issue_id uuid;ALTER TABLE taskflow.agent_task_queue ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';ALTER TABLE taskflow.agent_task_queue ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) SELECT workspace_id,'G1 no project no queue','agent',id FROM taskflow.agent WHERE system_key='CO-01';INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) VALUES('01a1247f-520e-78eb-aa58-0a0e458185f6','G1 human excluded','member','ac5afcc7-f045-41a9-8827-eaf085a04c0d');`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM taskflow.issue WHERE title LIKE 'G1 %'`)
	req := httptest.NewRequest("GET", "/?workspace_id=01a1247f-520e-78eb-aa58-0a0e458185f6", nil)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), "01a1247f-520e-78eb-aa58-0a0e458185f6", db.Member{UserID: owner, WorkspaceID: ws, Role: "owner"}))
	req.Header.Set("X-User-ID", uuidToString(owner))
	w := httptest.NewRecorder()
	h.ListZhugeNativeAITasks(w, req)
	if w.Code != 200 {
		t.Fatalf("code %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Total int               `json:"total"`
		Tasks []zhugeNativeTask `json:"tasks"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Total != 1 || len(out.Tasks) != 1 || out.Tasks[0].Title != "G1 no project no queue" || out.Tasks[0].ProjectID != "" || out.Tasks[0].TaskFlowTaskID != "" {
		t.Fatalf("lost assignee-only issue or admitted human: %s", w.Body.String())
	}
	var a db.Agent
	a.OwnerID = owner
	a.PermissionMode = "private"
	if !memberAllowedToViewAgent(a, nil, uuidToString(owner), "member") {
		t.Fatal("owner denied")
	}
	if memberAllowedToViewAgent(a, nil, "00000000-0000-0000-0000-000000000001", "member") {
		t.Fatal("other member private access admitted")
	}
}

func TestG1NativeAuthAndContextBinding(t *testing.T) {
	h := &Handler{}
	ws := util.MustParseUUID("01a1247f-520e-78eb-aa58-0a0e458185f6")
	owner := util.MustParseUUID("ac5afcc7-f045-41a9-8827-eaf085a04c0d")
	for _, which := range []string{"unauthenticated", "wrong-user", "wrong-workspace"} {
		req := httptest.NewRequest("GET", "/?workspace_id="+uuidToString(ws), nil)
		member := db.Member{UserID: owner, WorkspaceID: ws, Role: "owner"}
		req = req.WithContext(middleware.SetMemberContext(req.Context(), uuidToString(ws), member))
		if which != "unauthenticated" {
			req.Header.Set("X-User-ID", uuidToString(owner))
		}
		if which == "wrong-user" {
			req.Header.Set("X-User-ID", "00000000-0000-0000-0000-000000000001")
		}
		if which == "wrong-workspace" {
			member.WorkspaceID = util.MustParseUUID("00000000-0000-0000-0000-000000000001")
			req = req.WithContext(middleware.SetMemberContext(req.Context(), uuidToString(ws), member))
		}
		w := httptest.NewRecorder()
		h.ListZhugeNativeAITasks(w, req)
		if w.Code != 401 && w.Code != 403 {
			t.Fatalf("%s admitted: %d", which, w.Code)
		}
	}
}

func TestG1NativeNoProjectAgentPrivateAndQueue(t *testing.T) {
	url := os.Getenv("G1_READBACK_TEST_URL")
	if url == "" {
		if os.Getenv("G1_READBACK_REQUIRED") == "1" {
			t.Fatal("required isolated fixture missing")
		}
		t.Skip("isolated readback fixture not selected")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := &Handler{DB: pool, Queries: db.New(pool)}
	ws := util.MustParseUUID("01a1247f-520e-78eb-aa58-0a0e458185f6")
	owner := util.MustParseUUID("ac5afcc7-f045-41a9-8827-eaf085a04c0d")
	other := util.MustParseUUID("00000000-0000-0000-0000-000000000001")
	_, err = pool.Exec(ctx, `ALTER TABLE taskflow.member ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
 UPDATE taskflow.project SET lead_id=NULL WHERE lead_id=(SELECT id FROM taskflow.agent WHERE system_key='GH-HELPER');
 INSERT INTO taskflow.member(workspace_id,user_id,role) VALUES('01a1247f-520e-78eb-aa58-0a0e458185f6','00000000-0000-0000-0000-000000000001','member');
 INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) SELECT workspace_id,'G1 zero-project agent','agent',id FROM taskflow.agent WHERE system_key='GH-HELPER';
 INSERT INTO taskflow.agent_task_queue(agent_id,issue_id,status,created_at) SELECT a.id,i.id,'completed','2026-01-01' FROM taskflow.agent a,taskflow.issue i WHERE a.system_key='GH-HELPER' AND i.title='G1 zero-project agent';
 INSERT INTO taskflow.agent_task_queue(agent_id,issue_id,status,created_at) SELECT a.id,i.id,'failed','2026-01-02' FROM taskflow.agent a,taskflow.issue i WHERE a.system_key='CO-01' AND i.title='G1 zero-project agent';`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM taskflow.agent_task_queue WHERE issue_id IN(SELECT id FROM taskflow.issue WHERE title='G1 zero-project agent');DELETE FROM taskflow.issue WHERE title='G1 zero-project agent';DELETE FROM taskflow.member WHERE user_id='00000000-0000-0000-0000-000000000001';UPDATE taskflow.project SET lead_id=(SELECT id FROM taskflow.agent WHERE system_key='GH-HELPER') WHERE title='GH-HELPER 原生專案';`)
	read := func(uid pgtype.UUID, role string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/?workspace_id="+uuidToString(ws), nil)
		req.Header.Set("X-User-ID", uuidToString(uid))
		req = req.WithContext(middleware.SetMemberContext(req.Context(), uuidToString(ws), db.Member{UserID: uid, WorkspaceID: ws, Role: role}))
		w := httptest.NewRecorder()
		h.ListZhugeNativeAITasks(w, req)
		return w
	}
	w := read(owner, "owner")
	if w.Code != 200 {
		t.Fatalf("owner %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Total int               `json:"total"`
		Tasks []zhugeNativeTask `json:"tasks"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, task := range out.Tasks {
		if task.Title == "G1 zero-project agent" {
			found = true
			if task.ProjectID != "" || task.TaskFlowTaskStatus != "failed" {
				t.Fatalf("wrong canonical queue or project: %+v", task)
			}
		}
	}
	if !found {
		t.Fatal("zero-project agent issue omitted")
	}
	w = read(other, "member")
	if w.Code != 200 {
		t.Fatalf("other %d %s", w.Code, w.Body.String())
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Tasks) != 0 {
		t.Fatalf("private task disclosed: %s", w.Body.String())
	}
}

func TestG1NativeProjectWorkspaceBoundaries(t *testing.T) {
	url := os.Getenv("G1_READBACK_TEST_URL")
	if url == "" {
		if os.Getenv("G1_READBACK_REQUIRED") == "1" {
			t.Fatal("required isolated fixture missing")
		}
		t.Skip("isolated fixture not selected")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := &Handler{DB: pool, Queries: db.New(pool)}
	ws := util.MustParseUUID("01a1247f-520e-78eb-aa58-0a0e458185f6")
	owner := util.MustParseUUID("ac5afcc7-f045-41a9-8827-eaf085a04c0d")
	_, err = pool.Exec(ctx, `INSERT INTO taskflow.project(workspace_id,title,lead_type,lead_id) SELECT '00000000-0000-0000-0000-000000000099','G1 foreign project','agent',id FROM taskflow.agent WHERE system_key='CO-01';
 INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id,project_id) SELECT a.workspace_id,'G1 foreign project issue','agent',a.id,p.id FROM taskflow.agent a,taskflow.project p WHERE a.system_key='CO-01' AND p.title='G1 foreign project';
 INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id,project_id) SELECT a.workspace_id,'G1 own project issue','agent',a.id,p.id FROM taskflow.agent a,taskflow.project p WHERE a.system_key='CO-01' AND p.title='G1 second project';
 INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) SELECT '00000000-0000-0000-0000-000000000099','G1 foreign issue','agent',id FROM taskflow.agent WHERE system_key='CO-01';`)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM taskflow.issue WHERE title LIKE 'G1 %issue';DELETE FROM taskflow.project WHERE title='G1 foreign project';`)
	req := httptest.NewRequest("GET", "/?workspace_id="+uuidToString(ws), nil)
	req.Header.Set("X-User-ID", uuidToString(owner))
	req = req.WithContext(middleware.SetMemberContext(req.Context(), uuidToString(ws), db.Member{UserID: owner, WorkspaceID: ws, Role: "owner"}))
	mappings, err := h.loadZhugeNativeProjectMappings(req, uuidToString(ws), db.Member{UserID: owner, WorkspaceID: ws, Role: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range mappings {
		for _, p := range m.Projects {
			if p.Title == "G1 foreign project" {
				t.Fatal("foreign project leaked")
			}
		}
	}
	w := httptest.NewRecorder()
	h.ListZhugeNativeAITasks(w, req)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var out struct {
		Total int               `json:"total"`
		Tasks []zhugeNativeTask `json:"tasks"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Total != 2 || len(out.Tasks) != 2 {
		t.Fatalf("wrong workspace total: %s", w.Body.String())
	}
	own, foreign := false, false
	for _, task := range out.Tasks {
		switch task.Title {
		case "G1 foreign issue":
			t.Fatal("foreign workspace Issue leaked")
		case "G1 foreign project issue":
			foreign = true
			if task.ProjectID != "" || task.ProjectTitle != "" {
				t.Fatal("foreign project metadata leaked")
			}
		case "G1 own project issue":
			own = true
			if task.ProjectID == "" {
				t.Fatal("own project lost")
			}
		}
	}
	if !own || !foreign {
		t.Fatal("assignee issues incorrectly filtered")
	}
}
