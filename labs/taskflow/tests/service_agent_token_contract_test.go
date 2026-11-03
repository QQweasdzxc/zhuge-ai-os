package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type satFixture struct {
	agent, issue, token, tokenID string
	router                       http.Handler
}

func newSATFixture(t *testing.T) satFixture {
	t.Helper()
	if testPool == nil || testHandler == nil {
		t.Fatal("SAT contract requires migrated PostgreSQL; no skips")
	}
	f := satFixture{agent: dbfx.Agent(t, "sat-"+uuid.NewString(), ""), issue: dbfx.Issue(t, "SAT contract"), token: "sat_" + uuid.NewString(), tokenID: uuid.NewString()}
	_, err := testPool.Exec(context.Background(), `INSERT INTO taskflow.service_agent_tokens(id,agent_id,workspace_id,name,token_hash,created_by) VALUES($1,$2,$3,'contract',$4,$5)`, f.tokenID, f.agent, testWorkspaceID, auth.HashToken(f.token), testUserID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM taskflow.service_agent_tokens WHERE id=$1`, f.tokenID)
	})
	r := chi.NewRouter()
	r.Use(middleware.Auth(testHandler.Queries, nil, nil, nil))
	r.Post("/api/upload-file", testHandler.UploadFile)
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireWorkspaceMember(testHandler.Queries))
		r.Get("/api/issues", testHandler.ListIssues)
		r.Post("/api/issues", testHandler.CreateIssue)
		r.Get("/api/issues/{id}", testHandler.GetIssue)
		r.Put("/api/issues/{id}", testHandler.UpdateIssue)
		r.Post("/api/issues/{id}/comments", testHandler.CreateComment)
		r.Get("/api/issues/{id}/comments", testHandler.ListComments)
		r.Get("/api/attachments/{id}", testHandler.GetAttachmentByID)
		r.Get("/api/me", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
		r.With(RequireHumanActor).Post("/api/agents/{id}/service-tokens", testHandler.CreateServiceAgentToken)
		r.With(RequireHumanActor).Get("/api/agents/{id}/service-tokens", testHandler.ListServiceAgentTokens)
		r.With(RequireHumanActor).Delete("/api/agents/{id}/service-tokens/{tokenId}", testHandler.RevokeServiceAgentToken)
	})
	f.router = r
	return f
}
func (f satFixture) call(t *testing.T, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+f.token)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}
func satWant(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d want %d: %s", w.Code, status, w.Body.String())
	}
}
func satHuman(t *testing.T) string {
	t.Helper()
	s, e := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": testUserID, "exp": time.Now().Add(time.Hour).Unix()}).SignedString(auth.JWTSecret())
	if e != nil {
		t.Fatal(e)
	}
	return s
}

// Required security contract 1: real writes, not just header inspection.
func TestServiceAgentTokenAgentAttribution(t *testing.T) {
	f := newSATFixture(t)
	w := f.call(t, "POST", "/api/issues/"+f.issue+"/comments", `{"content":"SAT authorship"}`, nil)
	satWant(t, w, 201)
	var authorType, author string
	dbfx.QueryRow(t, `SELECT author_type,author_id::text FROM comment WHERE issue_id=$1 AND content='SAT authorship'`, f.issue).Scan(&authorType, &author)
	if authorType != "agent" || author != f.agent {
		t.Fatalf("wrong author %s/%s", authorType, author)
	}
	if dbfx.Count(t, `SELECT count(*) FROM taskflow.service_agent_tokens WHERE id=$1 AND last_used_at IS NOT NULL`, f.tokenID) != 1 {
		t.Fatal("last_used_at not written")
	}

	oldStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	t.Cleanup(func() { testHandler.Storage = oldStorage })
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", "agent.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte("SAT attachment")); err != nil {
		t.Fatal(err)
	}
	if err = form.WriteField("issue_id", f.issue); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/upload-file", &body)
	req.Header.Set("Authorization", "Bearer "+f.token)
	req.Header.Set("Content-Type", form.FormDataContentType())
	uploaded := httptest.NewRecorder()
	f.router.ServeHTTP(uploaded, req)
	satWant(t, uploaded, 200)
	var att AttachmentResponse
	if json.Unmarshal(uploaded.Body.Bytes(), &att) != nil || att.ID == "" {
		t.Fatal("attachment not persisted")
	}
	var uploader string
	dbfx.QueryRow(t, `SELECT uploader_id::text FROM attachment WHERE id=$1 AND uploader_type='agent' AND workspace_id=$2`, att.ID, testWorkspaceID).Scan(&uploader)
	if uploader != f.agent {
		t.Fatal("attachment has wrong agent")
	}
	satWant(t, f.call(t, "GET", "/api/attachments/"+att.ID, "", nil), 200)

	statusEvents := make(chan events.Event, 1)
	testHandler.Bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		if issue, ok := payload["issue"].(IssueResponse); ok && issue.ID == f.issue {
			select {
			case statusEvents <- e:
			default:
			}
		}
	})
	satWant(t, f.call(t, "PUT", "/api/issues/"+f.issue, `{"status":"in_progress"}`, nil), 200)
	select {
	case e := <-statusEvents:
		if e.ActorType != "agent" || e.ActorID != f.agent {
			t.Fatalf("wrong status actor: %+v", e)
		}
	default:
		t.Fatal("status event missing")
	}

}
func TestServiceAgentTokenRevoked(t *testing.T) {
	f := newSATFixture(t)
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", nil), 200)
	dbfx.Exec(t, `UPDATE taskflow.service_agent_tokens SET revoked_at=now() WHERE id=$1`, f.tokenID)
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", nil), 401)
}
func TestServiceAgentTokenExpired(t *testing.T) {
	f := newSATFixture(t)
	dbfx.Exec(t, `UPDATE taskflow.service_agent_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1`, f.tokenID)
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", nil), 401)
	f.token = "sat_unknown"
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", nil), 401)
}
func TestServiceAgentTokenCrossWorkspace(t *testing.T) {
	f := newSATFixture(t)
	other := dbfx.Workspace(t, "SAT other", "sat-other-"+uuid.NewString())
	dbfx.Insert(t, "member", testutil.Cols{"workspace_id": other, "user_id": testUserID, "role": "owner"})
	issue := dbfx.Issue(t, "foreign", testutil.Cols{"workspace_id": other})
	for _, path := range []string{"/api/issues/" + issue, "/api/issues?workspace_id=" + other, "/api/issues?workspace_id=" + testWorkspaceID + "&workspace_id=" + other, "/api/issues?workspace_slug=sat-other"} {
		satWant(t, f.call(t, "GET", path, "", nil), 403)
	}
	for k, v := range map[string]string{"X-Workspace-ID": other, "X-Workspace-Slug": "sat-other"} {
		satWant(t, f.call(t, "GET", "/api/issues", "", map[string]string{k: v}), 403)
	}
	att := dbfx.Insert(t, "attachment", testutil.Cols{"workspace_id": other, "issue_id": issue, "uploader_type": "member", "uploader_id": testUserID, "filename": "x.txt", "url": "https://example.test/x", "content_type": "text/plain", "size_bytes": 1})
	satWant(t, f.call(t, "GET", "/api/attachments/"+att, "", nil), 403)
}

// Create-only scope: SAT may create issues and the creation carries true
// agent attribution (creator_type=agent), closing the member-identity hole
// where UI-session creation recorded the human owner.
func TestServiceAgentTokenCreateIssueAttribution(t *testing.T) {
	f := newSATFixture(t)
	w := f.call(t, "POST", "/api/issues", `{"title":"SAT created card"}`, nil)
	satWant(t, w, 201)
	var creatorType, creator string
	dbfx.QueryRow(t, `SELECT creator_type,creator_id::text FROM issue WHERE title='SAT created card'`).Scan(&creatorType, &creator)
	if creatorType != "agent" || creator != f.agent {
		t.Fatalf("wrong creator %s/%s", creatorType, creator)
	}
}

func TestServiceAgentTokenDefaultDeny(t *testing.T) {
	f := newSATFixture(t)
	noDB := middleware.Auth(nil, nil, nil, nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("SAT passed without database") }))
	denied := httptest.NewRecorder()
	missing := httptest.NewRequest("GET", "/api/issues", nil)
	missing.Header.Set("Authorization", "Bearer "+f.token)
	noDB.ServeHTTP(denied, missing)
	satWant(t, denied, 401)

	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/me", ""}, {"GET", "/api/agents", ""},
		{"DELETE", "/api/issues/" + f.issue, ""}, {"POST", "/api/issues/" + f.issue + "/rerun", ""},
		{"PUT", "/api/issues/" + f.issue, `{"status":"done","title":"bad"}`},
		{"POST", "/api/agents/" + f.agent + "/service-tokens", `{"name":"bad"}`},
		{"GET", "/api/issues/../me", ""}, {"GET", "/api//issues", ""},
	} {
		satWant(t, f.call(t, tc.method, tc.path, tc.body, nil), 403)
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/billing", nil)
	req.Header.Set("X-Actor-Source", "service_agent_token")
	RequireHumanActor(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("human guard bypassed") })).ServeHTTP(w, req)
	satWant(t, w, 403)
}
func TestServiceAgentTokenForgedHeaders(t *testing.T) {
	f := newSATFixture(t)
	forged := map[string]string{"X-Agent-ID": uuid.NewString(), "X-Actor-Source": "member", "X-User-ID": uuid.NewString(), "X-Task-ID": uuid.NewString()}
	var gotAgent, gotUser, gotSource, gotTask string
	f.router = middleware.Auth(testHandler.Queries, nil, nil, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAgent = r.Header.Get("X-Agent-ID")
		gotUser = r.Header.Get("X-User-ID")
		gotSource = r.Header.Get("X-Actor-Source")
		gotTask = r.Header.Get("X-Task-ID")
	}))
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", forged), 200)
	if gotAgent != f.agent || gotUser != testUserID || gotSource != "service_agent_token" || gotTask != "" {
		t.Fatalf("forgery survived: %s/%s/%s/%s", gotAgent, gotUser, gotSource, gotTask)
	}
	// Human JWT cannot forge the SAT agent attribution either.
	f.token = satHuman(t)
	forged["X-Actor-Source"] = "service_agent_token"
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", forged), 200)
	if gotAgent != "" || gotSource != "" || gotUser != testUserID {
		t.Fatal("human forged machine identity")
	}
}
func TestServiceAgentTokenLifecycle(t *testing.T) {
	f := newSATFixture(t)
	f.token = satHuman(t)
	headers := map[string]string{"X-Workspace-ID": testWorkspaceID}
	path := "/api/agents/" + f.agent + "/service-tokens"
	w := f.call(t, "POST", path, `{"name":"lifecycle"}`, headers)
	satWant(t, w, 201)
	var issued struct{ ID, Token string }
	if json.Unmarshal(w.Body.Bytes(), &issued) != nil || !strings.HasPrefix(issued.Token, "sat_") || len(issued.Token) != 68 {
		t.Fatal("invalid one-time token response")
	}
	var hash string
	dbfx.QueryRow(t, `SELECT token_hash FROM taskflow.service_agent_tokens WHERE id=$1`, issued.ID).Scan(&hash)
	if hash != auth.HashToken(issued.Token) {
		t.Fatal("plaintext stored or wrong hash")
	}
	w = f.call(t, "GET", path, "", headers)
	satWant(t, w, 200)
	if strings.Contains(w.Body.String(), issued.Token) || strings.Contains(w.Body.String(), hash) || strings.Contains(w.Body.String(), "token_hash") {
		t.Fatal("listing leaks token material")
	}
	satWant(t, f.call(t, "DELETE", path+"/"+issued.ID, "", headers), 204)
	var count int
	dbfx.QueryRow(t, `SELECT count(*) FROM activity_log WHERE details->>'token_id'=$1 AND action IN ('service_agent_token_created','service_agent_token_revoked')`, issued.ID).Scan(&count)
	if count != 2 {
		t.Fatalf("missing audit entries: %d", count)
	}
	f.token = issued.Token
	satWant(t, f.call(t, "GET", "/api/issues/"+f.issue, "", nil), 401)
}
func TestServiceAgentTokenOwnerAndExpiry(t *testing.T) {
	f := newSATFixture(t)
	f.token = satHuman(t)
	headers := map[string]string{"X-Workspace-ID": testWorkspaceID}
	path := "/api/agents/" + f.agent + "/service-tokens"
	for _, body := range []string{`{"name":"x","expires_at":"2000-01-01T00:00:00Z"}`, fmt.Sprintf(`{"name":"x","expires_at":%q}`, time.Now().Add(91*24*time.Hour).Format(time.RFC3339)), `{"name":""}`, `{"name":"x","token_hash":"forged"}`} {
		satWant(t, f.call(t, "POST", path, body, headers), 400)
	}
	// Owning the workspace does not authorize another owner's private identity.
	otherHuman := dbfx.User(t, "SAT other owner", "sat-private-"+uuid.NewString()+"@multica.test")
	dbfx.Insert(t, "member", testutil.Cols{"workspace_id": testWorkspaceID, "user_id": otherHuman, "role": "owner"})
	otherAgent := dbfx.Agent(t, "SAT private other owner", "", testutil.Cols{"owner_id": otherHuman, "permission_mode": "private", "visibility": "private"})
	otherPath := "/api/agents/" + otherAgent + "/service-tokens"
	for _, method := range []string{"POST", "GET", "DELETE"} {
		p := otherPath
		if method == "DELETE" {
			p += "/" + f.tokenID
		}
		satWant(t, f.call(t, method, p, `{"name":"must not impersonate"}`, headers), 403)
	}
	bound := newSATFixture(t)
	dbfx.Exec(t, `UPDATE agent SET owner_id=$2 WHERE id=$1`, bound.agent, otherHuman)
	satWant(t, bound.call(t, "GET", "/api/issues/"+bound.issue, "", nil), 401)
	dbfx.Exec(t, `UPDATE member SET role='admin' WHERE workspace_id=$1 AND user_id=$2`, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `UPDATE member SET role='owner' WHERE workspace_id=$1 AND user_id=$2`, testWorkspaceID, testUserID)
	})
	for _, method := range []string{"POST", "GET", "DELETE"} {
		p := path
		if method == "DELETE" {
			p += "/" + f.tokenID
		}
		satWant(t, f.call(t, method, p, `{"name":"bad"}`, headers), 403)
	}
}

type satAuditFailureStarter struct{ pool *pgxpool.Pool }
type satAuditFailureTx struct{ pgx.Tx }

func (s satAuditFailureStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, e := s.pool.Begin(ctx)
	return satAuditFailureTx{tx}, e
}
func (s satAuditFailureTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "-- name: CreateActivity") {
		return satFailedRow{}
	}
	return s.Tx.QueryRow(ctx, sql, args...)
}

type satFailedRow struct{}

func (satFailedRow) Scan(...any) error { return errors.New("injected audit failure") }
func TestServiceAgentTokenAuditAtomicity(t *testing.T) {
	f := newSATFixture(t)
	h := *testHandler
	h.TxStarter = satAuditFailureStarter{testPool}
	r := chi.NewRouter()
	r.Post("/api/agents/{id}/service-tokens", h.CreateServiceAgentToken)
	r.Delete("/api/agents/{id}/service-tokens/{tokenId}", h.RevokeServiceAgentToken)
	call := func(method, path string) {
		req := httptest.NewRequest(method, path, strings.NewReader(`{"name":"must rollback"}`))
		req.Header.Set("X-User-ID", testUserID)
		req.Header.Set("X-Workspace-ID", testWorkspaceID)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		satWant(t, w, 500)
	}
	path := "/api/agents/" + f.agent + "/service-tokens"
	call("POST", path)
	if dbfx.Count(t, `SELECT count(*) FROM taskflow.service_agent_tokens WHERE agent_id=$1`, f.agent) != 1 {
		t.Fatal("failed audit left token")
	}
	call("DELETE", path+"/"+f.tokenID)
	if dbfx.Count(t, `SELECT count(*) FROM taskflow.service_agent_tokens WHERE id=$1 AND revoked_at IS NULL`, f.tokenID) != 1 {
		t.Fatal("failed audit revoked token")
	}
}
