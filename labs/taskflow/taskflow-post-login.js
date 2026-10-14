(function attachTaskFlowPostLogin(root) {
  "use strict";

  const STORAGE_KEY = "zhuge_taskflow_post_login_v1";
  const RECENT_RETURN_KEY = "zhuge_taskflow_post_login_recent_return_v1";
  const POST_LOGIN_INTENT_TTL_MS = 10 * 60 * 1000;
  const REDIRECT_LOOP_GUARD_MS = 2 * 60 * 1000;

  function capture(location = root.location, storage = root.sessionStorage, now = Date.now()) {
    try {
      if (new URLSearchParams(location.search).get("taskflowReturn") !== "1") return false;
      const recentReturnAt = Number(storage.getItem(RECENT_RETURN_KEY));
      if (Number.isFinite(recentReturnAt) && recentReturnAt > 0 && (now < recentReturnAt || now - recentReturnAt < REDIRECT_LOOP_GUARD_MS)) return false;
      storage.setItem(STORAGE_KEY, JSON.stringify({ intent: "taskflow", expiresAt: now + POST_LOGIN_INTENT_TTL_MS }));
      return true;
    } catch {
      return false;
    }
  }

  function complete({ authenticated, accessApproved, runtimeReady, location, storage, now = Date.now() }) {
    if (authenticated !== true || accessApproved !== true || runtimeReady !== true) return false;
    try {
      const serialized = storage.getItem(STORAGE_KEY);
      if (!serialized) return false;
      let pending;
      try { pending = JSON.parse(serialized); } catch { pending = null; }
      if (pending?.intent !== "taskflow" || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now) {
        storage.removeItem(STORAGE_KEY);
        return false;
      }
      const destination = new URL("../../labs/taskflow/", location.href);
      storage.removeItem(STORAGE_KEY);
      storage.setItem(RECENT_RETURN_KEY, String(now));
      location.replace(destination.href);
      return true;
    } catch {
      return false;
    }
  }

  const api = Object.freeze({ capture, complete, storageKey: STORAGE_KEY });
  root.ZhugeTaskFlowPostLogin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  capture();
})(typeof window !== "undefined" ? window : globalThis);
