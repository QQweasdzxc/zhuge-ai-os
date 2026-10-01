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

function response(status, body = "") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    text: async () => text,
    json: async () => JSON.parse(text || "null")
  };
}

function authContext({ stored, rootSession, fetchImpl }) {
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const context = vm.createContext({
    Date, JSON, Number, String, Math, Promise, Error, URLSearchParams,
    localStorage,
    location: { search: "", hash: "", href: "https://example.test/" },
    history: { replaceState() {} },
    AUTH_CONFIG: { supabaseAnonKey: "anon", supabaseUrl: "https://example.supabase.co" },
    AUTH_SESSION_KEY: "auth",
    AUTH_PROVIDER_KEY: "provider",
    AUTH_LINK_PENDING_KEY: "link",
    AUTH_CODE_VERIFIER_KEY: "verifier",
    OAUTH_ERROR_KEY: "oauth-error",
    AI_OS_SESSION_KEY: "ui",
    session: rootSession || null,
    fetch: fetchImpl,
    console: { error() {}, warn() {}, log() {} }
  });
  if (stored) values.set("auth", JSON.stringify(stored));
  if (rootSession) values.set("ui", JSON.stringify(rootSession));
  vm.runInContext(read("shared/utils/shared-utils.js"), context, { filename: "shared-utils.js" });
  vm.runInContext(read("shared/auth/auth-service.js"), context, { filename: "auth-service.js" });
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

test("reused refresh token clears stored, root, and app-state sessions without retrying", async () => {
  let refreshRequests = 0;
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired-ui", refresh_token: "reused", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "reused", expires_at: 1 },
    rootSession,
    fetchImpl: async () => {
      refreshRequests += 1;
      return response(400, { error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" });
    }
  });

  assert.equal(await vm.runInContext("getAuthSession()", context), null);
  assert.equal(await vm.runInContext("getAuthSession()", context), null);
  assert.equal(refreshRequests, 1);
  assert.equal(values.get("auth"), undefined);
  assert.equal(values.get("ui"), undefined);
  assert.equal(values.get("provider"), undefined);
  assert.equal(context.session, null);
  assert.equal(vm.runInContext("currentAccessToken()", context), "");
  assert.equal(vm.runInContext("hasGoogleOAuthSession()", context), false);
});

test("successful refresh updates canonical and root sessions", async () => {
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired-ui", refresh_token: "old-refresh", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "old-refresh", expires_at: 1 },
    rootSession,
    fetchImpl: async () => response(200, {
      access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600, token_type: "bearer"
    })
  });

  const refreshed = await vm.runInContext("refreshAuthSession(false)", context);
  assert.equal(refreshed.access_token, "fresh-access");
  assert.equal(JSON.parse(values.get("auth")).refresh_token, "fresh-refresh");
  assert.equal(context.session.access_token, "fresh-access");
  assert.equal(JSON.parse(values.get("ui")).access_token, "fresh-access");
});

test("expired root auth state is removed before UI render can treat it as logged in", () => {
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired", refresh_token: "", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "", expires_at: 1 },
    rootSession,
    fetchImpl: async () => response(500, {})
  });

  vm.runInContext("clearInvalidAuthState()", context);
  assert.equal(context.session, null);
  assert.equal(values.get("auth"), undefined);
  assert.equal(values.get("ui"), undefined);
});

test("UI guard leaves an expired session with a refresh token for the controlled refresh path", () => {
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired", refresh_token: "recoverable", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "recoverable", expires_at: 1 },
    rootSession,
    fetchImpl: async () => response(200, {})
  });

  vm.runInContext("clearInvalidAuthState()", context);
  assert.equal(context.session.email, "user@example.test");
  assert.equal(values.get("auth") !== undefined, true);
  assert.equal(values.get("ui") !== undefined, true);
});

test("valid session reaches Cloud REST without an unnecessary refresh", async () => {
  let requests = 0;
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "fresh", refresh_token: "refresh", expires_at: Date.now() + 3600000
  };
  const { context } = authContext({
    stored: { access_token: "fresh", refresh_token: "refresh", expires_at: Date.now() + 3600000 },
    rootSession,
    fetchImpl: async () => {
      requests += 1;
      return response(200, []);
    }
  });
  vm.runInContext(read("shared/api/repositories.js"), context, { filename: "repositories.js" });

  assert.deepEqual(await vm.runInContext("SupabaseRepository.select('user_profiles', '?select=*')", context), []);
  assert.equal(requests, 1);
});

test("Cloud REST stops after refresh failure without a second refresh or REST retry", async () => {
  const calls = [];
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired", refresh_token: "invalid-refresh", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "invalid-refresh", expires_at: 1 },
    rootSession,
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).includes("/auth/v1/token")) return response(400, { error_code: "invalid_refresh_token", msg: "Invalid Refresh Token" });
      return response(401, { code: "PGRST303", message: "JWT expired" });
    }
  });
  vm.runInContext(read("shared/api/repositories.js"), context, { filename: "repositories.js" });

  await assert.rejects(
    vm.runInContext("SupabaseRepository.select('user_profiles', '?select=*')", context),
    error => error.code === "AUTH_SESSION_EXPIRED"
  );
  assert.equal(calls.filter(url => url.includes("/auth/v1/token")).length, 1);
  assert.equal(calls.filter(url => url.includes("/rest/v1/")).length, 1);
  assert.equal(context.session, null);
  assert.equal(values.get("auth"), undefined);
  assert.equal(values.get("ui"), undefined);
});

test("a new login session restores Cloud REST after stale session cleanup", async () => {
  const calls = [];
  const rootSession = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "expired", refresh_token: "reused", expires_at: 1
  };
  const { context, values } = authContext({
    stored: { access_token: "expired", refresh_token: "reused", expires_at: 1 },
    rootSession,
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).includes("/auth/v1/token")) return response(400, { error_code: "refresh_token_already_used" });
      return response(200, []);
    }
  });

  assert.equal(await vm.runInContext("getAuthSession()", context), null);
  vm.runInContext("authSessionFromResponse({ access_token: 'relogin-access', refresh_token: 'relogin-refresh', expires_in: 3600 }, 'google-oauth')", context);
  context.session = {
    provider: "google-oauth", user_uuid: "u1", email: "user@example.test",
    access_token: "relogin-access", refresh_token: "relogin-refresh", expires_at: Date.now() + 3600000
  };
  vm.runInContext(read("shared/api/repositories.js"), context, { filename: "repositories.js" });

  assert.deepEqual(await vm.runInContext("SupabaseRepository.select('user_profiles', '?select=*')", context), []);
  assert.equal(calls.filter(url => url.includes("/auth/v1/token")).length, 1);
  assert.equal(calls.filter(url => url.includes("/rest/v1/")).length, 1);
  assert.equal(values.get("auth") !== undefined, true);
  assert.equal(context.session.access_token, "relogin-access");
});
