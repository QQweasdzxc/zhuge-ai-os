/* Shared Session Lifecycle (TASK-005)
 *
 * One refresh at a time.  A request that receives 401 gets one refresh
 * attempt; refresh failure clears the session and stops retry storms.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSessionLifecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(options = {}) {
    const read = typeof options.readSession === "function" ? options.readSession : () => null;
    const refresh = typeof options.refreshSession === "function" ? options.refreshSession : async () => null;
    const clear = typeof options.clearSession === "function" ? options.clearSession : () => {};
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const skewMs = Math.max(0, Number(options.skewMs || 30000));
    let refreshPromise = null;

    function valid(session) {
      const expiresAt = Number(session?.expires_at || session?.expiresAt || 0);
      return Boolean(session?.access_token) && (!expiresAt || expiresAt > now() + skewMs);
    }
    async function ensure(force = false) {
      const current = read();
      if (!force && valid(current)) return current;
      if (!refreshPromise) {
        refreshPromise = Promise.resolve().then(() => refresh(force)).then(next => {
          if (!valid(next)) {
            clear();
            const error = new Error("登入工作階段已逾時，請重新登入。");
            error.code = "AUTH_SESSION_EXPIRED";
            throw error;
          }
          return next;
        }).finally(() => { refreshPromise = null; });
      }
      return refreshPromise;
    }
    async function request(run) {
      if (typeof run !== "function") throw new TypeError("Session request requires a function.");
      const hadValidSession = valid(read());
      await ensure(false);
      let response = await run();
      if (response?.status !== 401) return response;
      // If the session was already expired, ensure(false) performed the one
      // refresh needed for this request.  A 401 after a valid session gets
      // the single forced refresh allowed by the contract.
      if (hadValidSession) await ensure(true);
      response = await run();
      return response;
    }
    return Object.freeze({ ensure, request, isRefreshing: () => Boolean(refreshPromise) });
  }

  return Object.freeze({ create });
});
