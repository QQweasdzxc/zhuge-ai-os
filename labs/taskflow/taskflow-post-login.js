(function attachTaskFlowPostLogin(root) {
  "use strict";

  const STORAGE_KEY = "zhuge_taskflow_post_login_v1";
  const RECENT_RETURN_KEY = "zhuge_taskflow_post_login_recent_return_v1";
  const POST_LOGIN_INTENT_TTL_MS = 10 * 60 * 1000;
  const REDIRECT_LOOP_GUARD_MS = 2 * 60 * 1000;
  const MAX_RECENT_SAME_INTENT = 2;
  const RETURN_PATHS = Object.freeze({
    office: "../../",
    taskflow: "../../labs/taskflow/",
    investment: "../../modules/investment/",
    preview: "../../labs/pixel-office-3d/?source=tf"
  });

  function requestedIntent(params) {
    if (params.get("officeReturn") === "1") return "office";
    if (params.get("taskflowReturn") === "1") return "taskflow";
    if (params.get("investmentReturn") === "1") return "investment";
    if (params.get("previewReturn") === "1") return "preview";
    return null;
  }

  function readRecentReturns(storage, now) {
    try {
      const parsed = JSON.parse(storage.getItem(RECENT_RETURN_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(entry => entry && typeof entry.i === "string" && Number.isFinite(entry.t) && (entry.t > now || now - entry.t < REDIRECT_LOOP_GUARD_MS));
    } catch {
      return [];
    }
  }

  function capture(location = root.location, storage = root.sessionStorage, now = Date.now()) {
    try {
      const params = new URLSearchParams(location.search);
      const intent = requestedIntent(params);
      if (!intent) return false;
      const recent = readRecentReturns(storage, now);
      if (recent.filter(entry => entry.i === intent).length >= MAX_RECENT_SAME_INTENT) {
        storage.setItem(RECENT_RETURN_KEY, JSON.stringify(recent));
        try { if (root.console && typeof root.console.warn === "function") root.console.warn("[taskflow-post-login] redirect loop guard stopped a repeated return:", intent); } catch { /* ignore */ }
        return false;
      }
      recent.push({ i: intent, t: now });
      storage.setItem(RECENT_RETURN_KEY, JSON.stringify(recent));
      storage.setItem(STORAGE_KEY, JSON.stringify({ intent, expiresAt: now + POST_LOGIN_INTENT_TTL_MS }));
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
      if (!Object.hasOwn(RETURN_PATHS, pending?.intent) || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now) {
        storage.removeItem(STORAGE_KEY);
        return false;
      }
      const destination = new URL(RETURN_PATHS[pending.intent], location.href);
      storage.removeItem(STORAGE_KEY);
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
