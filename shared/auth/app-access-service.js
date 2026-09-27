/* Canonical Zhuge AI OS application-access service.
 *
 * Google/Supabase authentication is intentionally separate from product
 * access.  This module exposes only the controlled RPCs and the ephemeral
 * Realtime Presence channel; callers never receive the Supabase client or a
 * service credential.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeAppAccess = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const STATUS = Object.freeze({
    unauthenticated: "UNAUTHENTICATED",
    checking: "CHECKING",
    unknown: "UNKNOWN",
    new: "NEW",
    pending: "PENDING",
    approved: "APPROVED",
    rejected: "REJECTED"
  });

  function firstRow(payload) {
    return Array.isArray(payload) ? payload[0] || null : payload || null;
  }

  function normalizeAccess(payload = {}) {
    const row = firstRow(payload) || {};
    const rawStatus = String(row.status || row.access_status || STATUS.unknown).trim().toUpperCase();
    const status = Object.values(STATUS).includes(rawStatus) ? rawStatus : STATUS.unknown;
    return Object.freeze({
      ...row,
      status,
      userId: String(row.user_id || row.userId || "").trim(),
      email: String(row.email || "").trim(),
      displayName: String(row.display_name || row.displayName || "").trim(),
      reason: String(row.reason || "").trim(),
      reviewNote: String(row.review_note || row.reviewNote || "").trim(),
      history: Array.isArray(row.history) ? row.history.slice() : []
    });
  }

  function requireGateway(options = {}) {
    const gateway = options.dataGateway || root?.ZhugeSupabaseGateway?.createDataGateway?.();
    if (!gateway || typeof gateway.rpc !== "function") {
      const error = new Error("App Access Cloud service 尚未載入。");
      error.code = "APP_ACCESS_GATEWAY_UNAVAILABLE";
      throw error;
    }
    return gateway;
  }

  function createService(options = {}) {
    const gateway = requireGateway(options);
    const call = (name, args = {}) => gateway.rpc(name, args);
    return Object.freeze({
      async getCurrent() {
        return normalizeAccess(await call("resolve_app_access", {}));
      },
      async submit({ displayName, reason, idempotencyKey } = {}) {
        return normalizeAccess(await call("submit_app_access_request", {
          p_display_name: String(displayName || "").trim(),
          p_reason: String(reason || "").trim(),
          p_idempotency_key: String(idempotencyKey || "").trim() || null
        }));
      },
      async listApplications() {
        const payload = await call("list_app_access_applications", {});
        const row = firstRow(payload);
        return Array.isArray(row) ? row : Array.isArray(payload) ? payload : [];
      },
      async history(applicationId) {
        const payload = await call("get_app_access_application_history", { p_application_id: applicationId });
        const row = firstRow(payload);
        return Array.isArray(row) ? row : Array.isArray(payload) ? payload : [];
      },
      async review({ applicationId, decision, reviewNote, idempotencyKey } = {}) {
        return firstRow(await call("review_app_access_application", {
          p_application_id: applicationId,
          p_decision: String(decision || "").trim().toLowerCase(),
          p_review_note: String(reviewNote || "").trim() || null,
          p_idempotency_key: String(idempotencyKey || "").trim() || null
        }));
      },
      async getCreatorNotes() {
        const payload = await call("get_creator_user_notes", {});
        const row = firstRow(payload);
        return Array.isArray(row) ? row : Array.isArray(payload) ? payload : [];
      },
      async saveCreatorNote(subjectUserId, note) {
        return firstRow(await call("upsert_creator_user_note", {
          p_subject_user_id: subjectUserId,
          p_note: String(note || "")
        }));
      },
      async createPresenceChannel(options = {}) {
        if (typeof gateway.createPresenceChannel !== "function") {
          const error = new Error("App Presence Cloud service 尚未載入。");
          error.code = "APP_PRESENCE_GATEWAY_UNAVAILABLE";
          throw error;
        }
        return gateway.createPresenceChannel(options);
      }
    });
  }

  let defaultService = null;
  function getDefaultService() {
    if (!defaultService) defaultService = createService();
    return defaultService;
  }

  return Object.freeze({
    STATUS,
    normalizeAccess,
    createService,
    getCurrent: (...args) => getDefaultService().getCurrent(...args),
    submit: (...args) => getDefaultService().submit(...args),
    listApplications: (...args) => getDefaultService().listApplications(...args),
    history: (...args) => getDefaultService().history(...args),
    review: (...args) => getDefaultService().review(...args),
    getCreatorNotes: (...args) => getDefaultService().getCreatorNotes(...args),
    saveCreatorNote: (...args) => getDefaultService().saveCreatorNote(...args),
    createPresenceChannel: (...args) => getDefaultService().createPresenceChannel(...args)
  });
});
