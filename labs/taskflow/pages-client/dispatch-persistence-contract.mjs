import {DISPATCH_RUNTIME_STATES, createDispatchIntent} from "./dispatch-runtime-contract.mjs";

export const DISPATCH_PERSISTENCE_SCHEMA = "zhuge-taskflow-dispatch-persistence-v1";

export const DURABLE_DISPATCH_STATES = Object.freeze([
  ...DISPATCH_RUNTIME_STATES,
  "PM_ACCEPTED"
]);

export const DURABLE_EVENT_TYPES = Object.freeze([
  "LEASE_ACQUIRED",
  "PROVIDER_EVENT",
  "HEARTBEAT",
  "CHECKPOINT",
  "PROVIDER_QUOTA_EXHAUSTED",
  "PROVIDER_UNAVAILABLE",
  "LEASE_EXPIRED",
  "REASSIGN_REVIEW",
  "RETRY_REQUESTED",
  "CTO_REVIEW",
  "PM_ACCEPT"
]);

const TERMINAL_STATES = new Set(["DONE", "FAILED", "CANCELLED", "PM_ACCEPTED"]);
const ACTIVE_STATES = new Set(["ASSIGNED", "ACK_PENDING", "RUNNING"]);
const PROVIDER_EVENT_STATES = Object.freeze({
  queued: "ACK_PENDING",
  acknowledged: "ACK_PENDING",
  running: "RUNNING",
  completed: "DONE",
  failed: "FAILED",
  cancelled: "CANCELLED"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function timeValue(value, fallback = null) {
  const numeric = numberValue(value);
  if (numeric !== null) return numeric;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isoTime(value, fallback) {
  const parsed = timeValue(value, fallback);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function exactSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim());
}

function failure(record, event, reason, state = record.state) {
  const next = clone(record);
  const eventId = text(event?.event_id);
  const observedAt = isoTime(event?.observed_at, Date.now());
  if (eventId && !next.rejected_event_ids.includes(eventId)) {
    next.rejected_event_ids.push(eventId);
    next.audit_log.push({event_id: eventId, type: text(event?.type), outcome: "REJECTED", reason, observed_at: observedAt});
    next.version += 1;
    next.last_observed_at = observedAt;
  }
  return {accepted: false, state, reason, record: next};
}

function success(record, event, next) {
  const eventId = text(event.event_id);
  const observedAt = isoTime(event.observed_at, Date.now());
  next.version = record.version + 1;
  next.last_event_id = eventId;
  next.processed_event_ids.push(eventId);
  next.last_observed_at = observedAt;
  next.audit_log.push({event_id: eventId, type: text(event.type), outcome: "ACCEPTED", state: next.state, observed_at: observedAt});
  return {accepted: true, state: next.state, record: next};
}

function requireEventIdentity(record, event, now) {
  const eventId = text(event?.event_id);
  const type = text(event?.type);
  if (!eventId) return failure(record, event, "EVENT_ID_MISSING");
  if (!type || !DURABLE_EVENT_TYPES.includes(type)) return failure(record, event, "EVENT_TYPE_UNSUPPORTED");
  if (record.processed_event_ids.includes(eventId) || record.rejected_event_ids.includes(eventId)) {
    return {accepted: false, state: record.state, reason: "EVENT_REPLAY", record: clone(record)};
  }
  if (event.expected_version !== undefined && event.expected_version !== record.version) {
    return {accepted: false, state: record.state, reason: "PERSISTED_VERSION_CONFLICT", record: clone(record)};
  }
  const observedAt = timeValue(event.observed_at, now);
  if (observedAt === null || observedAt > now + 5 * 60 * 1000) return failure(record, event, "EVENT_TIME_INVALID");
  return null;
}

function requireActiveLease(record, event, now) {
  const expiry = timeValue(record.lease_expires_at);
  if (!record.lease_active || expiry === null || expiry <= now) return "NO_ACTIVE_LEASE";
  if (text(event.fencing_token) !== record.fencing_token) return "FENCING_TOKEN_MISMATCH";
  return null;
}

function requireProviderRun(record, event) {
  const runId = text(event.provider_run_id);
  if (!runId) return "PROVIDER_RUN_ID_MISSING";
  if (record.provider_run_id && record.provider_run_id !== runId) return "MULTIPLE_PROVIDER_RUNS";
  if (text(event.provider) && text(event.provider) !== record.provider) return "PROVIDER_MISMATCH";
  return null;
}

function acceptLease(record, event, now) {
  if (record.issuer_authorization !== "AUTHORIZED") return failure(record, event, "CTO_AUTHORIZATION_UNVERIFIED", "BLOCKED");
  const leaseExpires = timeValue(event.lease_expires_at);
  const fencingEpoch = numberValue(event.fencing_epoch);
  if (!text(event.writer_id) || !text(event.fencing_token) || leaseExpires === null || leaseExpires <= now) {
    return failure(record, event, "LEASE_INVALID", "BLOCKED");
  }
  if (fencingEpoch === null || !Number.isInteger(fencingEpoch) || fencingEpoch <= record.fencing_epoch) {
    return failure(record, event, "FENCING_EPOCH_NOT_MONOTONIC", "BLOCKED");
  }
  if (record.lease_active && timeValue(record.lease_expires_at, 0) > now) {
    return failure(record, event, "WRITER_LEASE_ACTIVE", record.state);
  }
  if (record.provider_run_id && ACTIVE_STATES.has(record.state)) {
    return failure(record, event, "ACTIVE_PROVIDER_RUN_EXISTS", "BLOCKED");
  }
  const next = clone(record);
  next.writer_id = text(event.writer_id);
  next.fencing_token = text(event.fencing_token);
  next.fencing_epoch = fencingEpoch;
  next.lease_expires_at = new Date(leaseExpires).toISOString();
  next.lease_active = true;
  next.state = "ASSIGNED";
  next.blocked_reason = null;
  next.error = null;
  return success(record, event, next);
}

function acceptProviderEventInternal(record, event, now) {
  const leaseReason = requireActiveLease(record, event, now);
  if (leaseReason) return failure(record, event, leaseReason, leaseReason === "NO_ACTIVE_LEASE" ? "OVERDUE" : "BLOCKED");
  const runReason = requireProviderRun(record, event);
  if (runReason) return failure(record, event, runReason, runReason === "PROVIDER_RUN_ID_MISSING" ? "UNKNOWN" : "BLOCKED");
  const status = text(event.status).toLowerCase();
  const next = clone(record);
  next.provider_run_id = text(event.provider_run_id);
  next.provider_run_id_source = "provider_event";
  next.provider_acknowledged = status === "queued" || status === "acknowledged" || next.provider_acknowledged;
  next.provider_event_status = status;
  next.state = PROVIDER_EVENT_STATES[status] || "UNKNOWN";
  next.error = status === "failed" ? text(event.error) || "PROVIDER_FAILED" : null;
  if (TERMINAL_STATES.has(next.state)) next.lease_active = false;
  return success(record, event, next);
}

function acceptHeartbeatInternal(record, event, now) {
  const leaseReason = requireActiveLease(record, event, now);
  if (leaseReason) return failure(record, event, leaseReason, leaseReason === "NO_ACTIVE_LEASE" ? "OVERDUE" : "BLOCKED");
  const runReason = requireProviderRun(record, event);
  if (runReason) return failure(record, event, runReason, "BLOCKED");
  const observedAt = timeValue(event.observed_at);
  if (observedAt === null || observedAt > now || now - observedAt > 60_000) return failure(record, event, "HEARTBEAT_STALE", "OVERDUE");
  const next = clone(record);
  next.state = "RUNNING";
  next.last_heartbeat_at = new Date(observedAt).toISOString();
  return success(record, event, next);
}

function acceptCheckpointInternal(record, event, now) {
  const leaseReason = requireActiveLease(record, event, now);
  if (leaseReason) return failure(record, event, leaseReason, leaseReason === "NO_ACTIVE_LEASE" ? "OVERDUE" : "BLOCKED");
  const runReason = requireProviderRun(record, event);
  if (runReason) return failure(record, event, runReason, "BLOCKED");
  const checkpointRef = text(event.checkpoint_ref);
  if (!checkpointRef) return failure(record, event, "CHECKPOINT_REF_MISSING", "UNKNOWN");
  const next = clone(record);
  next.state = "RUNNING";
  next.checkpoint_ref = checkpointRef;
  next.checkpoint_observed_at = isoTime(event.observed_at, now);
  return success(record, event, next);
}

function acceptProviderBoundaryEvent(record, event, now, reason, state = "BLOCKED") {
  const leaseReason = requireActiveLease(record, event, now);
  if (leaseReason) return failure(record, event, leaseReason, leaseReason === "NO_ACTIVE_LEASE" ? "OVERDUE" : "BLOCKED");
  if (text(event.provider) && text(event.provider) !== record.provider) return failure(record, event, "PROVIDER_MISMATCH", "BLOCKED");
  if (event.provider_run_id) {
    const runReason = requireProviderRun(record, event);
    if (runReason) return failure(record, event, runReason, "BLOCKED");
  }
  const next = clone(record);
  next.state = state;
  next.blocked_reason = reason;
  next.quota_state = reason === "PROVIDER_QUOTA_EXHAUSTED" ? "EXHAUSTED" : next.quota_state;
  next.error = text(event.error) || reason;
  return success(record, event, next);
}

export function createDurableDispatchRecord(intent, {createdAt = new Date().toISOString(), eventId} = {}) {
  const source = intent && typeof intent === "object" ? intent : {};
  const required = ["intent_id", "idempotency_key", "issuer_user_id", "workspace", "work_code", "issue_id", "executor_id", "provider"];
  if (required.some(key => !text(source[key]))) throw new Error("durable dispatch record missing intent identity");
  const id = text(eventId) || `intent:${text(source.intent_id)}`;
  const authorized = text(source.issuer_authorization) === "AUTHORIZED";
  const observedAt = isoTime(createdAt, Date.now());
  return {
    schema: DISPATCH_PERSISTENCE_SCHEMA,
    intent_id: text(source.intent_id),
    idempotency_key: text(source.idempotency_key),
    issuer_user_id: text(source.issuer_user_id),
    issuer_authorization: text(source.issuer_authorization) || "UNVERIFIED",
    workspace: text(source.workspace),
    scope: text(source.scope),
    work_code: text(source.work_code),
    issue_id: text(source.issue_id),
    executor_id: text(source.executor_id),
    provider: text(source.provider),
    task_id: text(source.task_id) || null,
    state: authorized ? "INTENT_CREATED" : "BLOCKED",
    blocked_reason: authorized ? null : "CTO_AUTHORIZATION_UNVERIFIED",
    error: null,
    provider_run_id: null,
    provider_run_id_source: null,
    provider_acknowledged: false,
    provider_event_status: null,
    writer_id: null,
    fencing_token: null,
    fencing_epoch: 0,
    lease_active: false,
    lease_expires_at: null,
    checkpoint_ref: null,
    checkpoint_observed_at: null,
    last_heartbeat_at: null,
    quota_state: "UNKNOWN",
    attempt: 1,
    run_history: [],
    processed_event_ids: [id],
    rejected_event_ids: [],
    last_event_id: id,
    last_observed_at: observedAt,
    version: 1,
    audit_log: [{event_id: id, type: "INTENT_CREATED", outcome: "ACCEPTED", state: authorized ? "INTENT_CREATED" : "BLOCKED", observed_at: observedAt}]
  };
}

export function hydrateDurableDispatchRecord(snapshot) {
  const record = snapshot && typeof snapshot === "object" ? clone(snapshot) : null;
  if (!record || record.schema !== DISPATCH_PERSISTENCE_SCHEMA) throw new Error("unsupported durable dispatch schema");
  if (!text(record.intent_id) || !text(record.idempotency_key) || !text(record.workspace) || !text(record.issue_id) || !text(record.work_code)) {
    throw new Error("durable dispatch record missing identity");
  }
  if (!DURABLE_DISPATCH_STATES.includes(record.state)) throw new Error("durable dispatch state unsupported");
  if (!Number.isInteger(record.version) || record.version < 1 || !Number.isInteger(record.fencing_epoch) || record.fencing_epoch < 0) {
    throw new Error("durable dispatch version invalid");
  }
  for (const key of ["processed_event_ids", "rejected_event_ids", "run_history", "audit_log"]) {
    if (!Array.isArray(record[key])) throw new Error(`durable dispatch ${key} must be an array`);
  }
  return record;
}

export function applyDurableDispatchEvent(snapshot, event, now = Date.now()) {
  const record = hydrateDurableDispatchRecord(snapshot);
  const identityResult = requireEventIdentity(record, event, now);
  if (identityResult) return identityResult;
  const type = text(event.type);
  switch (type) {
    case "LEASE_ACQUIRED":
      return acceptLease(record, event, now);
    case "PROVIDER_EVENT":
      return acceptProviderEventInternal(record, event, now);
    case "HEARTBEAT":
      return acceptHeartbeatInternal(record, event, now);
    case "CHECKPOINT":
      return acceptCheckpointInternal(record, event, now);
    case "PROVIDER_QUOTA_EXHAUSTED":
      return acceptProviderBoundaryEvent(record, event, now, "PROVIDER_QUOTA_EXHAUSTED");
    case "PROVIDER_UNAVAILABLE":
      return acceptProviderBoundaryEvent(record, event, now, "PROVIDER_UNAVAILABLE");
    case "LEASE_EXPIRED": {
      const expiresAt = timeValue(record.lease_expires_at);
      if (!record.lease_active || expiresAt === null || expiresAt > now) return failure(record, event, "LEASE_NOT_EXPIRED", record.state);
      if (event.fencing_token && text(event.fencing_token) !== record.fencing_token) return failure(record, event, "FENCING_TOKEN_MISMATCH", "BLOCKED");
      const next = clone(record);
      next.lease_active = false;
      next.state = "OVERDUE";
      next.blocked_reason = "LEASE_EXPIRED";
      next.error = "LEASE_EXPIRED";
      return success(record, event, next);
    }
    case "REASSIGN_REVIEW": {
      if (record.lease_active || !["OVERDUE", "BLOCKED", "FAILED", "UNKNOWN"].includes(record.state)) return failure(record, event, "REASSIGN_NOT_SAFE", record.state);
      const next = clone(record);
      next.state = "REASSIGN_REVIEW";
      next.blocked_reason = "MANUAL_REASSIGN_REVIEW_REQUIRED";
      return success(record, event, next);
    }
    case "RETRY_REQUESTED": {
      if (record.lease_active || !["OVERDUE", "BLOCKED", "FAILED", "REASSIGN_REVIEW", "UNKNOWN"].includes(record.state)) return failure(record, event, "RETRY_NOT_SAFE", record.state);
      if (record.provider_run_id && text(event.retry_of_provider_run_id) !== record.provider_run_id) return failure(record, event, "RETRY_SOURCE_RUN_MISMATCH", "BLOCKED");
      const next = clone(record);
      if (record.provider_run_id) next.run_history.push({provider_run_id: record.provider_run_id, state: record.state, attempt: record.attempt});
      next.provider_run_id = null;
      next.provider_run_id_source = null;
      next.provider_acknowledged = false;
      next.provider_event_status = null;
      next.checkpoint_ref = null;
      next.checkpoint_observed_at = null;
      next.state = "ACK_PENDING";
      next.attempt += 1;
      next.blocked_reason = null;
      next.error = null;
      return success(record, event, next);
    }
    case "CTO_REVIEW": {
      if (!TERMINAL_STATES.has(record.state) || !exactSha(event.github_sha) || !text(event.github_pr) || !text(event.github_ci)) return failure(record, event, "REVIEW_EVIDENCE_INCOMPLETE", "BLOCKED");
      const next = clone(record);
      next.state = "REVIEW";
      next.github_pr = text(event.github_pr);
      next.github_sha = text(event.github_sha).toLowerCase();
      next.github_ci = text(event.github_ci);
      return success(record, event, next);
    }
    case "PM_ACCEPT": {
      if (record.state !== "REVIEW" || !text(event.acceptance_ref)) return failure(record, event, "PM_ACCEPTANCE_EVIDENCE_MISSING", record.state);
      const next = clone(record);
      next.state = "PM_ACCEPTED";
      next.acceptance_ref = text(event.acceptance_ref);
      next.lease_active = false;
      return success(record, event, next);
    }
    default:
      return failure(record, event, "EVENT_TYPE_UNSUPPORTED");
  }
}

export function recoverDurableDispatchAfterRestart(snapshot, now = Date.now()) {
  const record = hydrateDurableDispatchRecord(snapshot);
  const expiry = timeValue(record.lease_expires_at);
  if (record.lease_active && expiry !== null && expiry <= now && ACTIVE_STATES.has(record.state)) {
    return applyDurableDispatchEvent(record, {
      event_id: `recovery:lease-expired:${record.version}`,
      type: "LEASE_EXPIRED",
      observed_at: new Date(now).toISOString(),
      fencing_token: record.fencing_token,
      expected_version: record.version
    }, now);
  }
  return {accepted: true, state: record.state, reason: "NO_RECOVERY_REQUIRED", record};
}

export function buildResumeDecision(snapshot, {providerAck = false, checkpointEvidence = false, stopEvidence = false} = {}) {
  const record = hydrateDurableDispatchRecord(snapshot);
  if (record.state !== "REASSIGN_REVIEW") return {ok: false, state: "BLOCKED", reason: "REASSIGN_REVIEW_REQUIRED"};
  if (!providerAck || !record.provider_run_id) return {ok: false, state: "BLOCKED", reason: "PROVIDER_ACK_REQUIRED"};
  if (!checkpointEvidence || !record.checkpoint_ref) return {ok: false, state: "BLOCKED", reason: "CHECKPOINT_REQUIRED"};
  if (!stopEvidence) return {ok: false, state: "BLOCKED", reason: "STOP_EVIDENCE_REQUIRED"};
  return {ok: true, state: "REASSIGN_REVIEW", reason: "RESUME_REQUIRES_CTO_DECISION"};
}

export function durableRecordFromIntent(input, options) {
  return createDurableDispatchRecord(createDispatchIntent(input, options?.createdAt), options);
}
