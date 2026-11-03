package main

import (
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// SAT attribution end-to-end: the SAT handlers publish issue-created and
// status-changed events with ActorType=agent and the agent's id (contract-
// tested in internal/handler). The activity listener must persist that
// actor into activity_log, or the timeline credits the wrong actor for
// service-agent writes. Reuses the integration harness (testPool,
// testWorkspaceID, testUserID) and helpers from subscriber_listeners_test.go
// and activity_listeners_test.go.
func TestSATActivityAgentAttribution(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerActivityListeners(bus, queries)

	// No FK on activity_log.actor_id; a synthetic agent id keeps the fixture
	// to just an issue.
	agentID := "00000000-0000-4000-8000-0000000000a1"
	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupActivities(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "agent",
		ActorID:     agentID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "SAT activity attribution",
				Status:      "todo",
				Priority:    "medium",
				CreatorType: "agent",
				CreatorID:   agentID,
			},
		},
	})
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "agent",
		ActorID:     agentID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "SAT activity attribution",
				Status:      "in_progress",
				Priority:    "medium",
				CreatorType: "agent",
				CreatorID:   agentID,
			},
			"status_changed": true,
			"prev_status":    "todo",
		},
	})

	activities := listActivitiesForIssue(t, queries, issueID)
	if len(activities) != 2 {
		t.Fatalf("expected 2 activities, got %d", len(activities))
	}
	byAction := map[string]db.ActivityLog{}
	for _, a := range activities {
		byAction[a.Action] = a
	}
	created, ok := byAction["created"]
	if !ok {
		t.Fatalf("missing created activity: %+v", activities)
	}
	if created.ActorType.String != "agent" || util.UUIDToString(created.ActorID) != agentID {
		t.Fatalf("created activity has wrong actor: %+v", created)
	}
	statusChanged, ok := byAction["status_changed"]
	if !ok {
		t.Fatalf("missing status_changed activity: %+v", activities)
	}
	if statusChanged.ActorType.String != "agent" || util.UUIDToString(statusChanged.ActorID) != agentID {
		t.Fatalf("status_changed activity has wrong actor: %+v", statusChanged)
	}
}
