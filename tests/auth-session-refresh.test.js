const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function contextWithSessions() {
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const context = vm.createContext({
    console, Date, JSON, Number, String, Math, Promise, Error,
    localStorage,
    AUTH_CONFIG: { supabaseAnonKey: "anon", supabaseUrl: "https://example.supabase.co" },
    AUTH_SESSION_KEY: "auth",
    AI_OS_SESSION_KEY: "ui",
    session: { provider: "google-oauth", user_uuid: "u1", access_token: "expired-ui", expires_at: 1 },
    getStoredAuthSession: () => JSON.parse(localStorage.getItem("auth") || "null")
  });
  vm.runInContext(read("shared/utils/shared-utils.js"), context, { filename: "shared-utils.js" });
  return { context, values };
}

test("canonical stored access token wins over a stale UI session token", () => {
  const { context, values } = contextWithSessions();
  values.set("auth", JSON.stringify({ access_token: "fresh-stored", expires_at: 4102444800000 }));
  assert.equal(vm.runInContext("currentAccessToken()", context), "fresh-stored");
  assert.equal(vm.runInContext("currentAccessTokenExpiresAtMs()", context), 4102444800000);
});

test("auth refresh implementation is single-flight and synchronizes the root session", () => {
  const source = read("shared/auth/auth-service.js");
  assert.match(source, /authSessionRefreshPromise/);
  assert.match(source, /performAuthSessionRefresh\(\)/);
  assert.match(source, /if \(session\) \{/);
  assert.match(source, /persistAiOsSessionOnly\(\)/);
});

test("REST and Storage stop when JWT refresh does not produce a valid session", () => {
  const source = read("shared/api/repositories.js");
  const matches = source.match(/AUTH_SESSION_EXPIRED/g) || [];
  assert.equal(matches.length >= 2, true);
  assert.match(source, /登入工作階段已逾時/);
});
