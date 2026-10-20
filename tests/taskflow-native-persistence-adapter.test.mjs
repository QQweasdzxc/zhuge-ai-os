import assert from "node:assert/strict";
import test from "node:test";
import {applyDurableDispatchEvent, durableRecordFromIntent} from "../labs/taskflow/pages-client/dispatch-persistence-contract.mjs";
import {createNativePersistenceAdapter} from "../labs/taskflow/pages-client/native-persistence-adapter-contract.mjs";

const NOW = Date.parse("2026-10-20T20:30:00.000Z");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialRecord() {
  return durableRecordFromIntent({
    intentId: "intent:native-adapter-1",
    issuerUserId: "cto-user-1",
    issuerAuthorization: "AUTHORIZED",
    workspace: "workspace-1",
    workCode: "DM-02",
    issueId: "issue-1",
    executorId: "CO-02",
    provider: "codex",
    taskId: "task-1"
  }, {createdAt: new Date(NOW).toISOString()});
}

class NativeStore {
  constructor(record) {
    this.record = clone(record);
    this.queue = Promise.resolve();
    this.writeCount = 0;
  }

  async acquire() {
    let release;
    const previous = this.queue;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  }

  beginTransaction() {
    return Promise.resolve(new NativeTransaction(this));
  }
}

class NativeTransaction {
  constructor(store) {
    this.store = store;
    this.release = null;
    this.pending = null;
    this.finished = false;
  }

  async lockIssue(issueId) {
    assert.equal(issueId, "issue-1");
    this.release = await this.store.acquire();
  }

  async lockTask(taskId) {
    assert.equal(taskId, "task-1");
    assert.ok(this.release, "task row must be locked after issue row");
  }

  async readRecord() {
    return clone(this.store.record);
  }

  async writeRecord(record) {
    this.pending = clone(record);
  }

  async commit() {
    if (this.pending) {
      this.store.record = this.pending;
      this.store.writeCount += 1;
    }
    this.finish();
  }

  async rollback() {
    this.pending = null;
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.release) this.release();
  }
}

function adapterFor(store, options = {}) {
  return createNativePersistenceAdapter({beginTransaction: () => store.beginTransaction(), ...options});
}

function leaseEvent(expectedVersion = 1) {
  return {
    event_id: "provider:lease-1",
    type: "LEASE_ACQUIRED",
    writer_id: "CO-02",
    fencing_token: "fence-1",
    fencing_epoch: 1,
    lease_expires_at: new Date(NOW + 60_000).toISOString(),
    observed_at: new Date(NOW).toISOString(),
    expected_version: expectedVersion
  };
}

test("native adapter serializes concurrent writers with the native row-lock contract", async () => {
  const store = new NativeStore(initialRecord());
  const auditEvents = [];
  const adapter = adapterFor(store, {auditSink: entry => auditEvents.push(entry)});
  const input = {
    issueId: "issue-1",
    taskId: "task-1",
    idempotencyKey: store.record.idempotency_key,
    event: leaseEvent(),
    mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  };

  const [first, second] = await Promise.all([
    adapter.runAtomicMutation(input),
    adapter.runAtomicMutation(input)
  ]);

  assert.equal(first.accepted, true);
  assert.equal(first.committed, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "PERSISTED_VERSION_CONFLICT");
  assert.equal(store.record.writer_id, "CO-02");
  assert.equal(store.record.fencing_epoch, 1);
  assert.equal(store.writeCount, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].reason, "PERSISTED_VERSION_CONFLICT");
});

test("replayed provider events commit without a second write", async () => {
  const store = new NativeStore(initialRecord());
  const adapter = adapterFor(store);
  const key = store.record.idempotency_key;
  const first = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: leaseEvent(), mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });
  const replay = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: leaseEvent(first.record.version), mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });

  assert.equal(first.accepted, true);
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, "EVENT_REPLAY");
  assert.equal(replay.committed, true);
  assert.equal(store.record.version, 2);
  assert.equal(store.writeCount, 1);
});

