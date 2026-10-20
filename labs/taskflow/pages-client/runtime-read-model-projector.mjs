import {hydrateDurableDispatchRecord} from "./dispatch-persistence-contract.mjs";

export const RUNTIME_READ_MODEL_SCHEMA_ID = "zhuge-taskflow-phase2-dispatch-runtime-v1";

const RUNTIME_STATES = new Set([
  "INTENT_CREATED", "ASSIGNED", "ACK_PENDING", "RUNNING", "OVERDUE", "BLOCKED",
  "CANCELLED", "FAILED", "REASSIGN_REVIEW", "REVIEW", "DONE", "UNKNOWN", "PM_ACCEPTED"
]);
const AUTHORIZATION_STATES = new Set(["AUTHORIZED", "DENIED", "UNVERIFIED"]);
const EVIDENCE_STATES = new Set(["VERIFIED", "UNVERIFIED", "NOT_AVAILABLE"]);
const PROVIDER_RUN_SOURCES = new Set(["provider_event", "native_readback", null]);
const EVIDENCE_RUN_SOURCES = new Set(["provider_event", "native_readback", "UNVERIFIED", "NOT_AVAILABLE"]);
const GITHUB_SHA_SOURCES = new Set(["native_github_mirror", "manual_record_pending_native_readback", "NOT_AVAILABLE"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function exactSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim());
}

function firstValue(rows, keys) {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of keys) {
      const value = text(row[key]);
      if (value) return value;
    }
  }
  return null;
}

function nativeExactSha(pullRequests) {
  if (!Array.isArray(pullRequests)) return null;
  for (const row of pullRequests) {
    if (!row || typeof row !== "object") continue;
    const candidate = row.head_sha ?? row.headSha ?? row.sha;
    if (exactSha(candidate)) return candidate.trim().toLowerCase();
  }
  return null;
}

function normalizedAuthorization(record, authorizationResult) {
  const candidate = text(authorizationResult?.state || authorizationResult?.authorization || record.issuer_authorization);
  return AUTHORIZATION_STATES.has(candidate) ? candidate : "UNVERIFIED";
}

function normalizedState(record) {
  return RUNTIME_STATES.has(record.state) ? record.state : "UNKNOWN";
}

function buildEvidence(record, authorization, pullRequests) {
  const providerRunId = nullableText(record.provider_run_id);
  const providerAck = record.provider_acknowledged === true && providerRunId
    ? "VERIFIED"
    : (record.blocked_reason ? "NOT_AVAILABLE" : "UNVERIFIED");
  const providerRunSource = providerRunId
    ? (EVIDENCE_RUN_SOURCES.has(record.provider_run_id_source) ? record.provider_run_id_source : "UNVERIFIED")
    : (record.blocked_reason ? "NOT_AVAILABLE" : "UNVERIFIED");
  const githubSha = nativeExactSha(pullRequests);
  return {
    provider_ack: providerAck,
    provider_run_id_source: providerRunSource,
    github_sha_source: githubSha ? "native_github_mirror" : "NOT_AVAILABLE",
    blocked_reason: nullableText(record.blocked_reason) || (authorization !== "AUTHORIZED" ? "CTO_AUTHORIZATION_UNVERIFIED" : null),
    error: nullableText(record.error)
  };
}

/**
 * Project the durable TaskFlow-owned record and native readbacks into the
 * versioned read model consumed by CO-03. Native task IDs and GitHub SHAs are
 * readbacks only; neither can create a Provider Run ID or a verified ACK.
 */
export function projectDispatchRuntimeReadModel({record: snapshot, nativeTaskRuns = [], nativePullRequests = [], authorizationResult} = {}) {
  const record = hydrateDurableDispatchRecord(snapshot);
  const authorization = normalizedAuthorization(record, authorizationResult);
  const taskId = nullableText(record.task_id) || firstValue(nativeTaskRuns, ["task_id", "id"]);
  const providerRunId = nullableText(record.provider_run_id);
  const providerRunSource = providerRunId && PROVIDER_RUN_SOURCES.has(record.provider_run_id_source)
    ? record.provider_run_id_source
    : providerRunId ? null : null;
  const model = {
    schema: record.schema,
    intent_id: record.intent_id,
    idempotency_key: record.idempotency_key,
    issuer_user_id: record.issuer_user_id,
    workspace: record.workspace,
    issue_id: record.issue_id,
    work_code: record.work_code,
    executor_id: record.executor_id,
    provider: record.provider,
    status_source: "TASKFLOW_RUNTIME_READ_MODEL",
    task_id: taskId,
    provider_run_id: providerRunId,
    provider_run_id_source: providerRunSource,
    state: normalizedState(record),
    authorization,
    writer_id: nullableText(record.writer_id),
    fencing_epoch: record.fencing_epoch,
    lease_active: record.lease_active === true,
    lease_expires_at: nullableText(record.lease_expires_at),
    checkpoint_ref: nullableText(record.checkpoint_ref),
    last_heartbeat_at: nullableText(record.last_heartbeat_at),
    quota_state: record.quota_state === "EXHAUSTED" ? "EXHAUSTED" : "UNKNOWN",
    version: record.version,
    evidence: buildEvidence(record, authorization, nativePullRequests)
  };
  return model;
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  return true;
}

