import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createDispatchIntent} from "../labs/taskflow/pages-client/dispatch-runtime-contract.mjs";
import {
  applyDurableDispatchEvent,
  buildResumeDecision,
  createDurableDispatchRecord,
  durableRecordFromIntent,
  hydrateDurableDispatchRecord,
  recoverDurableDispatchAfterRestart
} from "../labs/taskflow/pages-client/dispatch-persistence-contract.mjs";
import {
  buildProviderDispatchRequest,
  buildProviderCallbackAcceptanceDecision,
  createProviderAdapter,
  normalizeProviderEvent,
  PHASE2_PROVIDER_CAPABILITY_MATRIX
} from "../labs/taskflow/pages-client/provider-adapter-contract.mjs";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const intentInput = {
  intentId: "intent-phase2-1",
  issuerUserId: "cto-user",
  issuerAuthorization: "AUTHORIZED",
  workspace: "zhuge-ai-os",
  scope: "taskflow",
  workCode: "DM-02",
  issueId: "issue-1",
  executorId: "CO-02",
  provider: "codex",
  taskId: "task-1"
};

function event(record, values) {
  return {expected_version: record.version, observed_at: new Date(NOW).toISOString(), ...values};
}

function lease(record, overrides = {}) {
  return applyDurableDispatchEvent(record, event(record, {
    event_id: "lease-1",
    type: "LEASE_ACQUIRED",
    writer_id: "writer-a",
    fencing_token: "fence-a",
    fencing_epoch: 1,
    lease_expires_at: new Date(NOW + 60_000).toISOString(),
    ...overrides
  }), NOW);
}

test("durable record survives serialization and rejects duplicate provider runs", () => {
  const record = durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()});
  const leased = lease(record).record;
  const acknowledged = applyDurableDispatchEvent(leased, event(leased, {
    event_id: "provider-ack-1",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-1",
    status: "acknowledged",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(acknowledged.state, "ACK_PENDING");
  const restored = hydrateDurableDispatchRecord(JSON.parse(JSON.stringify(acknowledged.record)));
  assert.equal(restored.provider_run_id, "codex-run-1");
  const duplicate = applyDurableDispatchEvent(restored, event(restored, {
    event_id: "provider-ack-2",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-2",
    status: "running",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(duplicate.reason, "MULTIPLE_PROVIDER_RUNS");
  assert.equal(duplicate.state, "BLOCKED");
});

test("a second provider ACK is rejected and retained as an audit event", () => {
  const record = durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()});
  const acknowledged = applyDurableDispatchEvent(lease(record).record, event(lease(record).record, {
    event_id: "provider-ack-once",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-ack",
    status: "acknowledged",
    fencing_token: "fence-a"
  }), NOW);
  const duplicate = applyDurableDispatchEvent(acknowledged.record, event(acknowledged.record, {
    event_id: "provider-ack-duplicate",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-ack",
    status: "acknowledged",
    fencing_token: "fence-a"
  }), NOW);

  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "DUPLICATE_PROVIDER_ACK");
  assert.equal(duplicate.state, "ACK_PENDING");
  assert.equal(duplicate.record.provider_run_id, "codex-run-ack");
  assert.ok(duplicate.record.rejected_event_ids.includes("provider-ack-duplicate"));
  assert.equal(duplicate.record.audit_log.at(-1).reason, "DUPLICATE_PROVIDER_ACK");
});

test("replay and persisted version conflicts fail closed across a restart", () => {
  let record = lease(durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()})).record;
  const first = applyDurableDispatchEvent(record, event(record, {
    event_id: "provider-running-1",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-1",
    status: "running",
    fencing_token: "fence-a"
  }), NOW);
  record = first.record;
  const replay = applyDurableDispatchEvent(record, {...event(record, {event_id: "provider-running-1", type: "PROVIDER_EVENT", provider: "codex", provider_run_id: "codex-run-1", status: "running", fencing_token: "fence-a"}), expected_version: record.version - 1}, NOW);
  assert.equal(replay.reason, "EVENT_REPLAY");
  const conflict = applyDurableDispatchEvent(record, {event_id: "heartbeat-race", expected_version: 1, type: "HEARTBEAT", observed_at: new Date(NOW).toISOString(), provider_run_id: "codex-run-1", fencing_token: "fence-a"}, NOW);
  assert.equal(conflict.reason, "PERSISTED_VERSION_CONFLICT");
});