test("a reducer failure rolls back and leaves the native record unchanged", async () => {
  const store = new NativeStore(initialRecord());
  const adapter = adapterFor(store);
  const before = clone(store.record);
  const result = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: before.idempotency_key,
    event: leaseEvent(), mutate: () => { throw new Error("simulated process failure"); }
  });

  assert.equal(result.reason, "NATIVE_TRANSACTION_ROLLBACK");
  assert.deepEqual(store.record, before);
  assert.equal(store.writeCount, 0);
});

test("a new adapter instance can recover an expired lease from the persisted native record", async () => {
  const store = new NativeStore(initialRecord());
  const firstAdapter = adapterFor(store);
  await firstAdapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: store.record.idempotency_key,
    event: leaseEvent(), mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });

  const restartedAdapter = adapterFor(store);
  const result = await restartedAdapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: store.record.idempotency_key,
    event: {
      event_id: "recovery:lease-expired:2",
      type: "LEASE_EXPIRED",
      fencing_token: "fence-1",
      observed_at: new Date(NOW + 60_000).toISOString(),
      expected_version: 2
    },
    mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW + 60_000)
  });

  assert.equal(result.accepted, true);
  assert.equal(store.record.state, "OVERDUE");
  assert.equal(store.record.lease_active, false);
  assert.equal(store.record.version, 3);
});

test("native adapter persists fencing rejection audit without changing the active writer", async () => {
  const store = new NativeStore(initialRecord());
  const adapter = adapterFor(store);
  const key = store.record.idempotency_key;
  const leased = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: leaseEvent(), mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });
  const running = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: {
      event_id: "provider:run-1", type: "PROVIDER_EVENT", provider: "codex",
      provider_run_id: "codex-run-1", status: "running", fencing_token: "fence-1",
      observed_at: new Date(NOW).toISOString(), expected_version: leased.record.version
    },
    mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });
  const rejected = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: {
      event_id: "provider:stale-heartbeat-1", type: "HEARTBEAT", provider: "codex",
      provider_run_id: "codex-run-1", fencing_token: "stale-fence",
      observed_at: new Date(NOW).toISOString(), expected_version: running.record.version
    },
    mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "FENCING_TOKEN_MISMATCH");
  assert.equal(rejected.committed, true);
  assert.equal(store.record.writer_id, "CO-02");
  assert.equal(store.record.fencing_token, "fence-1");
  assert.ok(store.record.rejected_event_ids.includes("provider:stale-heartbeat-1"));
  assert.equal(rejected.transaction_evidence.audit.state, "RECORDED_IN_NATIVE_RECORD");
});

test("native adapter rolls back a mutation that attempts to rewrite an active writer", async () => {
  const store = new NativeStore(initialRecord());
  const adapter = adapterFor(store);
  const key = store.record.idempotency_key;
  const leased = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: leaseEvent(), mutate: (current, event) => applyDurableDispatchEvent(current, event, NOW)
  });
  const before = clone(store.record);
  const result = await adapter.runAtomicMutation({
    issueId: "issue-1", taskId: "task-1", idempotencyKey: key,
    event: {
      event_id: "writer-rewrite-1", type: "PROVIDER_EVENT", provider: "codex",
      provider_run_id: "codex-run-2", status: "running", fencing_token: "fence-1",
      observed_at: new Date(NOW).toISOString(), expected_version: leased.record.version
    },
    mutate: current => ({
      accepted: true,
      state: "RUNNING",
      record: {...current, version: current.version + 1, writer_id: "CO-03", fencing_token: "fence-3"}
    })
  });

  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reason, "WRITER_LEASE_MUTATION_UNAUTHORIZED");
  assert.deepEqual(store.record, before);
  assert.equal(store.writeCount, 1);
});

test("missing native transaction binding is fail-closed", async () => {
  const adapter = createNativePersistenceAdapter();
  const result = await adapter.runAtomicMutation({issueId: "issue-1", idempotencyKey: "key"});
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reason, "NATIVE_ROW_LOCK_ADAPTER_UNVERIFIED");
});