function formatValid(value, format) {
  if (format !== "date-time") return true;
  return typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
}

/**
 * Small dependency-free JSON Schema validator for the checked-in runtime
 * schema. It intentionally implements only the keywords used by that schema,
 * so CI validates the actual schema file without adding a second dependency.
 */
export function validateJsonSchema(value, schema, path = "$", errors = []) {
  if (schema && Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema?.enum && !schema.enum.some(candidate => candidate === value)) {
    errors.push(`${path} must be one of ${schema.enum.map(candidate => JSON.stringify(candidate)).join(", ")}`);
  }
  if (schema?.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => typeMatches(value, type))) errors.push(`${path} has invalid type`);
  }
  if (typeof value === "string") {
    if (schema?.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than minLength`);
    if (schema?.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path} does not match pattern`);
    if (!formatValid(value, schema?.format)) errors.push(`${path} has invalid ${schema.format}`);
  }
  if (typeof value === "number" && schema?.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path} is below minimum`);
  }
  if (schema?.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateJsonSchema(value[key], childSchema, `${path}.${key}`, errors);
    }
  }
  if (schema?.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateJsonSchema(item, schema.items, `${path}[${index}]`, errors));
  }
  return errors;
}

export function validateRuntimeReadModel(model, schema) {
  const errors = validateJsonSchema(model, schema);
  return {valid: errors.length === 0, errors};
}

export function projectAndValidateDispatchRuntimeReadModel(input, schema) {
  const model = projectDispatchRuntimeReadModel(input);
  const result = validateRuntimeReadModel(model, schema);
  if (!result.valid) throw new Error(`runtime read model schema validation failed: ${result.errors.join("; ")}`);
  return model;
}

export const RUNTIME_WORKBENCH_SCHEMA_ID = "zhuge-taskflow-phase2-runtime-workbench-v1";

/**
 * Compose the read-only Workbench envelope from the existing native Issue,
 * durable TaskFlow record and native readbacks. This is a projection over the
 * existing authority, not a second task store or a new mutation endpoint.
 */
export function buildRuntimeWorkbenchEnvelope({issue, record, nativeTaskRuns = [], nativePullRequests = [], authorizationResult} = {}, schema, runtimeSchema = null) {
  const nativeIssueId = nullableText(issue?.id);
  const workbenchSchema = schema?.$id === RUNTIME_WORKBENCH_SCHEMA_ID ? schema : null;
  const readModelSchema = runtimeSchema || (workbenchSchema ? null : schema);
  if (!nativeIssueId) throw new Error("native TaskFlow issue identity is required");
  const model = projectAndValidateDispatchRuntimeReadModel({
    record,
    nativeTaskRuns,
    nativePullRequests,
    authorizationResult
  }, readModelSchema);
  if (nativeIssueId !== model.issue_id) throw new Error("native issue and runtime read model identities differ");
  const nativeWorkspace = nullableText(issue?.workspace_id ?? issue?.workspace);
  if (nativeWorkspace && nativeWorkspace !== model.workspace) throw new Error("native issue and runtime workspace identities differ");
  const envelope = {
    schema: RUNTIME_WORKBENCH_SCHEMA_ID,
    issue: {
      id: nativeIssueId,
      identifier: nullableText(issue?.identifier),
      title: nullableText(issue?.title),
      status: nullableText(issue?.status),
      workspace: nativeWorkspace || model.workspace
    },
    read_model: model,
    provenance: {
      issue: "taskflow_native_issue",
      dispatch_intent: "taskflow_native_durable_record",
      runtime: "taskflow_runtime_read_model_projector",
      task_runs: "taskflow_native_task_run_readback",
      github: "taskflow_native_github_readback",
      provider_run_id_rule: "official_provider_event_only",
      workbench: "read_only_projection"
    }
  };
  if (workbenchSchema) {
    const result = validateJsonSchema(envelope, workbenchSchema);
    if (result.length) throw new Error(`runtime Workbench schema validation failed: ${result.join("; ")}`);
  }
  return envelope;
}
