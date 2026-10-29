import assert from "node:assert/strict";
import test from "node:test";
import {buildNativeAgentReportMutation, createNativeAgentAtomicWriteAdapter, validateAgentReportEvent} from "../labs/taskflow/pages-client/agent-reporting-contract.mjs";
import {createNativePersistenceAdapter} from "../labs/taskflow/pages-client/native-persistence-adapter-contract.mjs";

// Synthetic fixtures for review findings on the native atomic write seam.
const event = {
  type: "progress", event_id: "evt-1", sequence: 1, issue_id: "issue-1", workspace_id: "ws-1", dispatch_id: "d-1",
  executor_id: "CO-02", provider: "codex_cloud", provider_run_id: "run-1", session_id: "s-1", source: "codex_cloud",
  fencing_token: "fence-1", fencing_epoch: 1, observed_at: "2026-10-22T21:00:00.000Z", progress_percent: 10
};
const baseRecord = () => ({lease_id: "lease-1", dispatch_id: "d-1", provider_run_id: "run-1", provider_session_id: "s-1", lease_expires_at: "2099-01-01T00:00:00.000Z", schema: "s", intent_id: "i", idempotency_key: "idem", workspace: "ws-1", issue_id: "issue-1", work_code: "w",
  executor_id: "CO-02", provider: "codex_cloud", version: 1, fencing_epoch: 1, writer_id: "CO-02", fencing_token: "fence-1",
  lease_active: true, status: "in_progress", audit_log: []});
const context = {lease_id: "lease-1", authorization: "AUTHORIZED", issue_id: "issue-1", workspace_id: "ws-1", dispatch_id: "d-1", executor_id: "CO-02",
  provider: "codex_cloud", provider_run_id: "run-1", session_id: "s-1", fencing_token: "fence-1", fencing_epoch: 1, lease_active: true,
  lease_expires_at: "2026-10-23T21:00:00.000Z", expected_version: 1, idempotency_key: "idem", last_event_sequence: 0,
  provider_attestation: {verified: true, source: "SERVER_PROVIDER_VERIFIER", event_id: "evt-1", provider_run_id: "run-1", session_id: "s-1", provider: "codex_cloud", transport: "codex_cloud"},
  atomic_event_claim: {status: "CLAIMED", event_id: "evt-1", sequence: 1, fencing_epoch: 1}};
const now = Date.parse("2026-10-22T21:01:00.000Z");
function setup(record, opts = {}) {
  const persistence = createNativePersistenceAdapter({beginTransaction: async () => {
    let pending = null;
    return {async lockIssue() {}, async lockTask() {}, async readRecord() { return structuredClone(record); },
      async writeRecord(n) { pending = structuredClone(n); }, async commit() { if (pending) Object.assign(record, pending); }, async rollback() { pending = null; }};
  }});
  return createNativeAgentAtomicWriteAdapter({nativePersistenceAdapter: persistence, issueId: "issue-1", taskId: "t-1", idempotencyKey: "idem", expectedVersion: 1, fencingToken: "fence-1", ...opts});
}
const mutationFor = () => buildNativeAgentReportMutation(validateAgentReportEvent(event, context, now));

test("finding 1: locked transaction rejects stale fencing token, epoch, inactive lease", async () => {
  for (const patch of [{fencing_token: "other"}, {fencing_epoch: 2}, {lease_active: false}, {lease_expires_at: "2020-01-01T00:00:00Z"}, {status: "done"}]) {
    const record = {...baseRecord(), ...patch};
    const result = await setup(record).applyAgentReportMutation(mutationFor());
    assert.equal(result.committed, false, JSON.stringify(patch));
    assert.equal(record.version, 1);
  }
});

test("finding 2: mutation.expected_version and CTO task_revision are honored", async () => {
  const record = {...baseRecord(), status: "in_review"};
  const adapter = setup(record);
  const mutation = {...mutationFor(), expected_version: 5};
  assert.equal((await adapter.applyAgentReportMutation(mutation)).committed, false);
  assert.equal((await adapter.applyCtoCompletion({task_revision: 9, review_event_id: "r1"})).committed, false);
  assert.equal(record.version, 1);
  assert.equal((await adapter.applyCtoCompletion({task_revision: 1, review_event_id: "r1"})).committed, true);
});

test("finding 3: committed report keeps audit and comment on the record", async () => {
  const record = baseRecord();
  const result = await setup(record).applyAgentReportMutation(mutationFor());
  assert.equal(result.committed, true);
  const entry = record.audit_log.at(-1);
  assert.equal(entry.event_id, "evt-1");
  assert.equal(entry.provider_run_id, "run-1");
  assert.equal(entry.dispatch_id, "d-1");
  assert.match(record.comments.at(-1).content, /Agent 工作進度/);
});

test("hardening: malformed or null expected_version / task_revision never fall back", async () => {
  for (const bad of ["9", null, 1.5, NaN]) {
    const record = baseRecord();
    const adapter = setup(record);
    assert.equal((await adapter.applyAgentReportMutation({...mutationFor(), expected_version: bad})).committed, false, String(bad));
    assert.equal((await adapter.applyCtoCompletion({task_revision: bad, review_event_id: "r"})).committed, false, String(bad));
    assert.equal(record.version, 1);
  }
});