test("restart expires a lease and leaves reassign as an explicit review gate", () => {
  let record = lease(durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()})).record;
  const running = applyDurableDispatchEvent(record, event(record, {
    event_id: "provider-running-2",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-2",
    status: "running",
    fencing_token: "fence-a"
  }), NOW).record;
  const recovered = recoverDurableDispatchAfterRestart(running, NOW + 61_000);
  assert.equal(recovered.state, "OVERDUE");
  assert.equal(recovered.record.lease_active, false);
  const reassigned = applyDurableDispatchEvent(recovered.record, {
    expected_version: recovered.record.version,
    event_id: "reassign-review-1",
    type: "REASSIGN_REVIEW",
    observed_at: new Date(NOW + 61_000).toISOString()
  }, NOW + 61_000);
  assert.equal(reassigned.state, "REASSIGN_REVIEW");
  const oldHeartbeat = applyDurableDispatchEvent(reassigned.record, {
    expected_version: reassigned.record.version,
    event_id: "old-heartbeat-1",
    type: "HEARTBEAT",
    observed_at: new Date(NOW + 61_000).toISOString(),
    provider_run_id: "codex-run-2",
    fencing_token: "fence-a"
  }, NOW + 61_000);
  assert.equal(oldHeartbeat.reason, "NO_ACTIVE_LEASE");
});

test("fencing epoch is monotonic and old writer callbacks stay rejected", () => {
  const base = durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()});
  const firstLease = lease(base, {lease_expires_at: new Date(NOW - 1).toISOString()});
  assert.equal(firstLease.reason, "LEASE_INVALID");
  const active = lease(base).record;
  const expired = recoverDurableDispatchAfterRestart(active, NOW + 61_000);
  const review = applyDurableDispatchEvent(expired.record, {
    expected_version: expired.record.version,
    event_id: "reassign-review-2",
    type: "REASSIGN_REVIEW",
    observed_at: new Date(NOW + 61_000).toISOString()
  }, NOW + 61_000);
  const retry = applyDurableDispatchEvent(review.record, {
    expected_version: review.record.version,
    event_id: "retry-1",
    type: "RETRY_REQUESTED",
    observed_at: new Date(NOW + 61_000).toISOString(),
    retry_of_provider_run_id: ""
  }, NOW + 61_000);
  const nextLease = applyDurableDispatchEvent(retry.record, {
    expected_version: retry.record.version,
    event_id: "lease-2",
    type: "LEASE_ACQUIRED",
    writer_id: "writer-b",
    fencing_token: "fence-b",
    fencing_epoch: 2,
    lease_expires_at: new Date(NOW + 120_000).toISOString(),
    observed_at: new Date(NOW + 61_000).toISOString()
  }, NOW + 61_000);
  assert.equal(nextLease.state, "ASSIGNED");
  const oldCallback = applyDurableDispatchEvent(nextLease.record, {
    expected_version: nextLease.record.version,
    event_id: "old-callback-1",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-old",
    status: "running",
    fencing_token: "fence-a",
    observed_at: new Date(NOW + 61_000).toISOString()
  }, NOW + 61_000);
  assert.equal(oldCallback.reason, "FENCING_TOKEN_MISMATCH");
});

