"use strict";
// Isolated, simulated-auth tests: pixel-office-3d live-data polling must rotate
// an expired stored Supabase pair through the EXISTING shared auth-service
// instead of showing a false "登入狀態已失效". No network and no real session:
// every HTTP call is a stub, every token is a fixture string. Live-site data
// verification is reported separately and is not claimed here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const GOOGLE_KEY = "zhuge_ai_os_google_auth_session_v1";

function makeWorld({ storedSession, refreshResponder }) {
  const store = new Map();
  if (storedSession) store.set(GOOGLE_KEY, JSON.stringify(storedSession));
  const calls = { refresh: 0, exchangeToken: null };
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const reply = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (u.includes("/auth/v1/token?grant_type=refresh_token")) {
      calls.refresh += 1;
      return refreshResponder();
    }
    if (u.endsWith("/auth/zhuge")) {
      calls.exchangeToken = JSON.parse(init.body || "{}").access_token || null;
      return reply(200, { token: "local-jwt" });
    }
    if (u.includes("/api/issues")) return reply(200, { issues: [] });
    if (u.includes("/api/projects")) return reply(200, { projects: [] });
    if (u.includes("/api/zhuge/native-ai-tasks")) return reply(200, { tasks: [] });
    throw new Error("unexpected fetch: " + u);
  };
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    location: { origin: "https://qqweasdzxc.github.io", pathname: "/zhuge-ai-os/labs/pixel-office-3d/", hash: "", search: "" },
    document: { getElementById: () => null, body: { classList: { contains: () => false } } },
    fetch: fetchStub,
    atob: s => Buffer.from(s, "base64").toString("binary"),
    btoa: s => Buffer.from(s, "binary").toString("base64")
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const scripts = [
    "var session = null;", // same binding shim as labs/pixel-office-3d/index.html
    "shared/app-config.js",
    "shared/utils/shared-utils.js",
    "shared/auth/auth-service.js",
    "labs/pixel-office-3d/tf-source.js"
  ];
  const source = scripts.map(f => (f.endsWith(".js") ? fs.readFileSync(path.join(ROOT, f), "utf8") : f)).join("\n;\n") + "\n;this.__TfSource = TfSource;";
  vm.runInContext(source, sandbox, { filename: "bundle.js" });
  return { sandbox, store, calls, fetchStub };
}

const pollOpts = store => ({
  apiBase: "https://tf.example",
  workspace: "demo-ws",
  storageGet: k => (store.has(k) ? store.get(k) : null)
});

test("expired stored token rotates through the shared refresh before the exchange (simulated)", async () => {
  const { sandbox, store, calls, fetchStub } = makeWorld({
    storedSession: { access_token: "old-access", refresh_token: "r1", token_type: "bearer", expires_in: 3600, expires_at: Date.now() - 1000 },
    refreshResponder: () => ({ ok: true, status: 200, json: async () => ({ access_token: "new-access", refresh_token: "r2", token_type: "bearer", expires_in: 3600 }), text: async () => "" })
  });
  const result = await sandbox.__TfSource.pollTfOnce(fetchStub, "", Date.now(), pollOpts(store));
  assert.equal(result.state, "ok");
  assert.equal(calls.refresh, 1, "exactly one collapsed refresh");
  assert.equal(calls.exchangeToken, "new-access", "exchange must use the refreshed access token");
  const persisted = JSON.parse(store.get(GOOGLE_KEY));
  assert.equal(persisted.refresh_token, "r2", "rotated refresh token is persisted");
  assert.equal(persisted.access_token, "new-access");
});

test("valid stored token skips the refresh entirely (simulated)", async () => {
  const { sandbox, store, calls, fetchStub } = makeWorld({
    storedSession: { access_token: "live-access", refresh_token: "r1", token_type: "bearer", expires_in: 3600, expires_at: Date.now() + 3600 * 1000 },
    refreshResponder: () => { throw new Error("refresh must not be called"); }
  });
  const result = await sandbox.__TfSource.pollTfOnce(fetchStub, "", Date.now(), pollOpts(store));
  assert.equal(result.state, "ok");
  assert.equal(calls.refresh, 0);
  assert.equal(calls.exchangeToken, "live-access");
});

test("terminally dead refresh clears the session and reports signed-out, never a false-expired loop (simulated)", async () => {
  const { sandbox, store, fetchStub } = makeWorld({
    storedSession: { access_token: "old-access", refresh_token: "r-dead", token_type: "bearer", expires_in: 3600, expires_at: Date.now() - 1000 },
    refreshResponder: () => ({ ok: false, status: 400, json: async () => ({ error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" }), text: async () => JSON.stringify({ error_code: "refresh_token_already_used" }) })
  });
  const result = await sandbox.__TfSource.pollTfOnce(fetchStub, "", Date.now(), pollOpts(store));
  assert.equal(result.state, "auth-required");
  assert.equal(result.note, "需要登入 Zhuge AI OS");
  assert.equal(store.has(GOOGLE_KEY), false, "terminal refresh failure clears the stored session");
});
