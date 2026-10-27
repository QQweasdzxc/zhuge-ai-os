package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// These tests exercise unchanged native HTTP/service execution gates. Planning
// eligibility in the UI must never turn into a runtime/invocation grant.
func taskFlowInertPlanningAgent(t *testing.T) string {
	t.Helper()
	id := createPrivateAgentOwnedBy(t, "TaskFlow inert planning", testUserID)
	if _, err := testPool.Exec(context.Background(), `UPDATE agent SET runtime_id=NULL WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestTaskFlowBacklogOwnerCreateAndEditNeverEnqueue(t *testing.T) {
	agentID := taskFlowInertPlanningAgent(t)
	issue := createIssueForTest(t, map[string]any{"title": "STEP2 inert test", "status": "backlog", "assignee_type": "agent", "assignee_id": agentID})
	if issue.Status != "backlog" || issue.AssigneeID == nil || *issue.AssigneeID != agentID {
		t.Fatalf("wrong native issue: %+v", issue)
	}
	for _, body := range []map[string]any{{"title": "STEP2 inert edited"}, {"project_id": nil}, {"assignee_type": "agent", "assignee_id": agentID}} {
		w := httptest.NewRecorder()
		testHandler.UpdateIssue(w, withURLParam(newRequest("PUT", "/api/issues/"+issue.ID, body), "id", issue.ID))
		if w.Code != http.StatusOK {
			t.Fatalf("edit: %d %s", w.Code, w.Body.String())
		}
		if got := taskCountFor(t, issue.ID, agentID); got != 0 {
			t.Fatalf("inert edit queued %d runs", got)
		}
	}
	pv := previewIssueTrigger(t, map[string]any{"issue_ids": []string{issue.ID}, "status": "todo"})
	if pv.TotalCount != 0 {
		t.Fatalf("unbound promotion preview promised runtime: %+v", pv)
	}
}

func TestTaskFlowBacklogUnboundPromotionAndRerunStayBlocked(t *testing.T) {
	agentID := taskFlowInertPlanningAgent(t)
	issue := createIssueForTest(t, map[string]any{"title": "inert promotion", "status": "backlog", "assignee_type": "agent", "assignee_id": agentID})
	w := httptest.NewRecorder()
	testHandler.UpdateIssue(w, withURLParam(newRequest("PUT", "/api/issues/"+issue.ID, map[string]any{"status": "todo"}), "id", issue.ID))
	if w.Code != http.StatusOK {
		t.Fatalf("promotion: %d %s", w.Code, w.Body.String())
	}
	if got := taskCountFor(t, issue.ID, agentID); got != 0 {
		t.Fatalf("unbound promotion queued %d runs", got)
	}
	w = httptest.NewRecorder()
	testHandler.RerunIssue(w, withURLParam(newRequest("POST", "/api/issues/"+issue.ID+"/rerun", nil), "id", issue.ID))
	if w.Code >= 200 && w.Code < 300 {
		t.Fatalf("unbound rerun admitted: %d %s", w.Code, w.Body.String())
	}
	if got := taskCountFor(t, issue.ID, agentID); got != 0 {
		t.Fatalf("unbound rerun queued %d runs", got)
	}
}

func TestTaskFlowBacklogDoesNotBypassPrivateInvocationGate(t *testing.T) {
	agentID, _, _ := privateAgentTestFixture(t)
	if _, err := testPool.Exec(context.Background(), `UPDATE agent SET runtime_id=NULL WHERE id=$1`, agentID); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	testHandler.CreateIssue(w, newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{"title": "must deny", "status": "backlog", "assignee_type": "agent", "assignee_id": agentID}))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-owner private backlog: expected403 got%d %s", w.Code, w.Body.String())
	}
	issue := createIssueForTest(t, map[string]any{"title": "deny reassignment", "status": "backlog"})
	w = httptest.NewRecorder()
	testHandler.UpdateIssue(w, withURLParam(newRequest("PUT", "/api/issues/"+issue.ID, map[string]any{"assignee_type": "agent", "assignee_id": agentID}), "id", issue.ID))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-owner private update: expected403 got%d %s", w.Code, w.Body.String())
	}
	if got := taskCountFor(t, issue.ID, agentID); got != 0 {
		t.Fatalf("denied assign queued %d", got)
	}
}
