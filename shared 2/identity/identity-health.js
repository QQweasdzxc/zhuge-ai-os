/* Shared Identity Health (TASK-003)
 *
 * Modules receive one canonical Supabase Auth UUID.  This diagnostic reports
 * mismatches without guessing ownership or mutating data.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeIdentityHealth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function unique(values) { return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]; }

  function inspect(options = {}) {
    const identity = options.identity || {};
    const session = options.session || {};
    const canonical = String(identity.userId || identity.id || session.user_id || session.userId || "").trim();
    const observed = unique([
      canonical,
      session.user_id,
      session.userId,
      session.user?.id,
      session.user_uuid,
      options.localIdentity?.userId,
      options.legacyOwnerUuid,
      options.workspaceUserId
    ]);
    const mismatch = observed.length > 1;
    const authenticated = identity.isAuthenticated !== false && Boolean(canonical);
    return Object.freeze({
      healthy: authenticated && !mismatch,
      authenticated,
      canonicalUserId: canonical,
      observedUserIds: observed,
      mismatch,
      reason: !authenticated ? "identity_required" : (mismatch ? "identity_mismatch" : "ok")
    });
  }

  function assertHealthy(result) {
    if (!result?.healthy) {
      const error = new Error(result?.reason === "identity_mismatch" ? "Shared Identity UUID 不一致，已停止資料操作。" : "Shared Identity 尚未就緒。" );
      error.code = result?.reason === "identity_mismatch" ? "IDENTITY_MISMATCH" : "IDENTITY_REQUIRED";
      error.health = result;
      throw error;
    }
    return result;
  }

  return Object.freeze({ inspect, assertHealthy });
});
