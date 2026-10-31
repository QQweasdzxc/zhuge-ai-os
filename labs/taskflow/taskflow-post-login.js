(function attachTaskFlowPostLogin(root) {
  "use strict";

  const STORAGE_KEY = "zhuge_taskflow_post_login_v1";
  const RECENT_RETURN_KEY = "zhuge_taskflow_post_login_recent_return_v1";
  const POST_LOGIN_INTENT_TTL_MS = 10 * 60 * 1000;
  const REDIRECT_LOOP_GUARD_MS = 2 * 60 * 1000;
  const MAX_AUTO_REDIRECTS_PER_INTENT = 2;
  const RETURN_PATHS = Object.freeze({
    office: "../../",
    taskflow: "../../labs/taskflow/",
    investment: "../../modules/investment/",
    preview: "../../labs/pixel-office-3d/?source=tf"
  });
  const INTENT_LABELS = Object.freeze({
    office: "Pixel Office 首頁",
    taskflow: "TaskFlow 工作區",
    investment: "投資模組",
    preview: "3D 辦公室預覽"
  });

  function requestedIntent(params) {
    if (params.get("officeReturn") === "1") return "office";
    if (params.get("taskflowReturn") === "1") return "taskflow";
    if (params.get("investmentReturn") === "1") return "investment";
    if (params.get("previewReturn") === "1") return "preview";
    return null;
  }

  function readRecentRedirects(storage, now) {
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
      storage.setItem(STORAGE_KEY, JSON.stringify({ intent, expiresAt: now + POST_LOGIN_INTENT_TTL_MS }));
      return true;
    } catch {
      return false;
    }
  }

  // A true bounce loop is an automatic redirect chain with no human in it, so the
  // guard bounds only automatic redirects per intent and never blocks capture.
  // When the budget is exhausted the pending intent becomes an explicit,
  // user-readable banner with a normal link: automatic bounces stop here, while a
  // person who really did ask for this destination again keeps a one-click path.
  function showLoopGuardNotice(document, destination, intent) {
    try {
      if (!document || typeof document.createElement !== "function" || !document.body) return;
      const label = INTENT_LABELS[intent] || intent;
      const banner = document.createElement("div");
      banner.id = "zhuge-post-login-loop-guard";
      banner.setAttribute("role", "status");
      banner.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:70;background:#1f3a5f;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;line-height:1.6;max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,.25)";
      const text = document.createElement("span");
      text.textContent = "為避免重複跳轉，已暫停自動前往「" + label + "」。如果這是你剛才的操作，請直接點擊繼續：";
      const link = document.createElement("a");
      link.href = destination.href;
      link.textContent = "前往" + label;
      link.style.cssText = "color:#9ecbff;margin-left:8px;font-weight:600";
      banner.appendChild(text);
      banner.appendChild(link);
      document.body.appendChild(banner);
    } catch { /* rendering the notice must never break the page */ }
  }

  function complete({ authenticated, accessApproved, runtimeReady, location, storage, now = Date.now(), document = root.document }) {
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
      const recent = readRecentRedirects(storage, now);
      if (recent.filter(entry => entry.i === pending.intent).length >= MAX_AUTO_REDIRECTS_PER_INTENT) {
        storage.removeItem(STORAGE_KEY);
        storage.setItem(RECENT_RETURN_KEY, JSON.stringify(recent));
        try { if (root.console && typeof root.console.warn === "function") root.console.warn("[taskflow-post-login] redirect loop guard stopped an automatic return:", pending.intent); } catch { /* ignore */ }
        showLoopGuardNotice(document, destination, pending.intent);
        return false;
      }
      storage.removeItem(STORAGE_KEY);
      recent.push({ i: pending.intent, t: now });
      storage.setItem(RECENT_RETURN_KEY, JSON.stringify(recent));
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
