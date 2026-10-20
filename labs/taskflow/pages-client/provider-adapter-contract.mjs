export const PROVIDER_ADAPTER_CONTRACT_VERSION = "1.0";
export const PROVIDER_CALLBACK_SECURITY_CONTRACT_VERSION = "1.0";

export const PROVIDER_GATE_STATES = Object.freeze([
  "VERIFIED", "UNVERIFIED", "UNSUPPORTED", "BLOCKED"
]);

export const PHASE2_PROVIDER_CAPABILITY_MATRIX = Object.freeze({
  codex: Object.freeze({
    display_name: "Codex Cloud",
    dispatch: "UNVERIFIED",
    ack: "UNVERIFIED",
    run_lookup: "UNVERIFIED",
    heartbeat: "UNVERIFIED",
    checkpoint: "UNVERIFIED",
    reassign: "UNVERIFIED",
    quota: "UNVERIFIED",
    callback_signature: "UNVERIFIED",
    resume: "UNVERIFIED",
    evidence_source: "No approved official runtime binding, credential, callback signature or provider readback is configured in this Review environment."
  }),
  gemini: Object.freeze({
    display_name: "Gemini",
    dispatch: "UNVERIFIED",
    ack: "UNVERIFIED",
    run_lookup: "UNVERIFIED",
    heartbeat: "UNVERIFIED",
    checkpoint: "UNVERIFIED",
    reassign: "UNVERIFIED",
    quota: "UNVERIFIED",
    callback_signature: "UNVERIFIED",
    resume: "UNVERIFIED",
    evidence_source: "No approved official runtime binding, credential, callback signature or provider readback is configured in this Review environment."
  }),
  github: Object.freeze({
    display_name: "GH Helper",
    dispatch: "UNSUPPORTED",
    ack: "UNSUPPORTED",
    run_lookup: "UNSUPPORTED",
    heartbeat: "UNSUPPORTED",
    checkpoint: "UNSUPPORTED",
    reassign: "UNSUPPORTED",
    quota: "UNVERIFIED",
    callback_signature: "UNSUPPORTED",
    resume: "UNSUPPORTED",
    evidence_source: "TaskFlow's native GitHub mirror can read PR/SHA/CI evidence; GitHub comments and PR events do not launch an Agent or create a Provider Run."
  })
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function capability(provider, capabilities) {
  return capabilities?.[text(provider)] || null;
}

function blocked(reason, detail = "") {
  return {ok: false, state: "BLOCKED", reason, detail, provider_run_id: null};
}

const CALLBACK_STATUSES = new Set(["queued", "acknowledged", "running", "completed", "failed", "cancelled"]);

function callbackTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedBindingValue(expected, key) {
  return text(expected?.[key]);
}

function seenEvent(seenEventIds, eventId) {
  if (seenEventIds instanceof Set) return seenEventIds.has(eventId);
  return Array.isArray(seenEventIds) && seenEventIds.includes(eventId);
}

export function getProviderCapability(provider, capabilities = PHASE2_PROVIDER_CAPABILITY_MATRIX) {
  const result = capability(provider, capabilities);
  return result ? clone(result) : null;
}

export function buildProviderDispatchRequest(input, {capabilities = PHASE2_PROVIDER_CAPABILITY_MATRIX, credentialStatus = "MISSING", providerBindingId = "", paidProviderAuthorization = false} = {}) {
  const provider = text(input?.provider);
  const cap = capability(provider, capabilities);
  if (!cap) return blocked("PROVIDER_UNKNOWN");
  if (text(input?.authority_result) !== "AUTHORIZED") return blocked("CTO_AUTHORIZATION_UNVERIFIED");
  if (!text(input?.workspace) || !text(input?.issue_id) || !text(input?.task_id) || !text(input?.idempotency_key)) return blocked("NATIVE_TASK_IDENTITY_MISSING");
  if (cap.dispatch !== "VERIFIED") return blocked(cap.dispatch === "UNSUPPORTED" ? "PROVIDER_DISPATCH_UNSUPPORTED" : "PROVIDER_CAPABILITY_UNVERIFIED", cap.evidence_source);
  if (credentialStatus !== "CONFIGURED") return blocked("PROVIDER_CREDENTIAL_UNVERIFIED");
  if (!text(providerBindingId)) return blocked("PROVIDER_BINDING_MISSING");
  if (!paidProviderAuthorization) return blocked("PAID_PROVIDER_GATE_UNVERIFIED");
  return {
    ok: true,
    state: "DISPATCH_REQUEST_READY",
    provider,
    request: {
      workspace: text(input.workspace),
      issue_id: text(input.issue_id),
      task_id: text(input.task_id),
      executor_id: text(input.executor_id),
      work_code: text(input.work_code),
      idempotency_key: text(input.idempotency_key),
      provider_binding_id: text(providerBindingId)
    },
    provider_run_id: null,
    evidence: "No network call is made by this pure adapter contract. Provider Run ID can only be accepted from a verified provider response."
  };
}

export function normalizeProviderEvent(input, {capabilities = PHASE2_PROVIDER_CAPABILITY_MATRIX} = {}) {
  const provider = text(input?.provider);
  const cap = capability(provider, capabilities);
  if (!cap) return blocked("PROVIDER_UNKNOWN");
  if (cap.ack !== "VERIFIED" || cap.run_lookup !== "VERIFIED") return blocked("PROVIDER_RUNTIME_UNVERIFIED", cap.evidence_source);
  if (input?.signature_verified !== true) return blocked("PROVIDER_SIGNATURE_UNVERIFIED");
  if (!text(input?.event_id) || !text(input?.provider_run_id) || !text(input?.status) || !text(input?.observed_at)) return blocked("PROVIDER_EVENT_EVIDENCE_INCOMPLETE");
  return {
    ok: true,
    state: "VERIFIED",
    provider,
    evidence: {
      event_id: text(input.event_id),
      provider_run_id: text(input.provider_run_id),
      status: text(input.status).toLowerCase(),
      observed_at: text(input.observed_at),
      source: "official_provider_callback",
      signature_verified: true
    }
  };
}

/**
 * Validate the security boundary immediately before a provider callback is
 * allowed to mutate a native TaskFlow record. This is intentionally a pure
 * gate: it does not call a provider, mint a Run ID, or write a database row.
 * The caller must provide the persisted dispatch binding and previously seen
 * event IDs from the native transaction.
 */
export function buildProviderCallbackAcceptanceDecision(input, {
  capabilities = PHASE2_PROVIDER_CAPABILITY_MATRIX,
  expected = {},
  seenEventIds = [],
  now = Date.now()
} = {}) {
  const provider = text(input?.provider);
  const cap = capability(provider, capabilities);
  if (!cap) return blocked("PROVIDER_UNKNOWN");
  if (cap.callback_signature !== "VERIFIED") {
    return blocked("PROVIDER_CALLBACK_UNVERIFIED", cap.evidence_source);
  }
  if (cap.ack !== "VERIFIED" || cap.run_lookup !== "VERIFIED") {
    return blocked("PROVIDER_RUNTIME_UNVERIFIED", cap.evidence_source);
  }
  if (expectedBindingValue(expected, "authority_result") !== "AUTHORIZED") {
    return blocked("CTO_AUTHORIZATION_UNVERIFIED");
  }
  if (expectedBindingValue(expected, "provider") !== provider) {
    return blocked("PROVIDER_BINDING_MISMATCH");
  }

  for (const key of ["workspace", "issue_id", "task_id", "idempotency_key"]) {
    const expectedValue = expectedBindingValue(expected, key);
    const actualValue = text(input?.[key]);
    if (!expectedValue || !actualValue) return blocked("PROVIDER_CALLBACK_BINDING_INCOMPLETE");
    if (actualValue !== expectedValue) return blocked(`PROVIDER_CALLBACK_${key.toUpperCase()}_MISMATCH`);
  }

  const eventId = text(input?.event_id);
  const runId = text(input?.provider_run_id);
  const status = text(input?.status).toLowerCase();
  const observedAt = text(input?.observed_at);
  if (!eventId || !runId || !status || !observedAt) return blocked("PROVIDER_EVENT_EVIDENCE_INCOMPLETE");
  if (seenEvent(seenEventIds, eventId)) return blocked("EVENT_REPLAY");
  if (input?.signature_verified !== true) return blocked("PROVIDER_SIGNATURE_UNVERIFIED");
  if (!CALLBACK_STATUSES.has(status)) return blocked("PROVIDER_STATUS_UNSUPPORTED");
  const observedTime = callbackTime(observedAt);
  if (observedTime === null || observedTime > now + 5 * 60 * 1000) return blocked("PROVIDER_EVENT_TIME_INVALID");
  if (runId === expectedBindingValue(expected, "task_id")) return blocked("PROVIDER_RUN_TASK_ID_COLLISION");

  const eventType = text(input?.event_type || input?.type || "PROVIDER_EVENT").toUpperCase();
  if (eventType === "HEARTBEAT" && cap.heartbeat !== "VERIFIED") return blocked("PROVIDER_HEARTBEAT_UNVERIFIED");
  if (eventType === "CHECKPOINT") {
    if (cap.checkpoint !== "VERIFIED") return blocked("PROVIDER_CHECKPOINT_UNVERIFIED");
    if (!text(input?.checkpoint_ref)) return blocked("CHECKPOINT_REF_MISSING");
  }
  if (eventType === "RESUME" && cap.resume !== "VERIFIED") return blocked("PROVIDER_RESUME_UNVERIFIED");
  if (eventType === "PROVIDER_QUOTA_EXHAUSTED" && cap.quota !== "VERIFIED") return blocked("PROVIDER_QUOTA_UNVERIFIED");
  if (expectedBindingValue(expected, "callback_nonce") && text(input?.callback_nonce) !== expectedBindingValue(expected, "callback_nonce")) {
    return blocked("PROVIDER_CALLBACK_NONCE_MISMATCH");
  }

  return {
    ok: true,
    state: "VERIFIED",
    provider,
    contract_version: PROVIDER_CALLBACK_SECURITY_CONTRACT_VERSION,
    replay_key: `${provider}:${eventId}`,
    evidence: {
      event_id: eventId,
      provider_run_id: runId,
      status,
      observed_at: observedAt,
      workspace: expectedBindingValue(expected, "workspace"),
      issue_id: expectedBindingValue(expected, "issue_id"),
      task_id: expectedBindingValue(expected, "task_id"),
      idempotency_key: expectedBindingValue(expected, "idempotency_key"),
      source: "official_provider_callback",
      signature_verified: true,
      replay_protection: "persisted_event_id_and_idempotency_key"
    }
  };
}

export function createProviderAdapter(provider, options = {}) {
  const name = text(provider);
  return Object.freeze({
    provider: name,
    capabilities: getProviderCapability(name, options.capabilities || PHASE2_PROVIDER_CAPABILITY_MATRIX),
    dispatch: input => buildProviderDispatchRequest({...input, provider: name}, options),
    normalizeEvent: input => normalizeProviderEvent({...input, provider: name}, options)
  });
}
