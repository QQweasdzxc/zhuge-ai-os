package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
)

var (
	errNativeReportUnverified       = errors.New("provider report is not server verified")
	errNativeReportAuthorityMissing = errors.New("native dispatch authority is unavailable")
	errNativeReportReplay           = errors.New("native report replay or sequence conflict")
	errNativeReportScope            = errors.New("native report scope does not match TaskFlow authority")
	errNativeReportVersionConflict  = errors.New("native Issue changed since the previous report")
	errNativeReportProjection       = errors.New("native Agent Task Queue projection is invalid")
	errNativeReportProtectedDetail  = errors.New("protected detail store is not wired")
)

// nativeAgentReportEvent is an internal server-to-server projection. The
// verifier bit is deliberately unexported: no request decoder or browser DTO
// can construct an accepted event. A Provider ingress must verify its official
// signature and the persisted ACK before calling applyVerifiedNativeAgentReport.
// No Provider ingress is currently registered, so production delivery remains
// blocked even though the TaskFlow persistence adapter is implemented.
type nativeAgentReportEvent struct {
	EventID, DispatchID, IssueID, WorkspaceID string
	ExecutorID, Provider, ProviderRunID       string
	SessionID, ProviderAckEventID             string
	LeaseID, EventType                        string
	FencingEpoch, Sequence                    int64
	ProgressPercent                           int32
	HasProgress                               bool
	HasProtectedDetails                       bool
	providerAttestationVerified               bool
}

type nativeAgentReportWriteResult struct {
	Committed bool
	Replay    bool
	Status    string
	IssueID   string
	Revision  int64
}

func nativeAgentReportStatus(eventType string) (string, bool) {
	switch eventType {
	case "accepted", "progress", "checkpoint":
		return "in_progress", true
	case "blocked", "question_to_cto":
		return "blocked", true
	case "review_requested", "completed":
		return "in_review", true
	default:
		return "", false
	}
}

func nativeAgentReportComment(event nativeAgentReportEvent) string {
	labels := map[string]string{
		"accepted": "已接單", "progress": "進度更新", "checkpoint": "Checkpoint",
		"blocked": "卡關回報", "question_to_cto": "等待 CTO 回覆",
		"review_requested": "提交 CTO 稽核", "completed": "完成回報，等待 CTO 稽核",
	}
	content := "[AI 回報] " + labels[event.EventType]
	if event.HasProgress {
		content += fmt.Sprintf(" · %d%%", event.ProgressPercent)
	}
	return content
}

func nativeAgentReportUUID(event nativeAgentReportEvent) string {
	sum := sha256.Sum256([]byte("taskflow-native-agent-report-v1\x00" + event.WorkspaceID + "\x00" + event.DispatchID + "\x00" + event.EventID))
	b := sum[:16]
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(b)
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:32]
}

func boundedNativeReportValue(value string) bool {
	return len(value) > 0 && len(value) <= 512 && !strings.ContainsAny(value, "\r\n\x00")
}

func nativeReportQueueProjection(raw []byte) (map[string]any, map[string]any, error) {
	var result map[string]any
	if len(raw) == 0 {
		result = map[string]any{}
	} else if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return nil, nil, errors.New("TaskFlow queue result is not an object")
	}
	previous := map[string]any{}
	if raw, exists := result["zhuge_agent_reporting"]; exists {
		var ok bool
		previous, ok = raw.(map[string]any)
		if !ok || previous == nil {
			return nil, nil, errNativeReportProjection
		}
	}
	return result, previous, nil
}

func nativeReportInteger(value any) (int64, bool) {
	number, ok := value.(float64)
	if !ok || number < 0 || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}