test("hardening: missing or invalid lease_expires_at fails closed", async () => {
  for (const patch of [{lease_expires_at: undefined}, {lease_expires_at: null}, {lease_expires_at: "garbage"}]) {
    const record = {...baseRecord(), ...patch};
    assert.equal((await setup(record).applyAgentReportMutation(mutationFor())).committed, false, JSON.stringify(patch));
    assert.equal(record.version, 1);
  }
});

test("hardening: locked record lease_id, run, session and stop request are compared", async () => {
  for (const patch of [{lease_id: "other-lease"}, {provider_run_id: "other-run"}, {provider_session_id: "other"}, {stop_requested_at: "2026-10-22T00:00:00Z"}]) {
    const record = {...baseRecord(), ...patch};
    const mutation = {...mutationFor(), lease_id: "lease-1"};
    assert.equal((await setup(record).applyAgentReportMutation(mutation)).committed, false, JSON.stringify(patch));
  }
  const good = {...baseRecord(), lease_id: "lease-1", provider_run_id: "run-1", provider_session_id: "s-1"};
  assert.equal((await setup(good).applyAgentReportMutation({...mutationFor(), lease_id: "lease-1"})).committed, true);
});

test("hardening: CTO completion needs in_review, ignores the Agent lease, and cannot repeat on done", async () => {
  const notReview = baseRecord();
  assert.equal((await setup(notReview).applyCtoCompletion({task_revision: 1, review_event_id: "r"})).committed, false);
  const review = {...baseRecord(), status: "in_review", lease_active: false};
  const adapter = setup(review);
  assert.equal((await adapter.applyCtoCompletion({task_revision: 1, review_event_id: "r"})).committed, true);
  assert.equal(review.status, "done");
  assert.equal(review.version, 2);
  const again = await adapter.applyCtoCompletion({task_revision: 1, review_event_id: "r2"});
  assert.equal(again.committed, false);
  assert.equal(review.version, 2);
});

test("hardening: audit cannot override event_id and same factory version cannot commit twice", async () => {
  const record = baseRecord();
  const adapter = setup(record);
  const mutation = mutationFor();
  mutation.audit = {...mutation.audit, event_id: "evil"};
  assert.equal((await adapter.applyAgentReportMutation(mutation)).committed, true);
  assert.equal(record.audit_log.at(-1).event_id, "evt-1");
  assert.equal((await adapter.applyAgentReportMutation(mutation)).committed, false);
  assert.equal(record.version, 2);
});

test("canonical bindings fail closed if either record or report side is absent, blank, or different", async () => {
  const pairs = [["issue_id", "issue_id"], ["workspace", "workspace_id"], ["dispatch_id", "audit.dispatch_id"],
    ["executor_id", "audit.executor_id"], ["writer_id", "audit.executor_id"], ["provider", "audit.provider"],
    ["lease_id", "lease_id"], ["provider_run_id", "audit.provider_run_id"], ["provider_session_id", "audit.session_id"]];
  for (const [recordKey, mutationKey] of pairs) {
    for (const value of [undefined, null, "", "wrong"]) {
      const record = {...baseRecord(), [recordKey]: value};
      assert.equal((await setup(record).applyAgentReportMutation(mutationFor())).committed, false, `record ${recordKey}=${value}`);
      assert.equal(record.version, 1);
      const goodRecord = baseRecord();
      const mutation = mutationFor();
      if (mutationKey.startsWith("audit.")) mutation.audit[mutationKey.slice(6)] = value;
      else mutation[mutationKey] = value;
      assert.equal((await setup(goodRecord).applyAgentReportMutation(mutation)).committed, false, `mutation ${mutationKey}=${value}`);
      assert.equal(goodRecord.version, 1);
    }
  }
  const empty = baseRecord();
  delete empty.lease_id; delete empty.provider_run_id; delete empty.provider_session_id;
  assert.equal((await setup(empty).applyAgentReportMutation(mutationFor())).committed, false);
  const good = baseRecord();
  assert.equal((await setup(good).applyAgentReportMutation(mutationFor())).committed, true);
});

test("server clock is called inside the locked reducer and expiry equality rejects", async () => {
  for (const lockedNow of [now + 1000, now + 2000]) {
    const record = {...baseRecord(), lease_expires_at: now + 1000};
    let clockCalls = 0;
    const adapter = setup(record, {serverClock: () => { clockCalls++; return lockedNow; }});
    // Validation is earlier than expiry. The locked check must not reuse this time.
    const mutation = mutationFor();
    assert.equal(clockCalls, 0);
    assert.equal((await adapter.applyAgentReportMutation(mutation)).committed, false);
    assert.equal(clockCalls, 1);
    assert.equal(record.version, 1);
  }
  const record = {...baseRecord(), lease_expires_at: now + 1000};
  assert.equal((await setup(record, {serverClock: () => now}).applyAgentReportMutation(mutationFor())).committed, true);
});

test("report cannot regress an in_review Issue", async () => {
  const record = {...baseRecord(), status: "in_review"};
  assert.equal((await setup(record).applyAgentReportMutation(mutationFor())).committed, false);
  assert.equal(record.version, 1);
});
