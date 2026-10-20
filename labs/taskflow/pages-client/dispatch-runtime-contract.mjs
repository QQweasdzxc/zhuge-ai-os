export const DISPATCH_RUNTIME_STATES = Object.freeze([
  "INTENT_CREATED", "ASSIGNED", "ACK_PENDING", "RUNNING", "OVERDUE",
  "BLOCKED", "CANCELLED", "FAILED", "REASSIGN_REVIEW", "REVIEW", "DONE", "UNKNOWN"
]);

export const PROVIDER_CAPABILITIES = Object.freeze({
  codex: Object.freeze({dispatch: "UNVERIFIED", ack: "UNVERIFIED", checkpoint: "UNVERIFIED", quota: "UNVERIFIED"}),
  gemini: Object.freeze({dispatch: "UNVERIFIED", ack: "UNVERIFIED", checkpoint: "UNVERIFIED", quota: "UNVERIFIED"}),
  github: Object.freeze({dispatch: "UNSUPPORTED", ack: "UNSUPPORTED", checkpoint: "UNSUPPORTED", quota: "UNVERIFIED"})
});

function text(value) { return typeof value === "string" ? value.trim() : ""; }

export function dispatchIntentKey({workCode, issueId, executorId, scope, idempotencyKey}) {
  const explicit = text(idempotencyKey);
  if (explicit) return explicit;
  return [text(workCode), text(issueId), text(executorId), text(scope)].join("|");
}

export function createDispatchIntent(input, now = new Date().toISOString()) {
  const intent = {
    intent_id: text(input.intentId),
    idempotency_key: dispatchIntentKey(input),
    issuer_user_id: text(input.issuerUserId),
    issuer_authorization: text(input.issuerAuthorization) || "UNVERIFIED",
    workspace: text(input.workspace),
    scope: text(input.scope),
    work_code: text(input.workCode),
    issue_id: text(input.issueId),
    executor_id: text(input.executorId),
    provider: text(input.provider),
    task_id: text(input.taskId),
    provider_run_id: text(input.providerRunId),
    state: "INTENT_CREATED",
    observed_at: now,
    audit_source: "taskflow_native"
  };
  if (!intent.intent_id || !intent.issuer_user_id || !intent.workspace || !intent.work_code || !intent.issue_id) {
    throw new Error("dispatch intent missing required identity or scope");
  }
  return intent;
}

export function acquireWriterLease(intent, {writerId, fencingToken, expiresAt}, now = Date.now()) {
  if (intent.issuer_authorization !== "AUTHORIZED") return {ok:false, state:"BLOCKED", reason:"CTO_AUTHORIZATION_UNVERIFIED"};
  if (!text(writerId) || !text(fencingToken) || !Number.isFinite(expiresAt) || expiresAt <= now) return {ok:false, state:"BLOCKED", reason:"LEASE_INVALID"};
  return {ok:true, state:"ASSIGNED", writer_id:text(writerId), fencing_token:text(fencingToken), expires_at:expiresAt};
}

export function acceptProviderEvent(event, lease, now = Date.now()) {
  if (!lease?.ok) return {accepted:false, state:"BLOCKED", reason:"NO_ACTIVE_LEASE"};
  if (lease.expires_at <= now) return {accepted:false, state:"OVERDUE", reason:"LEASE_EXPIRED"};
  if (text(event?.fencing_token) !== lease.fencing_token) return {accepted:false, state:"BLOCKED", reason:"FENCING_TOKEN_MISMATCH"};
  if (!text(event?.provider_run_id)) return {accepted:false, state:"UNKNOWN", reason:"PROVIDER_RUN_ID_MISSING"};
  const mapped = {queued:"ACK_PENDING", acknowledged:"ACK_PENDING",running:"RUNNING",completed:"DONE",failed:"FAILED",cancelled:"CANCELLED"};
  return {accepted:true, state:mapped[text(event.status).toLowerCase()] || "UNKNOWN", provider_run_id:text(event.provider_run_id), observed_at:now};
}

export function resolveDuplicateIntent(existing, incoming) {
  if (!existing) return {action:"CREATE"};
  if (existing.idempotency_key !== incoming.idempotency_key) return {action:"CONFLICT", reason:"IDEMPOTENCY_KEY_MISMATCH"};
  if (existing.provider_run_id && incoming.provider_run_id && existing.provider_run_id !== incoming.provider_run_id) return {action:"BLOCK", reason:"MULTIPLE_PROVIDER_RUNS"};
  return {action:"REUSE", issue_id:existing.issue_id, task_id:existing.task_id || "", provider_run_id:existing.provider_run_id || ""};
}
