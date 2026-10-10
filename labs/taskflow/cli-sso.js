/* TaskFlow-owned Multica CLI SSO boundary. No credential is persisted here. */
(function attachTaskFlowCliSSO(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZhugeTaskFlowCliSSO = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTaskFlowCliSSO() {
  "use strict";
  const AIOS_TASKFLOW_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/";
  const STATE_PATTERN = /^[a-f0-9]{32}$/;
  const PENDING_INTENT_KEY = "zhuge_taskflow_cli_intent_v1";
  const PENDING_INTENT_TTL_MS = 4 * 60 * 1000;
  function validateCliCallback(raw) {
    if (typeof raw !== "string" || raw.length > 512) return false;
    try {
      const url = new URL(raw);
      const port = Number(url.port);
      const host = url.hostname.toLowerCase();
      return url.protocol === "http:" && !url.username && !url.password && url.pathname === "/callback"
        && !url.search && !url.hash && url.port !== "" && Number.isInteger(port) && port >= 1 && port <= 65535
        && (host === "localhost" || host === "127.0.0.1");
    } catch { return false; }
  }
  function validateCliState(state) {
    return typeof state === "string" && STATE_PATTERN.test(state);
  }
  function parseCliIntent(params) {
    if (!(params instanceof URLSearchParams)) {
      try { params = new URLSearchParams(String(params || "").replace(/^[?#]/, "")); }
      catch { return { status: "invalid" }; }
    }
    const callbacks = params.getAll("cli_callback");
    const states = params.getAll("cli_state");
    if (callbacks.length === 0 && states.length === 0) return { status: "none" };
    if (callbacks.length !== 1 || states.length !== 1 || !validateCliCallback(callbacks[0]) || !validateCliState(states[0])) return { status: "invalid" };
    return { status: "valid", callback: callbacks[0], state: states[0] };
  }
  function encodeIntent(intent) {
    if (!intent || intent.status !== "valid" || !validateCliCallback(intent.callback) || !validateCliState(intent.state)) throw new Error("invalid CLI authorization request");
    const params = new URLSearchParams();
    params.set("cli_callback", intent.callback);
    params.set("cli_state", intent.state);
    return params.toString();
  }
  function buildAiosLauncherUrl(intent) {
    const target = new URL(AIOS_TASKFLOW_URL);
    target.hash = encodeIntent(intent);
    return target.toString();
  }
  function buildTaskFlowLoginDestination(intent) {
    return "/login#" + encodeIntent(intent);
  }
  function safeTaskFlowDestination(value, origin) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /%5c/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value, origin);
      return url.origin === origin ? url.pathname + url.search + url.hash : null;
    } catch { return null; }
  }
  function buildCliCallbackUrl(callback, authorizationCode, state) {
    if (!validateCliCallback(callback) || typeof authorizationCode !== "string" || !authorizationCode.startsWith("zgc_") || !validateCliState(state)) throw new Error("invalid CLI authorization code");
    const url = new URL(callback);
    // Keep the native CLI callback field name, but send only a one-use opaque code.
    url.searchParams.set("token", authorizationCode);
    url.searchParams.set("state", state);
    return url.toString();
  }
  function storePendingCliIntent(intent, storage, now = Date.now()) {
    if (!intent || intent.status !== "valid" || !validateCliCallback(intent.callback) || !validateCliState(intent.state)
      || !storage || typeof storage.setItem !== "function") return false;
    try {
      storage.setItem(PENDING_INTENT_KEY, JSON.stringify({ callback: intent.callback, state: intent.state, createdAt: now }));
      return true;
    } catch { return false; }
  }
  function readPendingCliIntent(storage, now = Date.now()) {
    if (!storage || typeof storage.getItem !== "function") return { status: "none" };
    try {
      const raw = storage.getItem(PENDING_INTENT_KEY);
      if (raw === null) return { status: "none" };
      const value = JSON.parse(raw);
      const createdAt = Number(value?.createdAt);
      const intent = { status: "valid", callback: value?.callback, state: value?.state };
      if (!Number.isFinite(createdAt) || now < createdAt || now - createdAt > PENDING_INTENT_TTL_MS
        || !validateCliCallback(intent.callback) || !validateCliState(intent.state)) {
        storage.removeItem?.(PENDING_INTENT_KEY);
        return { status: "invalid" };
      }
      return intent;
    } catch { return { status: "invalid" }; }
  }
  function consumePendingCliIntent(state, storage, now = Date.now()) {
    if (!validateCliState(state) || !storage || typeof storage.removeItem !== "function") return false;
    const pending = readPendingCliIntent(storage, now);
    if (pending.status !== "valid" || pending.state !== state) return false;
    try { storage.removeItem(PENDING_INTENT_KEY); return true; }
    catch { return false; }
  }
  function hasFreshSupabaseSession(storage, now = Date.now()) {
    if (!storage || typeof storage.getItem !== "function") return false;
    for (const key of ["zhuge_ai_os_google_auth_session_v1", "zhuge_ai_os_session_v1"]) {
      try {
        const session = JSON.parse(storage.getItem(key) || "null");
        const token = typeof session?.access_token === "string" ? session.access_token : "";
        const payload = token.split(".")[1];
        if (!payload) continue;
        const decoded = globalThis.atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        const claims = JSON.parse(decoded);
        if (Number.isFinite(Number(claims.exp)) && Number(claims.exp) * 1000 > now + 30000) return true;
      } catch {}
    }
    return false;
  }
  function startLoginReturnMonitor(root = globalThis) {
    const pending = readPendingCliIntent(root.sessionStorage);
    if (pending.status !== "valid" || !root.localStorage || typeof root.setInterval !== "function") {
      return { active: false, stop() {} };
    }
    let active = true;
    let timer = null;
    const stop = () => {
      if (!active) return;
      active = false;
      if (timer !== null) root.clearInterval?.(timer);
    };
    const check = () => {
      if (!active) return;
      const current = readPendingCliIntent(root.sessionStorage);
      if (current.status !== "valid" || current.state !== pending.state) { stop(); return; }
      if (!hasFreshSupabaseSession(root.localStorage)) return;
      stop();
      root.location.replace(buildAiosLauncherUrl(current));
    };
    check();
    if (active) timer = root.setInterval(check, 350);
    return { active, stop };
  }
  function consumeCliState(state, storage) {
    if (!validateCliState(state) || !storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return false;
    const key = "zhuge-taskflow-cli-state:" + state;
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, "consumed");
    return true;
  }
  return {
    parseCliIntent,
    validateCliCallback,
    validateCliState,
    buildAiosLauncherUrl,
    buildTaskFlowLoginDestination,
    safeTaskFlowDestination,
    buildCliCallbackUrl,
    storePendingCliIntent,
    readPendingCliIntent,
    consumePendingCliIntent,
    hasFreshSupabaseSession,
    startLoginReturnMonitor,
    consumeCliState
  };
});