test("heartbeat, checkpoint and quota boundaries retain evidence without claiming RUNNING", () => {
  let record = lease(durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()})).record;
  record = applyDurableDispatchEvent(record, event(record, {
    event_id: "provider-running-3",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-3",
    status: "running",
    fencing_token: "fence-a"
  }), NOW).record;
  const checkpoint = applyDurableDispatchEvent(record, event(record, {
    event_id: "checkpoint-1",
    type: "CHECKPOINT",
    provider: "codex",
    provider_run_id: "codex-run-3",
    checkpoint_ref: "provider-checkpoint-1",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(checkpoint.state, "RUNNING");
  const quota = applyDurableDispatchEvent(checkpoint.record, event(checkpoint.record, {
    event_id: "quota-1",
    type: "PROVIDER_QUOTA_EXHAUSTED",
    provider: "codex",
    provider_run_id: "codex-run-3",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(quota.state, "BLOCKED");
  assert.equal(quota.record.quota_state, "EXHAUSTED");
  assert.equal(quota.record.checkpoint_ref, "provider-checkpoint-1");
});

test("stale heartbeat and wrong Run ID callbacks fail closed with traceable state", () => {
  let record = lease(durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()})).record;
  record = applyDurableDispatchEvent(record, event(record, {
    event_id: "provider-running-heartbeat-boundary",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-heartbeat",
    status: "running",
    fencing_token: "fence-a"
  }), NOW).record;
  const stale = applyDurableDispatchEvent(record, event(record, {
    event_id: "heartbeat-stale-1",
    type: "HEARTBEAT",
    provider: "codex",
    provider_run_id: "codex-run-heartbeat",
    fencing_token: "fence-a",
    observed_at: new Date(NOW - 61_000).toISOString()
  }), NOW);
  assert.equal(stale.reason, "HEARTBEAT_STALE");
  assert.equal(stale.state, "OVERDUE");
  assert.equal(stale.record.provider_run_id, "codex-run-heartbeat");

  const wrongRun = applyDurableDispatchEvent(record, event(record, {
    event_id: "heartbeat-wrong-run-1",
    type: "HEARTBEAT",
    provider: "codex",
    provider_run_id: "codex-run-forged",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(wrongRun.reason, "MULTIPLE_PROVIDER_RUNS");
  assert.equal(wrongRun.state, "BLOCKED");
});

test("quota exhaustion keeps evidence and only a matching retry can clear the run binding", () => {
  let record = lease(durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()})).record;
  record = applyDurableDispatchEvent(record, event(record, {
    event_id: "provider-running-quota-boundary",
    type: "PROVIDER_EVENT",
    provider: "codex",
    provider_run_id: "codex-run-quota",
    status: "running",
    fencing_token: "fence-a"
  }), NOW).record;
  const exhausted = applyDurableDispatchEvent(record, event(record, {
    event_id: "quota-exhausted-retry-1",
    type: "PROVIDER_QUOTA_EXHAUSTED",
    provider: "codex",
    provider_run_id: "codex-run-quota",
    fencing_token: "fence-a"
  }), NOW);
  assert.equal(exhausted.state, "BLOCKED");
  assert.equal(exhausted.record.quota_state, "EXHAUSTED");

  const wrongRetry = applyDurableDispatchEvent(exhausted.record, event(exhausted.record, {
    event_id: "retry-wrong-source-1",
    type: "RETRY_REQUESTED",
    retry_of_provider_run_id: "codex-run-other"
  }), NOW);
  assert.equal(wrongRetry.reason, "RETRY_SOURCE_RUN_MISMATCH");
  assert.equal(wrongRetry.state, "BLOCKED");

  const retry = applyDurableDispatchEvent(wrongRetry.record, event(wrongRetry.record, {
    event_id: "retry-matching-source-1",
    type: "RETRY_REQUESTED",
    retry_of_provider_run_id: "codex-run-quota"
  }), NOW);
  assert.equal(retry.accepted, true);
  assert.equal(retry.state, "ACK_PENDING");
  assert.equal(retry.record.provider_run_id, null);
  assert.equal(retry.record.attempt, 2);
  assert.equal(retry.record.run_history[0].provider_run_id, "codex-run-quota");
  assert.equal(retry.record.quota_state, "EXHAUSTED");
});

test("resume and reassign require provider ACK, checkpoint and stop evidence", () => {
  const base = durableRecordFromIntent(intentInput, {createdAt: new Date(NOW).toISOString()});
  assert.equal(buildResumeDecision(base, {providerAck: true, checkpointEvidence: true, stopEvidence: true}).reason, "REASSIGN_REVIEW_REQUIRED");
  const review = {...base, state: "REASSIGN_REVIEW", provider_run_id: "codex-run-4", checkpoint_ref: "checkpoint-4"};
  assert.equal(buildResumeDecision(review, {providerAck: true, checkpointEvidence: true, stopEvidence: false}).reason, "STOP_EVIDENCE_REQUIRED");
  assert.equal(buildResumeDecision(review, {providerAck: true, checkpointEvidence: true, stopEvidence: true}).ok, true);
});

test("default provider adapters fail closed and never mint a Provider Run ID", () => {
  const input = {authority_result: "AUTHORIZED", workspace: "zhuge-ai-os", issue_id: "issue-1", task_id: "task-1", executor_id: "CO-02", work_code: "DM-02", idempotency_key: "intent-1"};
  for (const provider of Object.keys(PHASE2_PROVIDER_CAPABILITY_MATRIX)) {
    const result = buildProviderDispatchRequest({...input, provider}, {credentialStatus: "CONFIGURED", providerBindingId: "binding", paidProviderAuthorization: true});
    assert.equal(result.ok, false);
    assert.equal(result.provider_run_id, null);
  }
  const adapter = createProviderAdapter("codex");
  assert.equal(adapter.dispatch(input).state, "BLOCKED");
});

test("provider adapter only accepts signed evidence when capability is explicitly verified", () => {
  const verified = {codex: {...PHASE2_PROVIDER_CAPABILITY_MATRIX.codex, dispatch: "VERIFIED", ack: "VERIFIED", run_lookup: "VERIFIED"}};
  const ready = buildProviderDispatchRequest({provider: "codex", authority_result: "AUTHORIZED", workspace: "zhuge-ai-os", issue_id: "issue-1", task_id: "task-1", executor_id: "CO-02", work_code: "DM-02", idempotency_key: "intent-1"}, {capabilities: verified, credentialStatus: "CONFIGURED", providerBindingId: "binding", paidProviderAuthorization: true});
  assert.equal(ready.ok, true);
  assert.equal(ready.provider_run_id, null);
  assert.equal(normalizeProviderEvent({provider: "codex", event_id: "event-1", provider_run_id: "provider-run-1", status: "running", observed_at: new Date(NOW).toISOString(), signature_verified: false}, {capabilities: verified}).reason, "PROVIDER_SIGNATURE_UNVERIFIED");
  const evidence = normalizeProviderEvent({provider: "codex", event_id: "event-1", provider_run_id: "provider-run-1", status: "running", observed_at: new Date(NOW).toISOString(), signature_verified: true}, {capabilities: verified});
  assert.equal(evidence.ok, true);
  assert.equal(evidence.evidence.provider_run_id, "provider-run-1");
});

test("provider callback gate binds native identity and rejects replay or run ID confusion", () => {
  const verified = {
    codex: {
      ...PHASE2_PROVIDER_CAPABILITY_MATRIX.codex,
      dispatch: "VERIFIED",
      ack: "VERIFIED",
      run_lookup: "VERIFIED",
      callback_signature: "VERIFIED"
    }
  };
  const expected = {
    authority_result: "AUTHORIZED",
    provider: "codex",
    workspace: "zhuge-ai-os",
    issue_id: "issue-1",
    task_id: "task-1",
    idempotency_key: "intent-1"
  };
  const callback = {
    ...expected,
    event_id: "provider-event-1",
    provider_run_id: "codex-run-1",
    status: "running",
    observed_at: new Date(NOW).toISOString(),
    signature_verified: true
  };
  const accepted = buildProviderCallbackAcceptanceDecision(callback, {capabilities: verified, expected});
  assert.equal(accepted.ok, true);
  assert.equal(accepted.evidence.task_id, "task-1");
  assert.equal(accepted.evidence.replay_protection, "persisted_event_id_and_idempotency_key");
  assert.equal(buildProviderCallbackAcceptanceDecision(callback, {capabilities: verified, expected, seenEventIds: ["provider-event-1"]}).reason, "EVENT_REPLAY");
  assert.equal(buildProviderCallbackAcceptanceDecision({...callback, provider_run_id: "task-1"}, {capabilities: verified, expected}).reason, "PROVIDER_RUN_TASK_ID_COLLISION");
  assert.equal(buildProviderCallbackAcceptanceDecision({...callback, workspace: "other-workspace"}, {capabilities: verified, expected}).reason, "PROVIDER_CALLBACK_WORKSPACE_MISMATCH");
  assert.equal(buildProviderCallbackAcceptanceDecision({...callback, signature_verified: false}, {capabilities: verified, expected}).reason, "PROVIDER_SIGNATURE_UNVERIFIED");
});

test("provider callback gate keeps checkpoint, heartbeat and quota capabilities fail-closed", () => {
  const verified = {
    codex: {
      ...PHASE2_PROVIDER_CAPABILITY_MATRIX.codex,
      ack: "VERIFIED",
      run_lookup: "VERIFIED",
      callback_signature: "VERIFIED"
    }
  };
  const expected = {
    authority_result: "AUTHORIZED",
    provider: "codex",
    workspace: "zhuge-ai-os",
    issue_id: "issue-1",
    task_id: "task-1",
    idempotency_key: "intent-2"
  };
  const base = {
    ...expected,
    event_id: "provider-event-2",
    provider_run_id: "codex-run-2",
    status: "running",
    observed_at: new Date(NOW).toISOString(),
    signature_verified: true
  };
  assert.equal(buildProviderCallbackAcceptanceDecision({...base, event_type: "HEARTBEAT"}, {capabilities: verified, expected}).reason, "PROVIDER_HEARTBEAT_UNVERIFIED");
  assert.equal(buildProviderCallbackAcceptanceDecision({...base, event_id: "provider-event-3", event_type: "CHECKPOINT", checkpoint_ref: "cp-1"}, {capabilities: verified, expected}).reason, "PROVIDER_CHECKPOINT_UNVERIFIED");
  assert.equal(buildProviderCallbackAcceptanceDecision({...base, event_id: "provider-event-4", event_type: "PROVIDER_QUOTA_EXHAUSTED"}, {capabilities: verified, expected}).reason, "PROVIDER_QUOTA_UNVERIFIED");
  const complete = {
    ...verified.codex,
    heartbeat: "VERIFIED",
    checkpoint: "VERIFIED",
    quota: "VERIFIED"
  };
  const completeCapabilities = {codex: complete};
  assert.equal(buildProviderCallbackAcceptanceDecision({...base, event_type: "HEARTBEAT"}, {capabilities: completeCapabilities, expected}).ok, true);
  assert.equal(buildProviderCallbackAcceptanceDecision({...base, event_id: "provider-event-5", event_type: "CHECKPOINT", checkpoint_ref: "cp-1"}, {capabilities: completeCapabilities, expected}).ok, true);
});

test("unauthorized durable intents remain blocked even if a client claims CTO", () => {
  const unauthorized = createDispatchIntent({...intentInput, issuerAuthorization: "UNVERIFIED"});
  const record = createDurableDispatchRecord(unauthorized, {createdAt: new Date(NOW).toISOString()});
  assert.equal(record.state, "BLOCKED");
  const result = applyDurableDispatchEvent(record, {
    expected_version: record.version,
    event_id: "unauthorized-lease-1",
    type: "LEASE_ACQUIRED",
    writer_id: "writer-a",
    fencing_token: "fence-a",
    fencing_epoch: 1,
    lease_expires_at: new Date(NOW + 60_000).toISOString(),
    observed_at: new Date(NOW).toISOString()
  }, NOW);
  assert.equal(result.reason, "CTO_AUTHORIZATION_UNVERIFIED");
  assert.equal(result.state, "BLOCKED");
});

test("Phase 2 schema and capability matrix keep unverified runtime explicit", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("../labs/taskflow/docs/DM00_DM03_PHASE2_RUNTIME_SCHEMA.json", import.meta.url), "utf8"));
  assert.equal(schema.$id, "zhuge-taskflow-phase2-dispatch-runtime-v1");
  assert.ok(schema.properties.provider_run_id);
  assert.ok(schema.properties.fencing_epoch);
  for (const capability of Object.values(PHASE2_PROVIDER_CAPABILITY_MATRIX)) {
    assert.notEqual(capability.dispatch, "VERIFIED");
    assert.match(capability.evidence_source, /Review environment|GitHub mirror/);
  }
});
