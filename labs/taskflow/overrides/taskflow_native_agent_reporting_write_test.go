package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	reportWorkspace    = "12111111-1111-4111-8111-111111111111"
	reportAgent        = "12aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	reportProject      = "12bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	reportIssue        = "12cccccc-cccc-4ccc-8ccc-cccccccccccc"
	reportQueue        = "12dddddd-dddd-4ddd-8ddd-dddddddddddd"
	reportDispatch     = "12eeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	reportLease        = "12ffffff-ffff-4fff-8fff-ffffffffffff"
	reportIssueDone    = "12cddddc-dddd-4ddd-8ddd-dddddddddddd"
	reportQueueDone    = "12dddddd-dddd-4ddd-8ddd-eeeeeeeeeeee"
	reportDispatchDone = "12eeeeee-eeee-4eee-8eee-eeeeeeeeeeef"
	reportLeaseDone    = "13ffffff-ffff-4fff-8fff-ffffffffffff"
)

type testNativeAgentReportWire struct {
	EventID             string `json:"event_id"`
	DispatchID          string `json:"dispatch_id"`
	IssueID             string `json:"issue_id"`
	WorkspaceID         string `json:"workspace_id"`
	ExecutorID          string `json:"executor_id"`
	Provider            string `json:"provider"`
	ProviderRunID       string `json:"provider_run_id"`
	SessionID           string `json:"session_id"`
	ProviderAckEventID  string `json:"provider_ack_event_id"`
	LeaseID             string `json:"lease_id"`
	EventType           string `json:"event_type"`
	FencingEpoch        int64  `json:"fencing_epoch"`
	Sequence            int64  `json:"sequence"`
	ProgressPercent     int32  `json:"progress_percent"`
	HasProgress         bool   `json:"has_progress"`
	ProtectedDetailText string `json:"protected_detail_text,omitempty"`
}

type testHMACNativeAgentReportVerifier struct{ key []byte }

func (v testHMACNativeAgentReportVerifier) VerifyNativeAgentReport(_ context.Context, headers http.Header, body []byte) (NativeAgentReportAttestation, error) {
	provided, err := hex.DecodeString(headers.Get("X-Test-Provider-Signature"))
	if err != nil || len(v.key) == 0 {
		return NativeAgentReportAttestation{}, errNativeReportUnverified
	}
	mac := hmac.New(sha256.New, v.key)
	_, _ = mac.Write(body)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return NativeAgentReportAttestation{}, errNativeReportUnverified
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var wire testNativeAgentReportWire
	if err := decoder.Decode(&wire); err != nil {
		return NativeAgentReportAttestation{}, errNativeReportUnverified
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return NativeAgentReportAttestation{}, errNativeReportUnverified
	}
	return NativeAgentReportAttestation{
		EventID: wire.EventID, DispatchID: wire.DispatchID, IssueID: wire.IssueID,
		WorkspaceID: wire.WorkspaceID, ExecutorID: wire.ExecutorID, Provider: wire.Provider,
		ProviderRunID: wire.ProviderRunID, SessionID: wire.SessionID,
		ProviderAckEventID: wire.ProviderAckEventID, LeaseID: wire.LeaseID,
		EventType: wire.EventType, FencingEpoch: wire.FencingEpoch, Sequence: wire.Sequence,
		ProgressPercent: wire.ProgressPercent, HasProgress: wire.HasProgress,
		HasProtectedDetails: wire.ProtectedDetailText != "",
	}, nil
}

