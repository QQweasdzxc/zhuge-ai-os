/**
 * Versioned read contract for TaskFlow-owned Executor → Native Project maps.
 * The current TaskFlow /api/projects response does not provide this envelope,
 * so the Pages client must show GAP until the backend owns and returns it.
 * Project metadata, names, slugs, lead fields, and client ACL booleans are not
 * mapping authority.
 */
export const NATIVE_EXECUTOR_PROJECT_MAP_SCHEMA = "taskflow-native-executor-project-mapping-v1";
export const NATIVE_EXECUTOR_PROJECT_MAP_SOURCE = "TASKFLOW_NATIVE_EXECUTOR_REGISTRY";
export const NATIVE_EXECUTORS = Object.freeze(["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORITY_TTL_MS = 5 * 60 * 1000;

const text = value => typeof value === "string" ? value.trim() : "";
const isUuid = value => UUID.test(text(value));
const canonicalUuid = value => isUuid(value) ? text(value).toLowerCase() : "";

function gap(executorId, reason) {
  return Object.freeze({executorId, state: "GAP", reason, projectId: "", workspaceId: ""});
}

/**
 * Resolve only a server-owned, versioned Project mapping envelope. This is a
 * client-side contract validator, not an ACL check. The TaskFlow API must
 * authenticate the caller, resolve Workspace membership, read the mapping
 * from its own authority, and return this envelope. The current API does not
 * yet implement that response, which intentionally leaves all entries GAP.
 */
export function resolveNativeExecutorProjectMappings(envelope, {
  workspaceId,
  executors = NATIVE_EXECUTORS,
  now = Date.now(),
} = {}) {
  const selectedExecutors = [...new Set(executors.map(value => text(value).toUpperCase()).filter(Boolean))];
  let globalReason = "MAPPING_AUTHORITY_NOT_CONNECTED";
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return selectedExecutors.map(executorId => gap(executorId, globalReason));
  }
  if (envelope.schema !== NATIVE_EXECUTOR_PROJECT_MAP_SCHEMA || envelope.source !== NATIVE_EXECUTOR_PROJECT_MAP_SOURCE) {
    globalReason = "MAPPING_AUTHORITY_UNVERIFIED";
    return selectedExecutors.map(executorId => gap(executorId, globalReason));
  }
  const expectedWorkspace = canonicalUuid(workspaceId);
  if (!expectedWorkspace || canonicalUuid(envelope.workspace_id) !== expectedWorkspace) {
    globalReason = "WORKSPACE_SCOPE_MISMATCH";
    return selectedExecutors.map(executorId => gap(executorId, globalReason));
  }
  const checkedAt = Date.parse(envelope.checked_at || "");
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > AUTHORITY_TTL_MS) {
    globalReason = "MAPPING_AUTHORITY_STALE";
    return selectedExecutors.map(executorId => gap(executorId, globalReason));
  }
  if (!Array.isArray(envelope.mappings)) {
    globalReason = "MAPPING_ROWS_UNAVAILABLE";
    return selectedExecutors.map(executorId => gap(executorId, globalReason));
  }

  const rows = envelope.mappings.filter(row => row && typeof row === "object" && !Array.isArray(row));
  const executorCounts = new Map();
  const projectCounts = new Map();
  for (const row of rows) {
    const executorId = text(row.executor_id).toUpperCase();
    const projectId = canonicalUuid(row.project_id);
    executorCounts.set(executorId, (executorCounts.get(executorId) || 0) + 1);
    if (isUuid(projectId)) projectCounts.set(projectId, (projectCounts.get(projectId) || 0) + 1);
  }

  return selectedExecutors.map(executorId => {
    const matches = rows.filter(row => text(row.executor_id).toUpperCase() === executorId);
    if (matches.length === 0) return gap(executorId, "MAPPING_NOT_FOUND");
    if (matches.length !== 1 || executorCounts.get(executorId) !== 1) return gap(executorId, "DUPLICATE_EXECUTOR_MAPPING");
    const row = matches[0];
    if (row.source !== NATIVE_EXECUTOR_PROJECT_MAP_SOURCE) return gap(executorId, "ROW_AUTHORITY_UNVERIFIED");
    const projectId = canonicalUuid(row.project_id);
    if (!projectId) return gap(executorId, "PROJECT_ID_INVALID");
    if (projectCounts.get(projectId) !== 1) return gap(executorId, "DUPLICATE_PROJECT_MAPPING");
    if (canonicalUuid(row.workspace_id) !== expectedWorkspace) return gap(executorId, "WORKSPACE_SCOPE_MISMATCH");
    if (row.workspace_access !== "ALLOW" || row.project_access !== "ALLOW") return gap(executorId, "NATIVE_ACL_DENIED_OR_UNVERIFIED");
    return Object.freeze({executorId, state: "VERIFIED", reason: "", projectId, workspaceId: expectedWorkspace});
  });
}

/** Return a same-origin path into TaskFlow's existing native Project route. */
export function nativeTaskFlowProjectPath(workspaceSlug, projectId) {
  const slug = text(workspaceSlug);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !isUuid(projectId)) return "";
  return `/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}`;
}
