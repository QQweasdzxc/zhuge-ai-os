/**
 * TaskFlow-owned boundary for autonomous Agent -> native Issue reporting.
 *
 * Provider attestation, runtime readback and atomic event claiming are server
 * contracts. They are supplied as `context` and never inferred from Agent
 * event fields. This module cannot create a second task store or claim that
 * an unwired native mutation committed.
 */
export const AGENT_REPORTING_SCHEMA = "zhuge-taskflow-agent-reporting-v2";
export const AGENT_REPORT_EVENT_TYPES = Object.freeze([
  "accepted", "progress", "question_to_cto", "blocked", "checkpoint",
  "interrupted_by_pm", "review_requested", "completed"
]);
export const AGENT_REPORTING_CORRELATION_FIELDS = Object.freeze([
  "taskflow_issue_id", "current_executor", "dispatch_id", "provider_run_id", "session_id",
  "ack_event_id", "event_id", "lease_id", "fencing_epoch", "stop_handoff_evidence"
]);

// Agent completion requests CTO review. Only the independent CTO review
// operation may produce the native `done` status.
export const AGENT_REPORT_NATIVE_STATUS = Object.freeze({
  accepted: "in_progress", progress: "in_progress", question_to_cto: "blocked",
  blocked: "blocked", checkpoint: "in_progress", interrupted_by_pm: "blocked",
  review_requested: "in_review", completed: "in_review"
});

const VERIFIED_PROVIDER_SOURCES = new Set(["codex_cloud", "gemini_cloud", "github_helper"]);
const text = value => typeof value === "string" ? value.trim() : "";

function timeValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function reject(reason, event = null, extra = {}) {
  return {accepted: false, state: reason === "EVENT_REPLAY" ? "UNKNOWN" : "BLOCKED", reason, event_id: text(event?.event_id) || null, ...extra};
}

function requiredPayloadReason(type, event) {
  if (type === "progress" && !Number.isInteger(event.progress_percent) && !text(event.progress_summary)) return "PROGRESS_EVIDENCE_MISSING";
  if (type === "question_to_cto" && !text(event.question)) return "QUESTION_MISSING";
  if (type === "blocked" && !text(event.blocked_reason)) return "BLOCKED_REASON_MISSING";
  if (type === "checkpoint" && !text(event.checkpoint_ref)) return "CHECKPOINT_REF_MISSING";
  if (type === "interrupted_by_pm" && !text(event.stop_evidence)) return "STOP_EVIDENCE_MISSING";
  if (type === "review_requested" && !text(event.review_evidence)) return "REVIEW_EVIDENCE_MISSING";
  if (type === "completed" && !text(event.completion_evidence)) return "COMPLETION_EVIDENCE_MISSING";
  if (Number.isInteger(event.progress_percent) && (event.progress_percent < 0 || event.progress_percent > 100)) return "PROGRESS_OUT_OF_RANGE";
  return "";
}

function trustedProviderAttestation(context, event) {
  const attestation = context.provider_attestation;
  if (!attestation || attestation.verified !== true || attestation.source !== "SERVER_PROVIDER_VERIFIER") return "PROVIDER_ATTESTATION_UNVERIFIED";
  if (attestation.event_id !== text(event.event_id) || attestation.provider_run_id !== text(event.provider_run_id) || attestation.session_id !== text(event.session_id)) return "PROVIDER_ATTESTATION_MISMATCH";
  if (attestation.provider !== text(event.provider) || attestation.transport !== text(event.source)) return "PROVIDER_ATTESTATION_MISMATCH";
  return "";
}