func TestTaskFlowNativeAgentReportWritePostgres16(t *testing.T) {
	dsn := os.Getenv("TASKFLOW_NATIVE_AI_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("TASKFLOW_NATIVE_AI_DATABASE_URL is required in CI; PostgreSQL writer tests may not skip")
		}
		t.Skip("TASKFLOW_NATIVE_AI_DATABASE_URL is unset; PostgreSQL writer test not requested")
	}
	ctx := context.Background()
	probePool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect isolated PostgreSQL: %v", err)
	}
	var version int
	var database string
	var databaseUser string
	if err := probePool.QueryRow(ctx, `SELECT current_setting('server_version_num')::int, current_database(), current_user`).Scan(&version, &database, &databaseUser); err != nil {
		t.Fatal(err)
	}
	wantDatabase, wantUser, searchPath := "taskflow_native_ai_test", "taskflow_native_ai_ci", "native_agent_report_test,public"
	if nativeReportRealSchemaMode() {
		wantDatabase, wantUser, searchPath = "taskflow_native_ai_real_schema_test", "taskflow_migrator", "taskflow,extensions"
	}
	if version < 160000 || version >= 170000 || database != wantDatabase || databaseUser != wantUser {
		t.Fatalf("refusing non-isolated PostgreSQL target: version=%d database=%q user=%q", version, database, databaseUser)
	}
	if nativeReportRealSchemaMode() {
		// Real-schema mode never creates or drops schemas. It must see the real migrated tables,
		// and the connecting role must not be a superuser.
		var superuser bool
		var realMarkers int
		if err := probePool.QueryRow(ctx, `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
			(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'taskflow' AND ((table_name = 'issue' AND column_name = 'title') OR (table_name = 'dispatch_intent' AND column_name = 'cto_principal') OR (table_name = 'agent_task_queue' AND column_name = 'runtime_id')))`).Scan(&superuser, &realMarkers); err != nil {
			t.Fatal(err)
		}
		if superuser || realMarkers != 3 {
			t.Fatalf("real-schema mode requires a non-superuser role and the migrated TaskFlow schema: superuser=%v markers=%d", superuser, realMarkers)
		}
	} else {
		if _, err := probePool.Exec(ctx, `DROP SCHEMA IF EXISTS native_agent_report_test CASCADE`); err != nil {
			t.Fatalf("reset isolated reporting schema: %v", err)
		}
		if _, err := probePool.Exec(ctx, `CREATE SCHEMA native_agent_report_test`); err != nil {
			t.Fatalf("create isolated reporting schema: %v", err)
		}
	}
	probePool.Close()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse isolated PostgreSQL configuration: %v", err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = searchPath
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect reporting schema in isolated PostgreSQL: %v", err)
	}
	defer pool.Close()
	if nativeReportRealSchemaMode() {
		realSchemaPrelude(t, ctx, pool)
	} else {
		createNativeAgentReportSchema(t, ctx, pool)
	}
	seedNativeAgentReportRows(t, ctx, pool)
	// Optional: run the writer AS taskflow_runtime (real-schema mode only). Seeds and assertions stay
	// on the owner pool; only the Handler's database handle changes.
	writerPool := pool
	if runtimeDSN := os.Getenv("TASKFLOW_NATIVE_REPORT_RUNTIME_DSN"); runtimeDSN != "" {
		if !nativeReportRealSchemaMode() {
			t.Fatal("TASKFLOW_NATIVE_REPORT_RUNTIME_DSN requires real-schema mode")
		}
		rtConfig, err := pgxpool.ParseConfig(runtimeDSN)
		if err != nil {
			t.Fatalf("parse runtime DSN: %v", err)
		}
		rtConfig.ConnConfig.RuntimeParams["search_path"] = searchPath
		writerPool, err = pgxpool.NewWithConfig(ctx, rtConfig)
		if err != nil {
			t.Fatalf("connect runtime pool: %v", err)
		}
		defer writerPool.Close()
		var rtUser string
		var rtSuper bool
		if err := writerPool.QueryRow(ctx, `SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)`).Scan(&rtUser, &rtSuper); err != nil || rtUser != "taskflow_runtime" || rtSuper {
			t.Fatalf("writer pool must be non-superuser taskflow_runtime: user=%q super=%v err=%v", rtUser, rtSuper, err)
		}
		if _, err := writerPool.Exec(ctx, `SELECT 1 FROM taskflow.dispatch_intent`); err == nil {
			t.Fatal("runtime must not read the owner-only ledger directly")
		}
	}
	h := &Handler{
		Queries: db.New(writerPool), TxStarter: writerPool,
		NativeAgentReportVerifier: testHMACNativeAgentReportVerifier{key: []byte("isolated-native-report-test-key-only")},
	}
	unboundResponse := httptest.NewRecorder()
	unboundRequest := httptest.NewRequest(http.MethodPost, nativeAgentReportIngressPath, strings.NewReader(`{}`))
	unboundRequest.Header.Set("Content-Type", "application/json")
	(&Handler{}).ReceiveNativeAgentReport(unboundResponse, unboundRequest)
	if unboundResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("unbound production provider verifier must fail closed, got %d", unboundResponse.Code)
	}

	good := validNativeAgentReportEvent()
	if _, err := pool.Exec(ctx, `UPDATE agent_task_queue SET result='{"zhuge_agent_reporting":"invalid"}'::jsonb WHERE id=$1::uuid`, reportQueue); err != nil {
		t.Fatal(err)
	}
	if _, err := h.applyVerifiedNativeAgentReport(ctx, good); err == nil || err.Error() != errNativeReportProjection.Error() {
		t.Fatalf("malformed existing native Queue projection must fail closed: err=%v", err)
	}
	var malformedRevision int64
	var malformedComments, malformedAudit int
	if err := pool.QueryRow(ctx, `SELECT revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&malformedRevision); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE issue_id=$1::uuid),(SELECT count(*) FROM activity_log WHERE issue_id=$1::uuid)`, reportIssue).Scan(&malformedComments, &malformedAudit); err != nil {
		t.Fatal(err)
	}
	if malformedRevision != 1 || malformedComments != 0 || malformedAudit != 0 {
		t.Fatalf("malformed Queue projection rejection left a partial write: revision=%d comments=%d audit=%d", malformedRevision, malformedComments, malformedAudit)
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_task_queue SET result='{}'::jsonb WHERE id=$1::uuid`, reportQueue); err != nil {
		t.Fatal(err)
	}
	badSignature := signedNativeAgentReportTestRequest(t, h, good, "", strings.Repeat("0", 64))
	if badSignature.Code != http.StatusUnauthorized || strings.Contains(badSignature.Body.String(), "fixture-run-1") {
		t.Fatalf("invalid provider signature must be rejected without echoing claims, status=%d body=%s", badSignature.Code, badSignature.Body.String())
	}
	result := signedNativeAgentReportTestRequest(t, h, good, "", "")
	if result.Code != http.StatusCreated || !strings.Contains(result.Body.String(), `"status":"in_progress"`) {
		t.Fatalf("valid signed test fixture must reach native writer, status=%d body=%s", result.Code, result.Body.String())
	}
	duplicateResponse := signedNativeAgentReportTestRequest(t, h, good, "", "")
	if duplicateResponse.Code != http.StatusOK || !strings.Contains(duplicateResponse.Body.String(), `"replay":true`) {
		t.Fatalf("duplicate provider event must return idempotent native readback, status=%d body=%s", duplicateResponse.Code, duplicateResponse.Body.String())
	}
	var issueStatus string
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT status,revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&issueStatus, &revision); err != nil {
		t.Fatal(err)
	}
	if issueStatus != "in_progress" || revision != 2 {
		t.Fatalf("native Issue was not updated with its comment transaction: status=%s revision=%d", issueStatus, revision)
	}
	var queueIssueRevision string
	if err := pool.QueryRow(ctx, `SELECT result->'zhuge_agent_reporting'->>'issue_revision' FROM agent_task_queue WHERE id=$1::uuid`, reportQueue).Scan(&queueIssueRevision); err != nil {
		t.Fatal(err)
	}
	if queueIssueRevision != "2" {
		t.Fatalf("native Queue must retain the Issue revision returned by the committed report: issue_revision=%q", queueIssueRevision)
	}
	var queueStatus, queueReportState string
	if err := pool.QueryRow(ctx, `SELECT status, result->'zhuge_agent_reporting'->>'state' FROM agent_task_queue WHERE id=$1::uuid`, reportQueue).Scan(&queueStatus, &queueReportState); err != nil {
		t.Fatal(err)
	}
	if queueStatus != "running" || queueReportState != "in_progress" {
		t.Fatalf("Agent Task Queue must retain native running status and read back report state: queue_status=%q report_state=%q", queueStatus, queueReportState)
	}
	var commentCount, activityCount int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE issue_id=$1::uuid),(SELECT count(*) FROM activity_log WHERE issue_id=$1::uuid)`, reportIssue).Scan(&commentCount, &activityCount); err != nil {
		t.Fatal(err)
	}
	if commentCount != 1 || activityCount != 1 {
		t.Fatalf("native event must produce exactly one comment and audit row: comments=%d activity=%d", commentCount, activityCount)
	}
	var commentContent string
	var activityDetails []byte
	if err := pool.QueryRow(ctx, `SELECT content FROM comment WHERE issue_id=$1::uuid`, reportIssue).Scan(&commentContent); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT details FROM activity_log WHERE issue_id=$1::uuid`, reportIssue).Scan(&activityDetails); err != nil {
		t.Fatal(err)
	}
	if commentContent != "[AI 回報] 進度更新 · 42%" || containsSensitiveReportText(commentContent) || containsSensitiveReportText(string(activityDetails)) {
		t.Fatalf("raw Agent text must not be persisted to public comment or audit: comment=%q details=%s", commentContent, activityDetails)
	}
	protectedSecret := "private contract secret body must not leak"
	protectedEvent := good
	protectedEvent.EventID, protectedEvent.Sequence = "event-protected-ingress", 2
	protectedResponse := signedNativeAgentReportTestRequest(t, h, protectedEvent, protectedSecret, "")
	if protectedResponse.Code != http.StatusConflict || strings.Contains(protectedResponse.Body.String(), protectedSecret) {
		t.Fatalf("protected detail must fail closed without echoing raw text, status=%d body=%s", protectedResponse.Code, protectedResponse.Body.String())
	}
	var leakedRows int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE position($1 in content)>0)+(SELECT count(*) FROM activity_log WHERE details::text LIKE '%' || $1 || '%')`, protectedSecret).Scan(&leakedRows); err != nil {
		t.Fatal(err)
	}
	if leakedRows != 0 {
		t.Fatalf("protected report text was persisted outside a protected detail store: rows=%d", leakedRows)
	}

	// Two concurrent replays serialize on the durable Dispatch row; one is the
	// original commit and the other is an idempotent readback, never a 2nd write.
	var wait sync.WaitGroup
	results := make(chan nativeAgentReportWriteResult, 2)
	errs := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			r, e := h.applyVerifiedNativeAgentReport(ctx, good)
			results <- r
			errs <- e
		}()
	}
	wait.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent replay failed: %v", err)
		}
	}
	for r := range results {
		if !r.Committed || !r.Replay {
			t.Fatalf("concurrent duplicate must return idempotent readback: %+v", r)
		}
	}

	assertRejected := func(name string, event nativeAgentReportEvent, want error) {
		t.Helper()
		if _, err := h.applyVerifiedNativeAgentReport(ctx, event); err == nil || err.Error() != want.Error() {
			t.Fatalf("%s: error=%v want=%v", name, err, want)
		}
		var currentRevision int64
		var currentComments, currentAudit int
		if err := pool.QueryRow(ctx, `SELECT revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&currentRevision); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE issue_id=$1::uuid),(SELECT count(*) FROM activity_log WHERE issue_id=$1::uuid)`, reportIssue).Scan(&currentComments, &currentAudit); err != nil {
			t.Fatal(err)
		}
		if currentRevision != revision || currentComments != commentCount || currentAudit != activityCount {
			t.Fatalf("%s rejection left a partial native mutation: revision=%d comments=%d audit=%d", name, currentRevision, currentComments, currentAudit)
		}
	}
	unverified := good
	unverified.providerAttestationVerified = false
	assertRejected("unverified provider", unverified, errNativeReportUnverified)
	protected := good
	protected.EventID, protected.Sequence, protected.HasProtectedDetails = "event-protected", 2, true
	assertRejected("protected detail store missing", protected, errNativeReportProtectedDetail)
	reusedEventID := good
	reusedEventID.Sequence = 2
	assertRejected("reused event ID with changed sequence", reusedEventID, errNativeReportReplay)

	stale := good
	stale.EventID, stale.Sequence = "event-stale", 1
	assertRejected("replayed sequence", stale, errNativeReportReplay)
	wrongFence := good
	wrongFence.EventID, wrongFence.Sequence, wrongFence.FencingEpoch = "event-mismatched-fence", 2, 2
	assertRejected("mismatched fencing epoch", wrongFence, errNativeReportScope)

	crossWorkspace := good
	crossWorkspace.EventID, crossWorkspace.Sequence, crossWorkspace.WorkspaceID = "event-cross-workspace", 2, "12999999-9999-4999-8999-999999999999"
	assertRejected("cross Workspace", crossWorkspace, errNativeReportScope)
	wrongRun := good
	wrongRun.EventID, wrongRun.Sequence, wrongRun.ProviderRunID = "event-wrong-run", 2, "forged-run"
	assertRejected("mismatched Run", wrongRun, errNativeReportScope)
	wrongAck := good
	wrongAck.EventID, wrongAck.Sequence, wrongAck.ProviderAckEventID = "event-wrong-ack", 2, "forged-ack"
	assertRejected("mismatched Provider ACK", wrongAck, errNativeReportScope)
	wrongWorkspace := good
	wrongWorkspace.EventID, wrongWorkspace.Sequence, wrongWorkspace.WorkspaceID = "event-no-issue", 2, "12999999-9999-4999-8999-999999999999"
	assertRejected("wrong Workspace Issue lookup", wrongWorkspace, errNativeReportScope)
	if _, err := pool.Exec(ctx, fixtureSQL(`INSERT INTO project(id,workspace_id,lead_type,lead_id) VALUES ('12bccccb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,$1::uuid,'agent',$2::uuid)`, `INSERT INTO project(id,workspace_id,lead_type,lead_id,title) VALUES ('12bccccb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,$1::uuid,'agent',$2::uuid,'second fixture project')`), reportWorkspace, reportAgent); err != nil {
		t.Fatal(err)
	}
	duplicateProject := good
	duplicateProject.EventID, duplicateProject.Sequence = "event-duplicate-project", 2
	assertRejected("duplicate native Project mapping", duplicateProject, errNativeReportScope)
	if _, err := pool.Exec(ctx, `DELETE FROM project WHERE id='12bccccb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, fixtureSQL(`INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result) VALUES ('12dddddd-dddd-4ddd-8ddd-eeeeeeeeeeee'::uuid,$1::uuid,$2::uuid,'running','{}'::jsonb)`, `INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result,runtime_id) VALUES ('12dddddd-dddd-4ddd-8ddd-eeeeeeeeeeee'::uuid,$1::uuid,$2::uuid,'running','{}'::jsonb,'12999999-9999-4999-8999-999999999992')`), reportAgent, reportIssue); err != nil {
		t.Fatal(err)
	}
	duplicateQueue := good
	duplicateQueue.EventID, duplicateQueue.Sequence = "event-duplicate-queue", 2
	assertRejected("duplicate active native Queue writer", duplicateQueue, errNativeReportScope)
	if _, err := pool.Exec(ctx, `DELETE FROM agent_task_queue WHERE id='12dddddd-dddd-4ddd-8ddd-eeeeeeeeeeee'::uuid`); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `UPDATE taskflow.dispatch_intent SET lease_expires_at=now()-interval '1 second' WHERE id=$1::uuid`, reportDispatch); err != nil {
		t.Fatal(err)
	}
	expired := good
	expired.EventID, expired.Sequence = "event-expired", 2
	assertRejected("expired Lease", expired, errNativeReportScope)
	if _, err := pool.Exec(ctx, `UPDATE taskflow.dispatch_intent SET lease_expires_at=now()+interval '5 minutes',stop_requested_at=now() WHERE id=$1::uuid`, reportDispatch); err != nil {
		t.Fatal(err)
	}
	stopped := good
	stopped.EventID, stopped.Sequence = "event-stop", 2
	assertRejected("STOP blocks old writer", stopped, errNativeReportScope)
	if _, err := pool.Exec(ctx, `UPDATE taskflow.dispatch_intent SET stop_requested_at=NULL WHERE id=$1::uuid`, reportDispatch); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `CREATE OR REPLACE FUNCTION taskflow.fail_native_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'event_id'='event-rollback' THEN RAISE EXCEPTION 'isolated rollback probe'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `CREATE TRIGGER fail_native_report_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION taskflow.fail_native_report_audit()`); err != nil {
		t.Fatal(err)
	}
	rollbackEvent := good
	rollbackEvent.EventID, rollbackEvent.Sequence = "event-rollback", 2
	if _, err := h.applyVerifiedNativeAgentReport(ctx, rollbackEvent); err == nil {
		t.Fatal("injected audit write failure unexpectedly committed")
	}
	if _, err := pool.Exec(ctx, `DROP TRIGGER fail_native_report_audit ON activity_log`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DROP FUNCTION taskflow.fail_native_report_audit()`); err != nil {
		t.Fatal(err)
	}
	var afterRollbackRevision int64
	var afterRollbackComments, afterRollbackAudit int
	if err := pool.QueryRow(ctx, `SELECT revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&afterRollbackRevision); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE issue_id=$1::uuid),(SELECT count(*) FROM activity_log WHERE issue_id=$1::uuid)`, reportIssue).Scan(&afterRollbackComments, &afterRollbackAudit); err != nil {
		t.Fatal(err)
	}
	if afterRollbackRevision != revision || afterRollbackComments != commentCount || afterRollbackAudit != activityCount {
		t.Fatalf("failed native audit write left a partial mutation: revision=%d comments=%d audit=%d", afterRollbackRevision, afterRollbackComments, afterRollbackAudit)
	}
	// A native user edit between Agent events advances the authoritative Issue
	// revision. The next Agent event must conflict instead of overwriting it.
	if _, err := pool.Exec(ctx, `UPDATE issue SET revision=revision+1, updated_at=now() WHERE id=$1::uuid`, reportIssue); err != nil {
		t.Fatal(err)
	}
	var externalRevision int64
	if err := pool.QueryRow(ctx, `SELECT revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&externalRevision); err != nil {
		t.Fatal(err)
	}
	conflictingEvent := good
	conflictingEvent.EventID, conflictingEvent.Sequence = "event-native-edit-conflict", 2
	if _, err := h.applyVerifiedNativeAgentReport(ctx, conflictingEvent); err == nil || err.Error() != errNativeReportVersionConflict.Error() {
		t.Fatalf("Agent report must reject a native Issue revision conflict: err=%v", err)
	}
	var afterConflictRevision int64
	var afterConflictComments, afterConflictAudit int
	if err := pool.QueryRow(ctx, `SELECT revision FROM issue WHERE id=$1::uuid`, reportIssue).Scan(&afterConflictRevision); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM comment WHERE issue_id=$1::uuid),(SELECT count(*) FROM activity_log WHERE issue_id=$1::uuid)`, reportIssue).Scan(&afterConflictComments, &afterConflictAudit); err != nil {
		t.Fatal(err)
	}
	if afterConflictRevision != externalRevision || afterConflictComments != commentCount || afterConflictAudit != activityCount {
		t.Fatalf("version conflict changed native data: revision=%d comments=%d audit=%d", afterConflictRevision, afterConflictComments, afterConflictAudit)
	}
	revision = externalRevision
	if _, err := pool.Exec(ctx, `UPDATE taskflow.dispatch_intent SET fencing_epoch=2 WHERE id=$1::uuid`, reportDispatch); err != nil {
		t.Fatal(err)
	}
	oldFence := good
	oldFence.EventID, oldFence.Sequence, oldFence.FencingEpoch = "event-old-fence", 2, 1
	assertRejected("old fencing epoch after authority advanced", oldFence, errNativeReportScope)
	if _, err := pool.Exec(ctx, fixtureSQL(`INSERT INTO issue(id,workspace_id,project_id,status,revision,assignee_type,assignee_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'todo',1,'agent',$4::uuid)`, `INSERT INTO issue(id,workspace_id,project_id,status,revision,assignee_type,assignee_id,title,creator_type,creator_id,number) VALUES ($1::uuid,$2::uuid,$3::uuid,'todo',1,'agent',$4::uuid,'fixture issue','member','12999999-9999-4999-8999-999999999991',(SELECT COALESCE(MAX(number),0)+1 FROM issue WHERE workspace_id=$2::uuid))`), reportIssueDone, reportWorkspace, reportProject, reportAgent); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, fixtureSQL(`INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result) VALUES ($1::uuid,$2::uuid,$3::uuid,'running','{}'::jsonb)`, `INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result,runtime_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'running','{}'::jsonb,'12999999-9999-4999-8999-999999999992')`), reportQueueDone, reportAgent, reportIssueDone); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, fixtureSQL(`INSERT INTO taskflow.dispatch_intent(id,lease_id,fencing_epoch,workspace_id,issue_id,executor_id,provider,state,provider_run_id,provider_session_id,provider_ack_event_id,lease_expires_at) VALUES ($1::uuid,$2::uuid,1,$3::uuid,$4::uuid,'CO-01','test-provider','provider_acknowledged','fixture-complete-run','fixture-complete-session','fixture-complete-ack',now()+interval '5 minutes')`, `INSERT INTO taskflow.dispatch_intent(id,lease_id,fencing_epoch,workspace_id,issue_id,executor_id,provider,state,provider_run_id,provider_session_id,provider_ack_event_id,lease_expires_at,request_key,request_payload_hash,cto_principal) VALUES ($1::uuid,$2::uuid,1,$3::uuid,$4::uuid,'CO-01','test-provider','provider_acknowledged','fixture-complete-run','fixture-complete-session','fixture-complete-ack',now()+interval '5 minutes','rk-'||$1::text,'fixture-hash','CTO')`), reportDispatchDone, reportLeaseDone, reportWorkspace, reportIssueDone); err != nil {
		t.Fatal(err)
	}
	completed := nativeAgentReportEvent{
		EventID: "event-completed", DispatchID: reportDispatchDone, IssueID: reportIssueDone, WorkspaceID: reportWorkspace,
		ExecutorID: "CO-01", Provider: "test-provider", ProviderRunID: "fixture-complete-run", SessionID: "fixture-complete-session",
		ProviderAckEventID: "fixture-complete-ack", LeaseID: reportLeaseDone, EventType: "completed", FencingEpoch: 1, Sequence: 1,
	}
	completedResponse := signedNativeAgentReportTestRequest(t, h, completed, "", "")
	if completedResponse.Code != http.StatusCreated || !strings.Contains(completedResponse.Body.String(), `"status":"in_review"`) {
		t.Fatalf("completed Agent report must transition to in_review, status=%d body=%s", completedResponse.Code, completedResponse.Body.String())
	}
	var completedIssueStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM issue WHERE id=$1::uuid`, reportIssueDone).Scan(&completedIssueStatus); err != nil {
		t.Fatal(err)
	}
	if completedIssueStatus != "in_review" {
		t.Fatalf("Agent completion must await CTO review, got Issue status=%q", completedIssueStatus)
	}
}

