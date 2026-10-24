export const AGENT_DETAIL_STORE_CONTRACT_VERSION = "1.0";
export const AGENT_DETAIL_STORE_CONTRACT = Object.freeze({
  version: AGENT_DETAIL_STORE_CONTRACT_VERSION,
  authority: "server_side_protected_detail_store",
  operations: ["put", "get"],
  required_scope: ["issue_id", "workspace_id", "event_id", "executor_id"],
  forbidden: ["public_comment_secret", "client_authorization", "hash_as_storage", "unscoped_read"]
});

const text = value => typeof value === "string" ? value.trim() : "";
const blocked = reason => ({accepted: false, state: "BLOCKED", reason, contract: AGENT_DETAIL_STORE_CONTRACT});
function serverScope(scope) {
  const principal = scope?.server_principal;
  return scope?.authority_scope === "TASKFLOW_AUTHORITY_VERIFIED"
    && principal?.verified === true
    && principal.source === "TASKFLOW_AUTHORITY"
    && principal.user_id
    && scope?.workspace_acl === "ALLOW"
    && scope?.issue_acl === "ALLOW"
    && text(scope.issue_id) && text(scope.workspace_id) && text(scope.event_id) && text(scope.executor_id);
}

/**
 * A server-only seam for sensitive Agent evidence. The concrete encrypted
 * store is injected by the native runtime; this module never stores secrets,
 * creates a table, or treats a digest as retrieval evidence.
 */
export function createAgentProtectedDetailStore({put, get} = {}) {
  const configured = typeof put === "function" && typeof get === "function";
  return Object.freeze({
    version: AGENT_DETAIL_STORE_CONTRACT_VERSION,
    configured,
    contract: AGENT_DETAIL_STORE_CONTRACT,
    async putDetail({scope, label, value} = {}) {
      if (!configured) return blocked("DETAIL_STORE_UNWIRED");
      if (!serverScope(scope) || !text(label) || !text(value)) return blocked("DETAIL_SCOPE_UNVERIFIED");
      const result = await put({scope: {...scope}, label: text(label), value: text(value)});
      if (!text(result?.protected_ref) || result?.stored !== true) return blocked("DETAIL_STORE_WRITE_UNVERIFIED");
      return {accepted: true, protected_ref: text(result.protected_ref), state: "PROTECTED_REFERENCE"};
    },
    async getDetail({scope, protectedRef} = {}) {
      if (!configured) return blocked("DETAIL_STORE_UNWIRED");
      if (!serverScope(scope) || !text(protectedRef)) return blocked("DETAIL_SCOPE_UNVERIFIED");
      const result = await get({scope: {...scope}, protected_ref: text(protectedRef)});
      if (result?.found !== true) return blocked("DETAIL_NOT_FOUND");
      return {accepted: true, state: "PROTECTED_READ", value: result.value, protected_ref: text(protectedRef)};
    }
  });
}
