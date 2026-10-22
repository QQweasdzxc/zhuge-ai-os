import assert from "node:assert/strict";
import test from "node:test";
import {commitNativeAgentReport, createNativeAgentAtomicWriteAdapter, validateAgentReportEvent} from "../labs/taskflow/pages-client/agent-reporting-contract.mjs";
import {createNativePersistenceAdapter} from "../labs/taskflow/pages-client/native-persistence-adapter-contract.mjs";

const event = {
  type: "progress", event_id: "evt-progress-1", sequence: 1, issue_id: "issue-113", workspace_id: "ws-1",
  dispatch_id: "dispatch-113", executor_id: "CO-02", provider: "codex_cloud", provider_run_id: "run-113",
  session_id: "session-113", source: "codex_cloud", fencing_token: "fence-1", fencing_epoch: 1,
  observed_at: "2026-10-22T21:00:00.000Z", progress_percent: 40, progress_summary: "Checkpoint saved", next_step: "Continue review"
};

function makeRecord() {
  return {
    schema: "zhuge-taskflow-durable-dispatch-v1", intent_id: "intent-113", idempotency_key: "idem-113",
    workspace: "ws-1", issue_id: "issue-113", work_code: "P0-AUTONOMOUS-REPORTING", executor_id: "CO-02",
    provider: "codex_cloud", version: 1, fencing_epoch: 1, writer_id: "CO-02", fencing_token: "fence-1",
    lease_active: true, status: "in_progress", audit_log: []
  };
}

function nativeAuthority(record) {
  return {
    async beginTransaction() {
      let pending = null;
      return {
        async lockIssue() {}, async lockTask() {}, async readRecord() { return structuredClone(record); },
        async writeRecord(next) { pending = structuredClone(next); },
        async commit() { if (pending) Object.assign(record, pending); }, async rollback() { pending = null; }
      };
    }
  };
}

test("validated Agent progress traverses the Native Authority write seam and preserves one Issue", async () => {
  const record = makeRecord();
  const validation = validateAgentReportEvent(event, {
    authorization: "AUTHORIZED", issue_id: "issue-113", workspace_id: "ws-1", dispatch_id: "dispatch-113",
    executor_id: "CO-02", provider: "codex_cloud", provider_run_id: "run-113", session_id: "session-113",
    fencing_token: "fence-1", fencing_epoch: 1, lease_active: true, lease_expires_at: "2026-10-23T21:00:00.000Z",
    expected_version: 1, idempotency_key: "idem-113", last_event_sequence: 0,
    provider_attestation: {verified: true, source: "SERVER_PROVIDER_VERIFIER", event_id: event.event_id, provider_run_id: event.provider_run_id, session_id: event.session_id, provider: event.provider, transport: event.source},
    atomic_event_claim: {status: "CLAIMED", event_id: event.event_id, sequence: 1, fencing_epoch: 1}
  }, Date.parse("2026-10-22T21:01:00.000Z"));
  assert.equal(validation.accepted, true);
  const persistence = createNativePersistenceAdapter({beginTransaction: context => nativeAuthority(record).beginTransaction(context)});
  const adapter = createNativeAgentAtomicWriteAdapter({nativePersistenceAdapter: persistence, issueId: "issue-113", taskId: "task-113", idempotencyKey: "idem-113", expectedVersion: 1, fencingToken: "fence-1"});
  const committed = await commitNativeAgentReport(validation, adapter);
  assert.equal(committed.accepted, true);
  assert.equal(committed.result.atomic_event_claimed, true);
  assert.equal(record.issue_id, "issue-113");
  assert.equal(record.version, 2);
  assert.equal(record.audit_log.at(-1).event_id, event.event_id);
});