func validNativeAgentReportEvent() nativeAgentReportEvent {
	return nativeAgentReportEvent{
		EventID: "event-progress", DispatchID: reportDispatch, IssueID: reportIssue, WorkspaceID: reportWorkspace,
		ExecutorID: "CO-01", Provider: "test-provider", ProviderRunID: "fixture-run-1", SessionID: "fixture-session-1",
		ProviderAckEventID: "fixture-ack-1", LeaseID: reportLease, EventType: "progress", FencingEpoch: 1,
		Sequence: 1, ProgressPercent: 42, HasProgress: true, providerAttestationVerified: true,
	}
}

func signedNativeAgentReportTestRequest(t *testing.T, h *Handler, event nativeAgentReportEvent, protectedDetail string, signatureOverride string) *httptest.ResponseRecorder {
	t.Helper()
	key := []byte("isolated-native-report-test-key-only")
	wire := testNativeAgentReportWire{
		EventID: event.EventID, DispatchID: event.DispatchID, IssueID: event.IssueID,
		WorkspaceID: event.WorkspaceID, ExecutorID: event.ExecutorID, Provider: event.Provider,
		ProviderRunID: event.ProviderRunID, SessionID: event.SessionID,
		ProviderAckEventID: event.ProviderAckEventID, LeaseID: event.LeaseID,
		EventType: event.EventType, FencingEpoch: event.FencingEpoch, Sequence: event.Sequence,
		ProgressPercent: event.ProgressPercent, HasProgress: event.HasProgress,
		ProtectedDetailText: protectedDetail,
	}
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if signatureOverride != "" {
		signature = signatureOverride
	}
	request := httptest.NewRequest(http.MethodPost, nativeAgentReportIngressPath, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Test-Provider-Signature", signature)
	response := httptest.NewRecorder()
	h.ReceiveNativeAgentReport(response, request)
	return response
}

func createNativeAgentReportSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	statements := []string{
		`CREATE SCHEMA IF NOT EXISTS taskflow`,
		`CREATE TABLE IF NOT EXISTS taskflow.dispatch_intent (id uuid primary key, lease_id uuid not null, fencing_epoch bigint not null, workspace_id uuid not null, issue_id uuid not null, executor_id text not null, provider text not null, state text not null, provider_run_id text, provider_session_id text, provider_ack_event_id text, lease_expires_at timestamptz not null, stop_requested_at timestamptz, provider_stop_verified boolean not null default false, native_write_state text not null default 'pending', updated_at timestamptz not null default now())`,
		// Verbatim copies of the two report gates in sql/taskflow_native_dispatch_caller_acl_candidate.sql
		// (tests/test_native_dispatch_caller_acl_postgres.py checks they have not drifted).
		`CREATE OR REPLACE FUNCTION taskflow.lock_dispatch_for_report(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_provider_run_id TEXT, p_provider_session_id TEXT, p_provider_ack_event_id TEXT
)
RETURNS TABLE (workspace_id TEXT, issue_id TEXT, executor_id TEXT, provider TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = taskflow, pg_catalog, pg_temp
AS $$
    SELECT d.workspace_id::text, d.issue_id::text, d.executor_id, d.provider
      FROM taskflow.dispatch_intent AS d
     WHERE d.id = p_dispatch_id AND d.lease_id = p_lease_id AND d.fencing_epoch = p_fencing_epoch
       AND d.provider_run_id = p_provider_run_id AND d.provider_session_id = p_provider_session_id
       AND d.provider_ack_event_id = p_provider_ack_event_id
       AND d.state IN ('provider_acknowledged', 'provider_started')
       AND d.lease_expires_at > pg_catalog.now() AND d.stop_requested_at IS NULL
       AND NOT d.provider_stop_verified
       FOR UPDATE
$$`,
		`CREATE OR REPLACE FUNCTION taskflow.mark_dispatch_report_committed(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_provider_run_id TEXT, p_provider_session_id TEXT, p_provider_ack_event_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = taskflow, pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent AS d
       SET native_write_state = 'committed', updated_at = pg_catalog.now()
     WHERE d.id = p_dispatch_id AND d.lease_id = p_lease_id AND d.fencing_epoch = p_fencing_epoch
       AND d.provider_run_id = p_provider_run_id AND d.provider_session_id = p_provider_session_id
       AND d.provider_ack_event_id = p_provider_ack_event_id
       AND d.state IN ('provider_acknowledged', 'provider_started')
       AND d.lease_expires_at > pg_catalog.now() AND d.stop_requested_at IS NULL;
    RETURN FOUND;
END;
$$`,
		`CREATE TABLE IF NOT EXISTS agent (id uuid primary key, workspace_id uuid not null, system_key text not null, archived_at timestamptz)`,
		`CREATE TABLE IF NOT EXISTS project (id uuid primary key, workspace_id uuid not null, lead_type text not null, lead_id uuid not null)`,
		`CREATE TABLE IF NOT EXISTS issue (id uuid primary key, workspace_id uuid not null, project_id uuid not null, status text not null, revision bigint not null default 1, assignee_type text, assignee_id uuid, updated_at timestamptz not null default now(), last_activity_at timestamptz not null default now())`,
		`CREATE TABLE IF NOT EXISTS agent_task_queue (id uuid primary key, agent_id uuid not null, issue_id uuid not null, status text not null, result jsonb, created_at timestamptz not null default now())`,
		`CREATE TABLE IF NOT EXISTS comment (id uuid primary key, issue_id uuid not null, workspace_id uuid not null, author_type text not null, author_id uuid not null, content text not null, type text not null, parent_id uuid, source_task_id uuid, quick_action_id uuid, via_plugin_id uuid, suppressed_agent_ids uuid[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz, resolved_by_type text, resolved_by_id uuid)`,
		`CREATE TABLE IF NOT EXISTS activity_log (id uuid primary key, workspace_id uuid not null, issue_id uuid, actor_type text, actor_id uuid, action text not null, details jsonb not null default '{}', created_at timestamptz not null default now())`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("create isolated native report schema: %v", err)
		}
	}
}

func seedNativeAgentReportRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	for _, cleanup := range []struct {
		query string
		args  []any
	}{
		{`DELETE FROM taskflow.dispatch_intent WHERE id=$1::uuid`, []any{reportDispatchDone}},
		{`DELETE FROM comment WHERE issue_id=$1::uuid`, []any{reportIssueDone}},
		{`DELETE FROM activity_log WHERE issue_id=$1::uuid`, []any{reportIssueDone}},
		{`DELETE FROM agent_task_queue WHERE issue_id=$1::uuid`, []any{reportIssueDone}},
		{`DELETE FROM issue WHERE id=$1::uuid`, []any{reportIssueDone}},
		{`DELETE FROM taskflow.dispatch_intent WHERE id=$1::uuid`, []any{reportDispatch}},
		{`DELETE FROM comment WHERE issue_id=$1::uuid`, []any{reportIssue}},
		{`DELETE FROM activity_log WHERE issue_id=$1::uuid`, []any{reportIssue}},
		{`DELETE FROM agent_task_queue WHERE issue_id=$1::uuid`, []any{reportIssue}},
		{`DELETE FROM issue WHERE id=$1::uuid`, []any{reportIssue}},
		{`DELETE FROM project WHERE id=$1::uuid`, []any{reportProject}},
		{`DELETE FROM agent WHERE id=$1::uuid`, []any{reportAgent}},
	} {
		if _, err := pool.Exec(ctx, cleanup.query, cleanup.args...); err != nil {
			t.Fatalf("clear isolated native report rows: %v", err)
		}
	}
	statements := []struct {
		query string
		args  []any
	}{
		{fixtureSQL(`INSERT INTO agent(id,workspace_id,system_key) VALUES ($1::uuid,$2::uuid,'CO-01')`, `INSERT INTO agent(id,workspace_id,system_key,name,runtime_mode,owner_id,runtime_id) VALUES ($1::uuid,$2::uuid,'CO-01','CO-01','cloud','12999999-9999-4999-8999-999999999991','12999999-9999-4999-8999-999999999992')`), []any{reportAgent, reportWorkspace}},
		{fixtureSQL(`INSERT INTO project(id,workspace_id,lead_type,lead_id) VALUES ($1::uuid,$2::uuid,'agent',$3::uuid)`, `INSERT INTO project(id,workspace_id,lead_type,lead_id,title) VALUES ($1::uuid,$2::uuid,'agent',$3::uuid,'fixture project')`), []any{reportProject, reportWorkspace, reportAgent}},
		{fixtureSQL(`INSERT INTO issue(id,workspace_id,project_id,status,revision,assignee_type,assignee_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'todo',1,'agent',$4::uuid)`, `INSERT INTO issue(id,workspace_id,project_id,status,revision,assignee_type,assignee_id,title,creator_type,creator_id,number) VALUES ($1::uuid,$2::uuid,$3::uuid,'todo',1,'agent',$4::uuid,'fixture issue','member','12999999-9999-4999-8999-999999999991',(SELECT COALESCE(MAX(number),0)+1 FROM issue WHERE workspace_id=$2::uuid))`), []any{reportIssue, reportWorkspace, reportProject, reportAgent}},
		{fixtureSQL(`INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result) VALUES ($1::uuid,$2::uuid,$3::uuid,'running','{}'::jsonb)`, `INSERT INTO agent_task_queue(id,agent_id,issue_id,status,result,runtime_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'running','{}'::jsonb,'12999999-9999-4999-8999-999999999992')`), []any{reportQueue, reportAgent, reportIssue}},
		{fixtureSQL(`INSERT INTO taskflow.dispatch_intent(id,lease_id,fencing_epoch,workspace_id,issue_id,executor_id,provider,state,provider_run_id,provider_session_id,provider_ack_event_id,lease_expires_at) VALUES ($1::uuid,$2::uuid,1,$3::uuid,$4::uuid,'CO-01','test-provider','provider_acknowledged','fixture-run-1','fixture-session-1','fixture-ack-1',now()+interval '5 minutes')`, `INSERT INTO taskflow.dispatch_intent(id,lease_id,fencing_epoch,workspace_id,issue_id,executor_id,provider,state,provider_run_id,provider_session_id,provider_ack_event_id,lease_expires_at,request_key,request_payload_hash,cto_principal) VALUES ($1::uuid,$2::uuid,1,$3::uuid,$4::uuid,'CO-01','test-provider','provider_acknowledged','fixture-run-1','fixture-session-1','fixture-ack-1',now()+interval '5 minutes','rk-'||$1::text,'fixture-hash','CTO')`), []any{reportDispatch, reportLease, reportWorkspace, reportIssue}},
	}
	for _, stmt := range statements {
		if _, err := pool.Exec(ctx, stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
}

func containsSensitiveReportText(text string) bool {
	for _, forbidden := range []string{"private", "contract", "secret", "Checkpoint saved", "Continue review"} {
		if strings.Contains(strings.ToLower(text), strings.ToLower(forbidden)) {
			return true
		}
	}
	return false
}

func nativeReportRealSchemaMode() bool {
	return os.Getenv("TASKFLOW_NATIVE_REPORT_REAL_SCHEMA") == "1"
}

// fixtureSQL picks the default simplified-schema statement, or the real-migrated-schema
// statement (extra NOT NULL columns) when the explicit real-schema mode is on.
func fixtureSQL(simplified, real string) string {
	if nativeReportRealSchemaMode() {
		return real
	}
	return simplified
}

// realSchemaPrelude removes only rows belonging to the fixed fixture workspace, then creates the
// fixture user, workspace and runtime that the real schema requires. It never drops a schema.
func realSchemaPrelude(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	const fixtureUser, fixtureRuntime = "12999999-9999-4999-8999-999999999991", "12999999-9999-4999-8999-999999999992"
	for _, q := range []string{
		`DELETE FROM taskflow.dispatch_intent WHERE workspace_id = '` + reportWorkspace + `'::uuid`,
		`DELETE FROM agent_task_queue WHERE agent_id IN (SELECT id FROM agent WHERE workspace_id = '` + reportWorkspace + `'::uuid)`,
		`DELETE FROM issue WHERE workspace_id = '` + reportWorkspace + `'::uuid`,
		`DELETE FROM project WHERE workspace_id = '` + reportWorkspace + `'::uuid`,
		`DELETE FROM agent WHERE workspace_id = '` + reportWorkspace + `'::uuid`,
		`DELETE FROM agent_runtime WHERE id = '` + fixtureRuntime + `'::uuid`,
		`DELETE FROM workspace WHERE id = '` + reportWorkspace + `'::uuid`,
		`DELETE FROM "user" WHERE id = '` + fixtureUser + `'::uuid`,
		`INSERT INTO "user"(id,name,email) VALUES ('` + fixtureUser + `','fixture user','native-report-fixture@example.invalid')`,
		`INSERT INTO workspace(id,name,slug) VALUES ('` + reportWorkspace + `','fixture workspace','native-report-fixture')`,
		`INSERT INTO agent_runtime(id,workspace_id,name,runtime_mode,provider) VALUES ('` + fixtureRuntime + `','` + reportWorkspace + `','fixture runtime','cloud','test')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("real-schema fixture prelude: %v", err)
		}
	}
}
