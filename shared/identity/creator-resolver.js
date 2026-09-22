/* Shared Creator Identity Capability.
 *
 * The resolver is the only browser-facing Creator decision point. It uses the
 * canonical Supabase Auth UUID supplied by Shared Session and asks the
 * controlled Cloud RPC to resolve the capability. Unknown or failed reads are
 * deliberately treated as non-Creator.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeCreatorResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EMPTY = Object.freeze({
    status: "unknown",
    userId: "",
    is_creator: false,
    error: null
  });

  function normalizeUserId(value) {
    return String(value || "").trim();
  }

  function normalizeResult(payload, userId) {
    const row = Array.isArray(payload) ? payload[0] : payload;
    const isCreator = row?.is_creator === true || row?.isCreator === true;
    return Object.freeze({
      status: "resolved",
      userId,
      is_creator: isCreator,
      error: null
    });
  }

  function create(options = {}) {
    const dataGateway = options.dataGateway || null;
    const readUserId = typeof options.readUserId === "function" ? options.readUserId : () => "";
    let snapshot = EMPTY;
    let pending = null;
    let resolvedUserId = "";

    function safeUserId() {
      try { return normalizeUserId(readUserId()); } catch { return ""; }
    }

    async function resolve({ force = false } = {}) {
      const userId = safeUserId();
      if (!userId) {
        snapshot = EMPTY;
        resolvedUserId = "";
        return snapshot;
      }
      if (!force && resolvedUserId === userId && snapshot.status === "resolved") return snapshot;
      if (!force && pending && resolvedUserId === userId) return pending;

      resolvedUserId = userId;
      pending = Promise.resolve().then(async () => {
        try {
          if (!dataGateway || typeof dataGateway.rpc !== "function") {
            throw new Error("Creator Resolver Cloud RPC 尚未載入。");
          }
          const payload = await dataGateway.rpc("resolve_creator_capability", {});
          snapshot = normalizeResult(payload, userId);
        } catch (error) {
          snapshot = Object.freeze({
            status: "error",
            userId,
            is_creator: false,
            error: String(error?.message || error || "Creator Resolver failed")
          });
        } finally {
          pending = null;
        }
        return snapshot;
      });
      return pending;
    }

    return Object.freeze({
      getSnapshot: () => snapshot,
      isCreator: () => snapshot.is_creator === true,
      resolve,
      reset: () => {
        snapshot = EMPTY;
        resolvedUserId = "";
        pending = null;
      }
    });
  }

  return Object.freeze({ EMPTY, create });
});