// applyVerifiedNativeAgentReport is the TaskFlow-owned transaction adapter for
// CO-02 reports. It writes only native Issue status, comment, activity_log and
// agent_task_queue.result; it introduces no second task store. Arbitrary Agent
// text is never accepted here. Any protected free text must be persisted by a
// real protected Detail Store first; that adapter is currently unwired, so such
// events fail closed. An event already persisted in both native audit surfaces
// is acknowledged idempotently without replaying any mutation.
func (h *Handler) applyVerifiedNativeAgentReport(ctx context.Context, event nativeAgentReportEvent) (nativeAgentReportWriteResult, error) {
	if !event.providerAttestationVerified {
		return nativeAgentReportWriteResult{}, errNativeReportUnverified
	}
	status, supported := nativeAgentReportStatus(event.EventType)
	if !supported || !boundedNativeReportValue(event.EventID) || !boundedNativeReportValue(event.DispatchID) ||
		!boundedNativeReportValue(event.IssueID) || !boundedNativeReportValue(event.WorkspaceID) ||
		!boundedNativeReportValue(event.ExecutorID) || !boundedNativeReportValue(event.Provider) ||
		!boundedNativeReportValue(event.ProviderRunID) || !boundedNativeReportValue(event.SessionID) ||
		!boundedNativeReportValue(event.ProviderAckEventID) || !boundedNativeReportValue(event.LeaseID) ||
		event.FencingEpoch <= 0 || event.Sequence <= 0 || (event.HasProgress && (event.ProgressPercent < 0 || event.ProgressPercent > 100)) {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	if event.HasProtectedDetails {
		return nativeAgentReportWriteResult{}, errNativeReportProtectedDetail
	}
	if h == nil || h.TxStarter == nil || h.Queries == nil {
		return nativeAgentReportWriteResult{}, errNativeReportAuthorityMissing
	}
	issueUUID, err := util.ParseUUID(event.IssueID)
	if err != nil {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	workspaceUUID, err := util.ParseUUID(event.WorkspaceID)
	if err != nil {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	if _, err := util.ParseUUID(event.DispatchID); err != nil {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	if _, err := util.ParseUUID(event.LeaseID); err != nil {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("begin native report transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var dispatchID, leaseID, workspaceID, issueID, executorID, provider, state string
	var fencingEpoch int64
	var runID, sessionID, ackEventID pgtype.Text
	var leaseActive, stopRequested, providerStopVerified bool
	err = tx.QueryRow(ctx, `
		SELECT d.id::text, d.lease_id::text, d.fencing_epoch, d.workspace_id::text, d.issue_id::text,
		       d.executor_id, d.provider, d.state, d.provider_run_id, d.provider_session_id,
		       d.provider_ack_event_id, d.lease_expires_at > now(),
		       d.stop_requested_at IS NOT NULL, d.provider_stop_verified
		  FROM taskflow.dispatch_intent AS d
		 WHERE d.id = $1::uuid
		 FOR UPDATE`, event.DispatchID).Scan(&dispatchID, &leaseID, &fencingEpoch, &workspaceID, &issueID,
		&executorID, &provider, &state, &runID, &sessionID, &ackEventID, &leaseActive, &stopRequested, &providerStopVerified)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("read native dispatch claim: %w", err)
	}
	if dispatchID != event.DispatchID || leaseID != event.LeaseID || fencingEpoch != event.FencingEpoch ||
		workspaceID != event.WorkspaceID || issueID != event.IssueID || executorID != event.ExecutorID ||
		provider != event.Provider || (state != "provider_acknowledged" && state != "provider_started") ||
		!runID.Valid || runID.String != event.ProviderRunID || !sessionID.Valid || sessionID.String != event.SessionID ||
		!ackEventID.Valid || ackEventID.String != event.ProviderAckEventID || !leaseActive || stopRequested || providerStopVerified {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}

	var projectID, issueStatus, assigneeType string
	var issueRevision int64
	var assigneeID pgtype.Text
	err = tx.QueryRow(ctx, `
		SELECT i.project_id::text, i.status, i.revision, i.assignee_type, i.assignee_id::text
		  FROM issue AS i
		 WHERE i.id = $1::uuid AND i.workspace_id = $2::uuid
		 FOR UPDATE`, issueUUID, workspaceUUID).Scan(&projectID, &issueStatus, &issueRevision, &assigneeType, &assigneeID)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("lock native Issue: %w", err)
	}
	if issueStatus == "done" || issueStatus == "cancelled" {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}

	var agentIDs []string
	rows, err := tx.Query(ctx, `SELECT a.id::text FROM agent AS a WHERE a.workspace_id = $1::uuid AND a.system_key = $2 AND a.archived_at IS NULL ORDER BY a.id FOR UPDATE`, workspaceUUID, event.ExecutorID)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("resolve native Executor: %w", err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nativeAgentReportWriteResult{}, err
		}
		agentIDs = append(agentIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nativeAgentReportWriteResult{}, err
	}
	if len(agentIDs) != 1 || assigneeType != "agent" || !assigneeID.Valid || assigneeID.String != agentIDs[0] {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}

	var projectIDs []string
	projects, err := tx.Query(ctx, `SELECT p.id::text FROM project AS p WHERE p.workspace_id = $1::uuid AND p.lead_type = 'agent' AND p.lead_id = $2::uuid ORDER BY p.id FOR UPDATE`, workspaceUUID, agentIDs[0])
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("resolve native Project: %w", err)
	}
	for projects.Next() {
		var id string
		if err := projects.Scan(&id); err != nil {
			projects.Close()
			return nativeAgentReportWriteResult{}, err
		}
		projectIDs = append(projectIDs, id)
	}
	projects.Close()
	if err := projects.Err(); err != nil {
		return nativeAgentReportWriteResult{}, err
	}
	if len(projectIDs) != 1 || projectIDs[0] != projectID {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}

	type nativeQueueRow struct {
		id, status string
		result     []byte
	}
	var queueRows []nativeQueueRow
	queues, err := tx.Query(ctx, `
		SELECT q.id::text, q.status, COALESCE(q.result, '{}'::jsonb)
		  FROM agent_task_queue AS q
		 WHERE q.issue_id = $1::uuid AND q.agent_id = $2::uuid
		   AND q.status IN ('queued', 'dispatched', 'running')
		 ORDER BY q.created_at DESC, q.id
		 FOR UPDATE`, issueUUID, agentIDs[0])
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("lock native Agent Task Queue: %w", err)
	}
	for queues.Next() {
		var row nativeQueueRow
		if err := queues.Scan(&row.id, &row.status, &row.result); err != nil {
			queues.Close()
			return nativeAgentReportWriteResult{}, err
		}
		queueRows = append(queueRows, row)
	}
	queues.Close()
	if err := queues.Err(); err != nil {
		return nativeAgentReportWriteResult{}, err
	}
	if len(queueRows) != 1 {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	queue := queueRows[0]
	queueUUID, err := util.ParseUUID(queue.id)
	if err != nil {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	queueResult, previous, err := nativeReportQueueProjection(queue.result)
	if err != nil {
		return nativeAgentReportWriteResult{}, err
	}

	commentID := nativeAgentReportUUID(event)
	commentContent := nativeAgentReportComment(event)
	var commentExists, activityExists bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM comment WHERE id = $1::uuid AND issue_id = $2::uuid AND workspace_id = $3::uuid AND content = $4),
		       EXISTS (SELECT 1 FROM activity_log WHERE id = $1::uuid AND issue_id = $2::uuid AND workspace_id = $3::uuid AND details->>'event_id' = $5 AND details->>'dispatch_id' = $6)`,
		commentID, issueUUID, workspaceUUID, commentContent, event.EventID, event.DispatchID).Scan(&commentExists, &activityExists)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("check native report idempotency: %w", err)
	}
	if commentExists && activityExists {
		storedDispatch, _ := previous["dispatch_id"].(string)
		storedEvent, _ := previous["event_id"].(string)
		storedSequence, sequenceOK := nativeReportInteger(previous["sequence"])
		storedEpoch, epochOK := nativeReportInteger(previous["fencing_epoch"])
		storedIssueRevision, revisionOK := nativeReportInteger(previous["issue_revision"])
		if storedDispatch != event.DispatchID || storedEvent != event.EventID || !sequenceOK || storedSequence != event.Sequence ||
			!epochOK || storedEpoch != event.FencingEpoch || !revisionOK || storedIssueRevision <= 0 {
			return nativeAgentReportWriteResult{}, errNativeReportReplay
		}
		if err := tx.Commit(ctx); err != nil {
			return nativeAgentReportWriteResult{}, err
		}
		return nativeAgentReportWriteResult{Committed: true, Replay: true, Status: issueStatus, IssueID: event.IssueID, Revision: issueRevision}, nil
	}
	if commentExists || activityExists {
		return nativeAgentReportWriteResult{}, errNativeReportReplay
	}

	previousSequence, previousEpoch := int64(0), int64(0)
	previousDispatch, _ := previous["dispatch_id"].(string)
	if value, ok := nativeReportInteger(previous["sequence"]); ok {
		previousSequence = value
	}
	if value, ok := nativeReportInteger(previous["fencing_epoch"]); ok {
		previousEpoch = value
	}
	if previousDispatch == event.DispatchID && event.Sequence <= previousSequence {
		return nativeAgentReportWriteResult{}, errNativeReportReplay
	}
	if previousDispatch == event.DispatchID {
		previousIssueRevision, revisionOK := nativeReportInteger(previous["issue_revision"])
		if !revisionOK || previousIssueRevision <= 0 || issueRevision != previousIssueRevision {
			return nativeAgentReportWriteResult{}, errNativeReportVersionConflict
		}
	}
	if issueStatus == "in_review" {
		return nativeAgentReportWriteResult{}, errNativeReportVersionConflict
	}
	if previousDispatch != "" && previousDispatch != event.DispatchID && event.FencingEpoch <= previousEpoch {
		return nativeAgentReportWriteResult{}, errNativeReportReplay
	}
	queueResult["zhuge_agent_reporting"] = map[string]any{
		"dispatch_id": event.DispatchID, "event_id": event.EventID, "sequence": event.Sequence,
		"fencing_epoch": event.FencingEpoch, "state": status, "provider_run_id": event.ProviderRunID,
		"session_id": event.SessionID,
	}

	update := tx.QueryRow(ctx, `UPDATE issue SET status = $4, updated_at = now(), last_activity_at = now(), revision = revision + 1 WHERE id = $1::uuid AND workspace_id = $2::uuid AND revision = $3 AND status NOT IN ('done','cancelled') RETURNING revision`, issueUUID, workspaceUUID, issueRevision, status)
	var newRevision int64
	if err := update.Scan(&newRevision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nativeAgentReportWriteResult{}, errors.New("native Issue version conflict")
		}
		return nativeAgentReportWriteResult{}, fmt.Errorf("update native Issue: %w", err)
	}
	queueResult["zhuge_agent_reporting"].(map[string]any)["issue_revision"] = newRevision
	resultJSON, err := json.Marshal(queueResult)
	if err != nil {
		return nativeAgentReportWriteResult{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO comment (id, issue_id, workspace_id, author_type, author_id, content, type, source_task_id, suppressed_agent_ids) VALUES ($1::uuid,$2::uuid,$3::uuid,'agent',$4::uuid,$5,'progress_update',$6::uuid,ARRAY[$4::uuid])`, commentID, issueUUID, workspaceUUID, agentIDs[0], commentContent, queueUUID)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("write native Issue comment: %w", err)
	}
	details, err := json.Marshal(map[string]any{
		"schema": "taskflow-native-agent-report-v1", "event_id": event.EventID,
		"dispatch_id": event.DispatchID, "executor_id": event.ExecutorID, "provider": event.Provider,
		"provider_run_id": event.ProviderRunID, "session_id": event.SessionID,
		"provider_ack_event_id": event.ProviderAckEventID, "lease_id": event.LeaseID,
		"fencing_epoch": event.FencingEpoch, "sequence": event.Sequence, "event_type": event.EventType,
		"progress_percent": func() any {
			if event.HasProgress {
				return event.ProgressPercent
			}
			return nil
		}(),
	})
	if err != nil {
		return nativeAgentReportWriteResult{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO activity_log (id, workspace_id, issue_id, actor_type, actor_id, action, details) VALUES ($1::uuid,$2::uuid,$3::uuid,'agent',$4::uuid,'agent_report_received',$5::jsonb)`, commentID, workspaceUUID, issueUUID, agentIDs[0], details)
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("write native Issue audit: %w", err)
	}
	queueTag, err := tx.Exec(ctx, `UPDATE agent_task_queue SET result = $2::jsonb WHERE id = $1::uuid AND issue_id = $3::uuid AND agent_id = $4::uuid AND status IN ('queued','dispatched','running')`, queueUUID, resultJSON, issueUUID, agentIDs[0])
	if err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("update native Agent Task Queue readback: %w", err)
	}
	if queueTag.RowsAffected() != 1 {
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	if tag, err := tx.Exec(ctx, `UPDATE taskflow.dispatch_intent SET native_write_state = 'committed', updated_at = now() WHERE id = $1::uuid AND lease_id = $2::uuid AND fencing_epoch = $3 AND provider_run_id = $4 AND provider_session_id = $5 AND provider_ack_event_id = $6 AND state IN ('provider_acknowledged','provider_started') AND lease_expires_at > now() AND stop_requested_at IS NULL`, event.DispatchID, event.LeaseID, event.FencingEpoch, event.ProviderRunID, event.SessionID, event.ProviderAckEventID); err != nil || tag.RowsAffected() != 1 {
		if err != nil {
			return nativeAgentReportWriteResult{}, fmt.Errorf("record native dispatch write state: %w", err)
		}
		return nativeAgentReportWriteResult{}, errNativeReportScope
	}
	if err := tx.Commit(ctx); err != nil {
		return nativeAgentReportWriteResult{}, fmt.Errorf("commit native Agent report: %w", err)
	}
	return nativeAgentReportWriteResult{Committed: true, Status: status, IssueID: event.IssueID, Revision: newRevision}, nil
}