function atomicEventGate(context, event) {
  const claim = context.atomic_event_claim;
  if (!claim || claim.status !== "CLAIMED" || claim.event_id !== text(event.event_id)) return "ATOMIC_EVENT_CLAIM_REQUIRED";
  if (!Number.isInteger(event.sequence) || !Number.isInteger(claim.sequence) || claim.sequence !== event.sequence) return "EVENT_SEQUENCE_UNVERIFIED";
  if (!Number.isInteger(context.last_event_sequence) || event.sequence <= context.last_event_sequence) return "EVENT_OUT_OF_ORDER";
  if (!Number.isInteger(event.fencing_epoch) || event.fencing_epoch !== context.fencing_epoch || claim.fencing_epoch !== event.fencing_epoch) return "FENCING_EPOCH_MISMATCH";
  return "";
}

/** Validate a Provider report against server-side TaskFlow read models. */
export function validateAgentReportEvent(input, context = {}, now = Date.now()) {
  const event = input && typeof input === "object" ? input : {};
  const type = text(event.type).toLowerCase();
  const eventId = text(event.event_id), issueId = text(event.issue_id), workspaceId = text(event.workspace_id || event.workspace), dispatchId = text(event.dispatch_id);
  const executorId = text(event.executor_id), provider = text(event.provider), runId = text(event.provider_run_id), sessionId = text(event.session_id);
  const observedAt = timeValue(event.observed_at);
  if (!AGENT_REPORT_EVENT_TYPES.includes(type)) return reject("EVENT_TYPE_UNSUPPORTED", event);
  if (!eventId || !issueId || !workspaceId || !dispatchId || !executorId || !provider || !runId || !sessionId || observedAt === null) return reject("EVENT_IDENTITY_INCOMPLETE", event);
  if (!VERIFIED_PROVIDER_SOURCES.has(text(event.source))) return reject("PROVIDER_SOURCE_UNVERIFIED", event);
  const attestationReason = trustedProviderAttestation(context, event);
  if (attestationReason) return reject(attestationReason, event);
  if (context.authorization !== "AUTHORIZED") return reject("CTO_AUTHORIZATION_UNVERIFIED", event);
  if (text(context.issue_id) !== issueId || text(context.workspace_id) !== workspaceId) return reject("TASKFLOW_SCOPE_MISMATCH", event);
  if (text(context.dispatch_id) !== dispatchId) return reject("DISPATCH_SCOPE_MISMATCH", event);
  if (text(context.executor_id) !== executorId || text(context.provider) !== provider) return reject("CURRENT_OWNER_MISMATCH", event);
  if (text(context.provider_run_id) !== runId || text(context.session_id) !== sessionId) return reject("RUN_SESSION_MISMATCH", event);
  if (text(context.fencing_token) !== text(event.fencing_token)) return reject("FENCING_TOKEN_MISMATCH", event);
  const leaseExpiresAt = timeValue(context.lease_expires_at);
  if (context.lease_active !== true || leaseExpiresAt === null || leaseExpiresAt <= now) return reject("LEASE_EXPIRED", event);
  if (context.native_status === "done") return reject("NATIVE_TASK_ALREADY_DONE", event);
  if (context.native_status === "in_review" && !["review_requested", "completed"].includes(type)) return reject("REVIEW_GATE_LOCKED", event);
  const atomicReason = atomicEventGate(context, event);
  if (atomicReason) return reject(atomicReason, event);
  if (observedAt > now + 5 * 60 * 1000 || now - observedAt > 24 * 60 * 60 * 1000) return reject("EVENT_TIME_INVALID", event);
  const payloadReason = requiredPayloadReason(type, event);
  if (payloadReason) return reject(payloadReason, event);
  return {
    accepted: true,
    state: type === "completed" || type === "review_requested" ? "REVIEW" : type === "question_to_cto" ? "WAITING_CTO_DECISION" : type === "blocked" || type === "interrupted_by_pm" ? "BLOCKED" : "RUNNING",
    native_status: AGENT_REPORT_NATIVE_STATUS[type], schema: AGENT_REPORTING_SCHEMA,
    expected_version: Number.isInteger(context.expected_version) ? context.expected_version : Number.isInteger(context.issue_revision) ? context.issue_revision : null,
    idempotency_key: text(context.idempotency_key), lease_id: text(context.lease_id),
    event: {
      event_id: eventId, sequence: event.sequence, fencing_epoch: event.fencing_epoch, type, issue_id: issueId, workspace_id: workspaceId,
      executor_id: executorId, dispatch_id: dispatchId, provider, provider_run_id: runId, session_id: sessionId, observed_at: new Date(observedAt).toISOString(),
      source: text(event.source), fencing_token: text(event.fencing_token), progress_percent: Number.isInteger(event.progress_percent) ? event.progress_percent : null,
      progress_summary: text(event.progress_summary), question: text(event.question), blocked_reason: text(event.blocked_reason), checkpoint_ref: text(event.checkpoint_ref),
      stop_evidence: text(event.stop_evidence), review_evidence: text(event.review_evidence), completion_evidence: text(event.completion_evidence), next_step: text(event.next_step)
    }
  };
}

