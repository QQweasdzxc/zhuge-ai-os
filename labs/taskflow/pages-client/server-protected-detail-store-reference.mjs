import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

export const SERVER_DETAIL_STORE_REFERENCE_VERSION = "1.0";
const text = value => typeof value === "string" ? value.trim() : "";
const blocked = reason => ({accepted: false, state: "BLOCKED", reason});

function trustedScope(scope) {
  const principal = scope?.server_principal;
  return scope?.authority_scope === "TASKFLOW_AUTHORITY_VERIFIED"
    && principal?.verified === true
    && principal.source === "TASKFLOW_AUTHORITY"
    && text(principal.user_id)
    && scope.workspace_acl === "ALLOW"
    && scope.issue_acl === "ALLOW"
    && text(scope.workspace_id) && text(scope.issue_id) && text(scope.event_id);
}

/**
 * Isolated server-side reference implementation. It encrypts values before
 * retaining them in process memory for tests. Production must replace the
 * memory map with an approved encrypted service and persistent ACL boundary.
 */
export function createServerProtectedDetailStore({encryptionKey, principalResolver, aclResolver} = {}) {
  const configured = typeof principalResolver === "function" && typeof aclResolver === "function" && Buffer.isBuffer(encryptionKey) && encryptionKey.length === 32;
  const records = new Map();
  const key = configured ? encryptionKey : null;
  async function authorize(scope) {
    if (!configured) return false;
    const principal = await principalResolver(scope);
    const acl = await aclResolver(scope);
    return principal?.verified === true && principal.source === "TASKFLOW_AUTHORITY" && trustedScope({...scope, server_principal: principal, workspace_acl: acl?.workspace, issue_acl: acl?.issue});
  }
  return Object.freeze({
    version: SERVER_DETAIL_STORE_REFERENCE_VERSION,
    configured,
    async put({scope, label, value} = {}) {
      if (!configured) return blocked("DETAIL_STORE_UNWIRED");
      if (!await authorize(scope) || !text(label) || !text(value)) return blocked("DETAIL_SCOPE_UNVERIFIED");
      const ref = `vault://taskflow/${scope.workspace_id}/${scope.issue_id}/${scope.event_id}/${randomBytes(12).toString("hex")}`;
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      records.set(ref, {label, scope: {workspace_id: scope.workspace_id, issue_id: scope.issue_id, event_id: scope.event_id}, iv, ciphertext, tag: cipher.getAuthTag()});
      return {stored: true, protected_ref: ref};
    },
    async get({scope, protected_ref} = {}) {
      if (!configured) return blocked("DETAIL_STORE_UNWIRED");
      if (!await authorize(scope)) return blocked("DETAIL_SCOPE_UNVERIFIED");
      const record = records.get(text(protected_ref));
      if (!record || record.scope.workspace_id !== scope.workspace_id || record.scope.issue_id !== scope.issue_id) return blocked("DETAIL_NOT_FOUND");
      const decipher = createDecipheriv("aes-256-gcm", key, record.iv);
      decipher.setAuthTag(record.tag);
      const value = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
      return {found: true, protected_ref: text(protected_ref), value};
    }
  });
}
