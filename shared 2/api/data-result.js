/* Shared Data Result Contract (TASK-002)
 *
 * A missing/empty collection is not an error.  Every data boundary can
 * explicitly represent loading, empty, unauthorized, offline, degraded and
 * error states without silently turning failures into [] or null.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeDataResult = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = Object.freeze(["loading", "success", "empty", "unauthorized", "offline", "degraded", "error"]);

  function create(state, data = null, options = {}) {
    const normalized = STATES.includes(state) ? state : "error";
    const result = {
      state: normalized,
      data,
      error: options.error || null,
      message: String(options.message || options.error?.message || ""),
      retryable: Boolean(options.retryable),
      updatedAt: options.updatedAt || new Date().toISOString()
    };
    result.ok = normalized === "success" || normalized === "empty";
    result.isError = !result.ok;
    return Object.freeze(result);
  }

  function fromRows(rows, options = {}) {
    if (!Array.isArray(rows)) return create("error", null, { ...options, message: options.message || "資料回傳格式無效。" });
    return rows.length ? create("success", rows, options) : create("empty", [], options);
  }

  function fromError(error, options = {}) {
    const status = Number(error?.status || error?.statusCode || 0);
    const code = String(error?.code || "").toUpperCase();
    if (status === 401 || status === 403 || code.includes("AUTH") || code.includes("UNAUTHORIZED")) {
      return create("unauthorized", null, { ...options, error, message: options.message || "登入工作階段無效，請重新登入。", retryable: false });
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false || code.includes("OFFLINE")) {
      return create("offline", null, { ...options, error, message: options.message || "目前離線，請確認網路後重試。", retryable: true });
    }
    return create(options.state || "error", null, { ...options, error, retryable: options.retryable !== false });
  }

  return Object.freeze({ STATES, create, fromRows, fromError });
});