function redact(value) {
  let result = text(value);
  for (const pattern of [
    /(bearer\s+)[^\s,;]+/gi,
    /(password\s*[=:]\s*)[^\s,;]+/gi,
    /(secret\s*[=:]\s*)[^\s,;]+/gi,
    /(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi,
    /(token\s*[=:]\s*)[^\s,;]+/gi,
    /(authorization\s*[=:]\s*)[^\s,;]+/gi
  ]) result = result.replace(pattern, "$1[REDACTED]");
  return result.slice(0, 2000);
}

function readableReport(event, state) {
  const labels = {accepted: "Agent 已接單並開始執行", progress: "Agent 工作進度", question_to_cto: "Agent 等待 CTO 回答", blocked: "Agent 回報工程卡關", checkpoint: "Agent 保存 Checkpoint", interrupted_by_pm: "PM 已中斷，Agent 已提交停止回報", review_requested: "Agent 申請 CTO 稽核", completed: "Agent 回報完成，等待 CTO 稽核"};
  const rows = [`## ${labels[event.type] || "Agent 回報"}`, `狀態：${state}`, `進度：${event.progress_percent === null ? "未提供" : `${event.progress_percent}%`}`, `摘要：${redact(event.progress_summary) || "未提供"}`];
  if (event.blocked_reason) rows.push(`卡關原因：${redact(event.blocked_reason)}`);
  if (event.question) rows.push(`需要 CTO 回答：${redact(event.question)}`);
  if (event.checkpoint_ref) rows.push(`Checkpoint：${redact(event.checkpoint_ref)}`);
  if (event.stop_evidence) rows.push(`停止證據參照：${redact(event.stop_evidence)}`);
  if (event.review_evidence) rows.push(`稽核證據：${redact(event.review_evidence)}`);
  if (event.completion_evidence) rows.push(`完成證據：${redact(event.completion_evidence)}`);
  rows.push(`下一步：${redact(event.next_step) || "未提供"}`);
  return rows.join("\n");
}

export function buildNativeAgentReportMutation(validation) {
  if (!validation?.accepted || !validation.event) throw new Error("validated Agent report required");
  const event = validation.event;
  const detailRefs = validation.protected_detail_refs && typeof validation.protected_detail_refs === "object" ? validation.protected_detail_refs : null;
  const audit = {schema: AGENT_REPORTING_SCHEMA, event_id: event.event_id, sequence: event.sequence, fencing_epoch: event.fencing_epoch, type: event.type, issue_id: event.issue_id, workspace_id: event.workspace_id, executor_id: event.executor_id, dispatch_id: event.dispatch_id, provider: event.provider, provider_run_id: event.provider_run_id, session_id: event.session_id, observed_at: event.observed_at, source: event.source, state: validation.state, detail_ref_mode: detailRefs ? "PROTECTED_STORE" : "UNWIRED_NO_REFERENCE", detail_refs: detailRefs};
  return {
    issue_id: event.issue_id, workspace_id: event.workspace_id,
    expected_version: Number.isInteger(validation.expected_version) ? validation.expected_version : null,
    atomic_event_claim: {event_id: event.event_id, sequence: event.sequence, fencing_epoch: event.fencing_epoch},
    issue_update: {status: validation.native_status, decision_scope: validation.state === "WAITING_CTO_DECISION" ? "CTO_QUESTION" : validation.state === "REVIEW" ? "CTO_REVIEW" : "AGENT_REPORT"},
    comment: {type: "comment", content: `${readableReport(event, validation.state)}\n\n---\n稽核識別：${JSON.stringify(audit)}`}, audit
  };
}

/** Only an independent, server-authorized CTO operation can close the Issue. */
export function authorizeCtoCompletion(input, context = {}) {
  const review = input && typeof input === "object" ? input : {};
  if (context.server_authority !== "CTO_ALLOWLIST_VERIFIED") return reject("CTO_AUTHORIZATION_UNVERIFIED", review);
  if (context.native_status !== "in_review") return reject("CTO_REVIEW_REQUIRED", review);
  if (text(context.issue_id) !== text(review.issue_id) || text(context.completion_event_id) !== text(review.completion_event_id)) return reject("REVIEW_SCOPE_MISMATCH", review);
  const principal = context.server_reviewer_principal;
  if (!principal || principal.verified !== true || principal.source !== "TASKFLOW_AUTHORITY" || principal.allowlisted !== true || principal.role !== "CTO") return reject("CTO_REVIEWER_IDENTITY_UNVERIFIED", review);
  if (text(principal.user_id) !== text(review.reviewer_user_id)) return reject("CTO_REVIEWER_IDENTITY_MISMATCH", review);
  if (text(principal.workspace_id) !== text(review.workspace_id || context.workspace_id) || text(context.workspace_id) !== text(review.workspace_id || context.workspace_id)) return reject("REVIEW_WORKSPACE_MISMATCH", review);
  if (!text(review.review_event_id) || !text(review.reviewer_user_id) || !text(review.reviewed_at) || !Number.isInteger(review.task_revision)) return reject("CTO_REVIEW_EVIDENCE_INCOMPLETE", review);
  if (!Number.isInteger(context.issue_revision) || context.issue_revision !== review.task_revision) return reject("REVIEW_REVISION_MISMATCH", review);
  const reviewedAt = timeValue(review.reviewed_at), now = timeValue(context.server_now) ?? Date.now();
  if (reviewedAt === null || reviewedAt > now + 5 * 60 * 1000 || now - reviewedAt > 24 * 60 * 60 * 1000) return reject("REVIEW_EXPIRED", review);
  const claim = context.atomic_event_claim;
  if (claim?.status !== "CLAIMED" || claim.event_id !== text(review.review_event_id) || claim.task_revision !== review.task_revision || claim.replayed === true) return reject("ATOMIC_REVIEW_CLAIM_REQUIRED", review);
  if (context.review_replay_claimed === true) return reject("REVIEW_EVENT_REPLAY", review);
  return {accepted: true, state: "CTO_REVIEW_AUTHORIZED", native_status: "done", reason: "CTO_COMPLETION_AUTHORIZED", review: {issue_id: text(review.issue_id), workspace_id: text(review.workspace_id || context.workspace_id), task_revision: review.task_revision, completion_event_id: text(review.completion_event_id), review_event_id: text(review.review_event_id), reviewer_user_id: text(review.reviewer_user_id), reviewed_at: text(review.reviewed_at)}};
}

export async function commitCtoCompletion(authorization, nativeAdapter) {
  if (!authorization?.accepted) return authorization || reject("CTO_REVIEW_REQUIRED");
  if (!nativeAdapter || typeof nativeAdapter.applyCtoCompletion !== "function") return reject("NATIVE_WRITE_UNWIRED", authorization.review);
  const result = await nativeAdapter.applyCtoCompletion({issue_id: authorization.review.issue_id, workspace_id: authorization.review.workspace_id, task_revision: authorization.review.task_revision, completion_event_id: authorization.review.completion_event_id, review_event_id: authorization.review.review_event_id, reviewer_user_id: authorization.review.reviewer_user_id, atomic: true});
  if (result?.committed !== true || result.status !== "done" || result.review_event_id !== authorization.review.review_event_id || result.atomic !== true) return reject("NATIVE_COMPLETION_NOT_ATOMIC", authorization.review);
  return {accepted: true, state: "DONE", native_status: "done", reason: "CTO_COMPLETION_COMMITTED", result};
}

export async function attachProtectedDetailRefs(validation, detailStore, scope) {
  if (!validation?.accepted || !validation.event) return validation || reject("VALIDATION_REQUIRED");
  if (!detailStore || typeof detailStore.putDetail !== "function") return {...validation, protected_detail_refs: null, detail_store_state: "DETAIL_STORE_UNWIRED"};
  const event = validation.event;
  const values = Object.entries({progress_summary: event.progress_summary, question: event.question, blocked_reason: event.blocked_reason, checkpoint_ref: event.checkpoint_ref, stop_evidence: event.stop_evidence, review_evidence: event.review_evidence, completion_evidence: event.completion_evidence, next_step: event.next_step}).filter(([, value]) => value);
  const refs = {};
  for (const [label, value] of values) {
    const stored = await detailStore.putDetail({scope: {...scope, event_id: event.event_id, issue_id: event.issue_id, workspace_id: event.workspace_id, executor_id: event.executor_id}, label, value});
    if (!stored?.accepted || !text(stored.protected_ref)) return {...validation, protected_detail_refs: null, detail_store_state: stored?.reason || "DETAIL_STORE_WRITE_UNVERIFIED"};
    refs[label] = stored.protected_ref;
  }
  return {...validation, protected_detail_refs: refs, detail_store_state: "PROTECTED_STORE"};
}

export const NATIVE_AGENT_ATOMIC_WRITE_ADAPTER_VERSION = "1.0";
export const NATIVE_AGENT_ATOMIC_WRITE_CONTRACT = Object.freeze({
  version: NATIVE_AGENT_ATOMIC_WRITE_ADAPTER_VERSION,
  authority: "existing_taskflow_native_issue_and_agent_task_queue",
  operations: ["applyAgentReportMutation", "applyCtoCompletion"],
  requirements: ["same_transaction", "issue_row_for_update", "task_row_for_update", "idempotency_key", "expected_version", "fencing_epoch", "audit_log"],
  fail_closed_reasons: ["NATIVE_WRITE_UNWIRED", "NATIVE_TRANSACTION_INTERFACE_INVALID", "PERSISTED_VERSION_CONFLICT", "NATIVE_COMPLETION_NOT_ATOMIC"],
  forbidden: ["second_task_database", "client_authorization", "provider_run_synthesis", "hash_placeholder_as_secure_storage"]
});

/**
 * Integration seam for CO-01's native TaskFlow authority. The concrete SQL
 * adapter remains injected; this wrapper never creates a database or claims a
 * commit without the existing row-lock transaction result.
 */
export function createNativeAgentAtomicWriteAdapter({nativePersistenceAdapter, issueId, taskId = "", idempotencyKey, expectedVersion, fencingToken = ""} = {}) {
  const configured = nativePersistenceAdapter && typeof nativePersistenceAdapter.runAtomicMutation === "function" && text(issueId) && text(idempotencyKey) && Number.isInteger(expectedVersion);
  const blockedResult = reason => ({accepted: false, committed: false, state: "BLOCKED", reason, contract: NATIVE_AGENT_ATOMIC_WRITE_CONTRACT});
  if (!configured) return Object.freeze({version: NATIVE_AGENT_ATOMIC_WRITE_ADAPTER_VERSION, configured: false, contract: NATIVE_AGENT_ATOMIC_WRITE_CONTRACT, applyAgentReportMutation: async () => blockedResult("NATIVE_WRITE_UNWIRED"), applyCtoCompletion: async () => blockedResult("NATIVE_WRITE_UNWIRED")});
  const run = (event, mutate) => nativePersistenceAdapter.runAtomicMutation({issueId, taskId, idempotencyKey, event: {...event, expected_version: expectedVersion, fencing_token: fencingToken}, mutate});
  return Object.freeze({
    version: NATIVE_AGENT_ATOMIC_WRITE_ADAPTER_VERSION, configured: true, contract: NATIVE_AGENT_ATOMIC_WRITE_CONTRACT,
    applyAgentReportMutation: mutation => run({event_id: mutation.atomic_event_claim.event_id, type: mutation.issue_update?.status || "AGENT_REPORT", expected_version: mutation.expected_version}, (current, event) => ({record: {...current, version: current.version + 1, status: mutation.issue_update?.status || current.status, audit_log: [...(current.audit_log || []), {event_id: event.event_id, type: event.type}]}, reason: "AGENT_REPORT_COMMITTED"})).then(result => ({...result, event_id: mutation.atomic_event_claim.event_id, atomic_event_claimed: result.committed === true})),
    applyCtoCompletion: completion => run({event_id: completion.review_event_id, type: "CTO_COMPLETION", expected_version: expectedVersion}, (current, event) => ({record: {...current, version: current.version + 1, status: "done", audit_log: [...(current.audit_log || []), {event_id: event.event_id, type: event.type}]}, reason: "CTO_COMPLETION_COMMITTED"})).then(result => ({...result, status: result.committed ? "done" : "BLOCKED", review_event_id: completion.review_event_id, atomic: result.committed === true}))
  });
}

export async function commitNativeAgentReport(validation, nativeAdapter) {
  if (!validation?.accepted) return validation || reject("VALIDATION_REQUIRED");
  if (!nativeAdapter || typeof nativeAdapter.applyAgentReportMutation !== "function") return {accepted: false, state: "BLOCKED", reason: "NATIVE_MUTATION_ADAPTER_UNWIRED", mutation: buildNativeAgentReportMutation(validation)};
  const mutation = buildNativeAgentReportMutation(validation);
  const result = await nativeAdapter.applyAgentReportMutation(mutation);
  if (result?.committed !== true || result.event_id !== mutation.atomic_event_claim.event_id || result.atomic_event_claimed !== true) return {accepted: false, state: "BLOCKED", reason: "NATIVE_MUTATION_NOT_ATOMIC", mutation, result};
  return {accepted: true, state: validation.state, reason: "NATIVE_REPORT_COMMITTED", mutation, result};
}

export function validateAgentHandoff(input, context = {}) {
  const event = input && typeof input === "object" ? input : {};
  const readback = context.server_runtime_readback;
  const stop = context.stop_attestation;
  if (!text(event.issue_id) || text(event.issue_id) !== text(context.issue_id)) return reject("TASKFLOW_SCOPE_MISMATCH", event);
  if (!readback || readback.source !== "TASKFLOW_RUNTIME_READ_MODEL" || readback.issue_id !== text(event.issue_id) || readback.lease_active !== false) return reject("STOP_READBACK_UNVERIFIED", event);
  if (!stop || stop.verified !== true || stop.source !== "SERVER_PROVIDER_VERIFIER" || stop.issue_id !== text(event.issue_id) || stop.provider_run_id !== text(context.provider_run_id)) return reject("STOP_ATTESTATION_UNVERIFIED", event);
  if (!text(event.next_executor_id) || !text(event.next_provider)) return reject("NEXT_OWNER_INCOMPLETE", event);
  if (!Number.isInteger(event.next_fencing_epoch) || event.next_fencing_epoch <= Number(readback.fencing_epoch || 0)) return reject("FENCING_EPOCH_NOT_MONOTONIC", event);
  return {accepted: true, state: "REASSIGN_REVIEW", reason: "STOP_VERIFIED_CTO_REVIEW_REQUIRED", issue_id: text(event.issue_id), next_executor_id: text(event.next_executor_id), next_provider: text(event.next_provider), next_fencing_epoch: event.next_fencing_epoch};
}
