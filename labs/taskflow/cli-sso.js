/* TaskFlow-owned Multica CLI SSO boundary. No credential is persisted here. */
(function attachTaskFlowCliSSO(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZhugeTaskFlowCliSSO = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTaskFlowCliSSO() {
  "use strict";
  const AIOS_TASKFLOW_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/";
  const STATE_PATTERN = /^[a-f0-9]{32}$/;
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
  function buildCliCallbackUrl(callback, token, state) {
    if (!validateCliCallback(callback) || typeof token !== "string" || token.length < 16 || !validateCliState(state)) throw new Error("invalid CLI callback grant");
    const url = new URL(callback);
    url.searchParams.set("token", token);
    url.searchParams.set("state", state);
    return url.toString();
  }
  function consumeCliState(state, storage) {
    if (!validateCliState(state) || !storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return false;
    const key = "zhuge-taskflow-cli-state:" + state;
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, "consumed");
    return true;
  }
  return { parseCliIntent, validateCliCallback, validateCliState, buildAiosLauncherUrl, buildTaskFlowLoginDestination, safeTaskFlowDestination, buildCliCallbackUrl, consumeCliState };
});
