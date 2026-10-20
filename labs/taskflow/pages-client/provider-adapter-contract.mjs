export const PROVIDER_ADAPTER_CONTRACT_VERSION = "1.0";

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

export function createProviderAdapter(provider, options = {}) {
  const name = text(provider);
  return Object.freeze({
    provider: name,
    capabilities: getProviderCapability(name, options.capabilities || PHASE2_PROVIDER_CAPABILITY_MATRIX),
    dispatch: input => buildProviderDispatchRequest({...input, provider: name}, options),
    normalizeEvent: input => normalizeProviderEvent({...input, provider: name}, options)
  });
}
