package handler

// DeleteAttachment must publish the RESOLVED actor on both event branches:
// issue-bound (EventIssueAttachmentsChanged) and comment-bound
// (EventCommentUpdated). Human member deletes stay member/<user>; SAT and
// mat_ task-token deletes are credited to the agent, not to the credential's
// human creator. Authorization (uploader or workspace admin/owner) is
// unchanged by the fix these tests cover. SAT cases live in
// service_agent_token_contract_test.go (TestServiceAgentTokenAttachmentDeleteScope).

import (
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// attachmentActorFixture builds one issue-bound and one comment-bound
// attachment with the given uploader and returns their ids plus subscriptions
// for both delete event branches.
func attachmentActorFixture(t *testing.T, uploaderType, uploaderID string) (issueAtt, commentAtt string, issueEvents, commentEvents chan events.Event) {
	t.Helper()
	issueID := dbfx.Issue(t, "delete actor issue")
	issueAtt = dbfx.Insert(t, "attachment", testutil.Cols{"workspace_id": testWorkspaceID, "issue_id": issueID, "uploader_type": uploaderType, "uploader_id": uploaderID, "filename": "issue-bound.txt", "url": "https://example.test/ib", "content_type": "text/plain", "size_bytes": 1})
	commentID := dbfx.Comment(t, issueID, "delete actor comment", testutil.Cols{"author_type": uploaderType, "author_id": uploaderID})
	commentAtt = dbfx.Insert(t, "attachment", testutil.Cols{"workspace_id": testWorkspaceID, "issue_id": issueID, "comment_id": commentID, "uploader_type": uploaderType, "uploader_id": uploaderID, "filename": "comment-bound.txt", "url": "https://example.test/cb", "content_type": "text/plain", "size_bytes": 1})

	issueEvents = make(chan events.Event, 1)
	testHandler.Bus.Subscribe(protocol.EventIssueAttachmentsChanged, func(e events.Event) {
		if payload, ok := e.Payload.(map[string]any); ok {
			if id, ok := payload["issue_id"].(string); ok && id == issueID {
				issueEvents <- e
			}
		}
	})
	commentEvents = make(chan events.Event, 1)
	testHandler.Bus.Subscribe(protocol.EventCommentUpdated, func(e events.Event) {
		if payload, ok := e.Payload.(map[string]any); ok {
			if c, ok := payload["comment"].(CommentResponse); ok && c.ID == commentID {
				commentEvents <- e
			}
		}
	})
	return issueAtt, commentAtt, issueEvents, commentEvents
}

func wantDeleteActor(t *testing.T, issueEvents, commentEvents chan events.Event, wantType, wantID string) {
	t.Helper()
	for name, ch := range map[string]chan events.Event{"issue": issueEvents, "comment": commentEvents} {
		select {
		case e := <-ch:
			if e.ActorType != wantType || e.ActorID != wantID {
				t.Fatalf("%s branch: actor %s/%s, want %s/%s", name, e.ActorType, e.ActorID, wantType, wantID)
			}
		default:
			t.Fatalf("%s branch: delete event missing", name)
		}
	}
}

// Human member deletes keep member/<user> attribution on both branches.
func TestAttachmentDeletePublishesHumanMember(t *testing.T) {
	f := newSATFixture(t)
	f.token = satHuman(t)

	oldStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	t.Cleanup(func() { testHandler.Storage = oldStorage })

	issueAtt, commentAtt, issueEvents, commentEvents := attachmentActorFixture(t, "member", testUserID)
	satWant(t, f.call(t, "DELETE", "/api/attachments/"+issueAtt, "", nil), 204)
	satWant(t, f.call(t, "DELETE", "/api/attachments/"+commentAtt, "", nil), 204)
	wantDeleteActor(t, issueEvents, commentEvents, "member", testUserID)
}

// mat_ task-token deletes are credited to the agent on both branches. The
// request stamps X-Actor-Source/X-Agent-ID exactly as the auth middleware
// does for a mat_ token (the boundary resolveActor trusts); the router omits
// Auth so the stamped headers survive, mirroring uploadWithTaskID.
func TestAttachmentDeletePublishesTaskTokenAgent(t *testing.T) {
	if testPool == nil || testHandler == nil {
		t.Fatal("contract requires migrated PostgreSQL; no skips")
	}
	agent := dbfx.Agent(t, "mat-delete-"+uuid.NewString(), "")

	oldStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	t.Cleanup(func() { testHandler.Storage = oldStorage })

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireWorkspaceMember(testHandler.Queries))
		r.Delete("/api/attachments/{id}", testHandler.DeleteAttachment)
	})
	call := func(attID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("DELETE", "/api/attachments/"+attID, nil)
		req.Header.Set("X-User-ID", testUserID)
		req.Header.Set("X-Workspace-ID", testWorkspaceID)
		req.Header.Set("X-Actor-Source", "task_token")
		req.Header.Set("X-Agent-ID", agent)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	issueAtt, commentAtt, issueEvents, commentEvents := attachmentActorFixture(t, "member", testUserID)
	satWant(t, call(issueAtt), 204)
	satWant(t, call(commentAtt), 204)
	wantDeleteActor(t, issueEvents, commentEvents, "agent", agent)
}
