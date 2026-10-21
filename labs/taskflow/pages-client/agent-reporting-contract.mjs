/**
 * TaskFlow-owned boundary for autonomous Agent -> native Issue reporting.
 *
 * This module only accepts evidence from an authenticated Provider transport.
 * GitHub comments, UI metadata and HTTP delivery success are never Provider
 * ACK evidence. Native writes must be committed by an injected transaction
 * adapter so this contract cannot silently create a second task store.
 */
export const AGENT_REPORTING_SCHEMA = "zhuge-taskflow-agent-reporting-v1";

export const AGENT_REPORT_EVENT_TYPES = Object.freeze([
  "accepted",
  "progress",
  "question_to_cto",
  "blocked",
  "checkpoint",
  "interrupted_by_pm",
  "review_requested",
  "completed"
]);

export const AGENT_REPORT_NATIVE_STATUS = Object.freeze({
  accepted: "in_progress",
  progress: "in_progress",
  question_to_cto: "in_review",
  blocked: "blocked",
  checkpoint: "in_progress",
  interrupted_by_pm: "blocked",
  review_requested: "in_review",
  completed: "done"
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
  return {
    accepted: false,
    state: reason === "EVENT_REPLAY" ? "UNKNOWN" : "BLOCKED",
    reason,
    event_id: text(event?.event_id) || null,
    ...extra
  };
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

/**
 * Validate a Provider report against the currently fenced native assignment.
 * `context` must come from the server-side TaskFlow read model, never from
 * the incoming event. A successful result is evidence-ready, not a claim
 * that the native mutation has committed.
 */
export function validateAgentReportEvent(input, context = {}, now = Date.now()) {
  const event = input && typeof input === "object" ? input : {};
  const type = text(event.type).toLowerCase();
  const eventId = text(event.event_id);
  const issueId = text(event.issue_id);
  const workspaceId = text(event.workspace_id || event.workspace);
  const executorId = text(event.executor_id);
  const provider = text(event.provider);
  const runId = text(event.provider_run_id);
  const sessionId = text(event.session_id);
  const observedAt = timeValue(event.observed_at);

  if (!AGENT_REPORT_EVENT_TYPES.includes(type)) return reject("EVENT_TYPE_UNSUPPORTED", event);
  if (!eventId || !issueId || !workspaceId || !executorId || !provider || !runId || !sessionId || observedAt === null) {
    return reject("EVENT_IDENTITY_INCOMPLETE", event);
  }
  if (!VERIFIED_PROVIDER_SOURCES.has(text(event.source))) return reject("PROVIDER_SOURCE_UNVERIFIED", event);
  if (event.signature_verified !== true) return reject("PROVIDER_SIGNATURE_UNVERIFIED", event);
  if (context.authorization !== "AUTHORIZED") return reject("CTO_AUTHORIZATION_UNVERIFIED", event);
  if (text(context.issue_id) !== issueId || text(context.workspace_id) !== workspaceId) return reject("TASKFLOW_SCOPE_MISMATCH", event);
  if (text(context.executor_id) !== executorId || text(context.provider) !== provider) return reject("CURRENT_OWNER_MISMATCH", event);
  if (text(context.provider_run_id) !== runId || text(context.session_id) !== sessionId) return reject("RUN_SESSION_MISMATCH", event);
  if (text(context.fencing_token) !== text(event.fencing_token)) return reject("FENCING_TOKEN_MISMATCH", event);
  const leaseExpiresAt = timeValue(context.lease_expires_at);
  if (context.lease_active !== true || leaseExpiresAt === null || leaseExpiresAt <= now) return reject("LEASE_EXPIRED", event);
  if (Array.isArray(context.seen_event_ids) && context.seen_event_ids.includes(eventId)) return reject("EVENT_REPLAY", event);
  if (observedAt > now + 5 * 60 * 1000 || now - observedAt > 24 * 60 * 60 * 1000) return reject("EVENT_TIME_INVALID", event);
  const payloadReason = requiredPayloadReason(type, event);
  if (payloadReason) return reject(payloadReason, event);

  return {
    accepted: true,
    state: type === "completed" ? "DONE" : type === "review_requested" || type === "question_to_cto" ? "REVIEW" : type === "blocked" || type === "interrupted_by_pm" ? "BLOCKED" : "RUNNING",
    native_status: AGENT_REPORT_NATIVE_STATUS[type],
    schema: AGENT_REPORTING_SCHEMA,
    event: {
      event_id: eventId,
      type,
      issue_id: issueId,
      workspace_id: workspaceId,
      executor_id: executorId,
      provider,
      provider_run_id: runId,
      session_id: sessionId,
      observed_at: new Date(observedAt).toISOString(),
      source: text(event.source),
      fencing_token: text(event.fencing_token),
      progress_percent: Number.isInteger(event.progress_percent) ? event.progress_percent : null,
      progress_summary: text(event.progress_summary),
      question: text(event.question),
      blocked_reason: text(event.blocked_reason),
      checkpoint_ref: text(event.checkpoint_ref),
      stop_evidence: text(event.stop_evidence),
      review_evidence: text(event.review_evidence),
      completion_evidence: text(event.completion_evidence),
      next_step: text(event.next_step)
    }
  };
}

/** Build the only native Issue mutation permitted after validation. */
export function buildNativeAgentReportMutation(validation) {
  if (!validation?.accepted || !validation.event) throw new Error("validated Agent report required");
  const event = validation.event;
  const audit = {
    schema: AGENT_REPORTING_SCHEMA,
    event_id: event.event_id,
    type: event.type,
    issue_id: event.issue_id,
    workspace_id: event.workspace_id,
    executor_id: event.executor_id,
    provider: event.provider,
    provider_run_id: event.provider_run_id,
    session_id: event.session_id,
    observed_at: event.observed_at,
    source: event.source,
    state: validation.state,
    next_step: event.next_step || null
  };
  return {
    issue_id: event.issue_id,
    workspace_id: event.workspace_id,
    issue_update: {status: validation.native_status},
    comment: {
      type: "comment",
      content: `[Zhuge Agent Report]\n\n\`\`\`json\n${JSON.stringify(audit)}\n\`\`\``
    },
    audit
  };
}

/**
 * Native writes are deliberately transactional and injected. A caller that
 * only has separate comment/status calls must remain BLOCKED rather than
 * claiming an event was recorded after a partial write.
 */
export async function commitNativeAgentReport(validation, nativeAdapter) {
  if (!validation?.accepted) return validation || reject("VALIDATION_REQUIRED");
  if (!nativeAdapter || typeof nativeAdapter.applyAgentReportMutation !== "function") {
    return {accepted: false, state: "BLOCKED", reason: "NATIVE_MUTATION_ADAPTER_UNWIRED", mutation: buildNativeAgentReportMutation(validation)};
  }
  const mutation = buildNativeAgentReportMutation(validation);
  const result = await nativeAdapter.applyAgentReportMutation(mutation);
  if (result?.committed !== true) return {accepted: false, state: "BLOCKED", reason: "NATIVE_MUTATION_NOT_COMMITTED", mutation, result};
  return {accepted: true, state: validation.state, reason: "NATIVE_REPORT_COMMITTED", mutation, result};
}

/** A transfer needs explicit stop evidence and a new fencing epoch. */
export function validateAgentHandoff(input, context = {}) {
  const event = input && typeof input === "object" ? input : {};
  if (!text(event.issue_id) || text(event.issue_id) !== text(context.issue_id)) return reject("TASKFLOW_SCOPE_MISMATCH", event);
  if (!text(event.stop_evidence)) return reject("STOP_EVIDENCE_MISSING", event);
  if (context.lease_active === true) return reject("CURRENT_LEASE_STILL_ACTIVE", event);
  if (!text(event.next_executor_id) || !text(event.next_provider)) return reject("NEXT_OWNER_INCOMPLETE", event);
  if (!Number.isInteger(event.next_fencing_epoch) || event.next_fencing_epoch <= Number(context.fencing_epoch || 0)) return reject("FENCING_EPOCH_NOT_MONOTONIC", event);
  return {accepted: true, state: "REASSIGN_REVIEW", reason: "STOP_VERIFIED_CTO_REVIEW_REQUIRED", issue_id: text(event.issue_id), next_executor_id: text(event.next_executor_id), next_provider: text(event.next_provider), next_fencing_epoch: event.next_fencing_epoch};
}
