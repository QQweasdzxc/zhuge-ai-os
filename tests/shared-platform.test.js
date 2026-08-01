const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const Identity = require("../shared/identity/identity-service.js");
const Session = require("../shared/auth/session-service.js");
const Permissions = require("../shared/security/permission-service.js");
const Security = require("../shared/security/security-gate.js");
const ModuleContext = require("../shared/services/module-context.js");
const SharedPlatform = require("../shared/services/shared-platform.js");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

function authenticatedSession(overrides = {}) {
  return {
    user_uuid: USER_ID,
    email: "owner@example.com",
    name: "Owner",
    avatarUrl: "https://example.com/avatar.png",
    provider: "google-oauth",
    access_token: "secret-access-token",
    refresh_token: "secret-refresh-token",
    provider_token: "secret-provider-token",
    expires_at: 4102444800000,
    aal: "aal1",
    ...overrides
  };
}

test("identity normalizes the Supabase Auth UUID without exposing session fields", () => {
  const identity = Identity.normalize(authenticatedSession());
  assert.equal(identity.userId, USER_ID);
  assert.equal(identity.displayName, "Owner");
  assert.equal(identity.isAuthenticated, true);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal("access_token" in identity, false);
  assert.equal("provider_token" in identity, false);
});

test("session service returns a redacted immutable snapshot", () => {
  const service = Session.createSessionService({ readSession: () => authenticatedSession() });
  const snapshot = service.getSnapshot();
  assert.equal(snapshot.status, "authenticated");
  assert.equal(snapshot.aal, "aal1");
  assert.equal(snapshot.identity.userId, USER_ID);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal("access_token" in snapshot, false);
  assert.equal("refresh_token" in snapshot, false);
  assert.equal("provider_token" in snapshot, false);
});

test("session service accepts the existing auth user plus authSession adapter shape", () => {
  const service = Session.createSessionService({
    readSession: () => ({
      user: {
        id: USER_ID,
        email: "owner@example.com",
        user_metadata: { full_name: "Owner" }
      },
      authSession: {
        access_token: "secret-access-token",
        expires_at: 4102444800,
        aal: "aal2"
      }
    })
  });
  const snapshot = service.getSnapshot();
  assert.equal(snapshot.identity.userId, USER_ID);
  assert.equal(snapshot.aal, "aal2");
  assert.equal(snapshot.isAuthenticated, true);
});

test("expired sessions cannot produce an authenticated module identity", () => {
  const service = Session.createSessionService({
    readSession: () => authenticatedSession({ expires_at: 1000 }),
    now: () => 2000000
  });
  const snapshot = service.getSnapshot();
  assert.equal(snapshot.status, "expired");
  assert.equal(snapshot.isAuthenticated, false);
  assert.throws(() => service.getCurrentUserId(), error => error.code === "IDENTITY_REQUIRED");
});

test("security gate denies unknown modules and requires configured assurance", () => {
  let current = authenticatedSession();
  const sessionService = Session.createSessionService({ readSession: () => current });
  const permissionService = Permissions.createPermissionService({ capabilities: ["investment.read", "investment.trade"] });
  const gate = Security.createSecurityGate({
    sessionService,
    permissionService,
    policies: {
      "investment.view": { capability: "investment.read", requiredAal: "aal1" },
      "investment.trade": { capability: "investment.trade", requiredAal: "aal2" }
    }
  });

  assert.equal(gate.evaluate({ moduleId: "unknown", action: "view" }).code, "MODULE_NOT_REGISTERED");
  assert.equal(gate.evaluate({ moduleId: "investment", action: "view" }).allowed, true);
  assert.equal(gate.evaluate({ moduleId: "investment", action: "trade" }).code, "STEP_UP_REQUIRED");

  current = authenticatedSession({ aal: "aal2" });
  assert.equal(gate.evaluate({ moduleId: "investment", action: "trade" }).allowed, true);
});

test("canonical module security levels cannot be lowered or overridden", () => {
  const sessionService = Session.createSessionService({ readSession: () => authenticatedSession() });
  assert.throws(
    () => Security.createSecurityGate({ sessionService, levels: { investment: 1 } }),
    /cannot be overridden/
  );
});

test("module context exposes only redacted identity, session, and security APIs", () => {
  const sessionService = Session.createSessionService({ readSession: () => authenticatedSession() });
  const gate = Security.createSecurityGate({ sessionService });
  const context = ModuleContext.createModuleContext({ moduleId: "investment", sessionService, securityGate: gate });

  assert.deepEqual(Object.keys(context).sort(), ["identity", "moduleId", "security", "session"]);
  assert.equal(context.identity.getUserId(), USER_ID);
  assert.equal(context.security.can("view"), true);
  assert.equal(context.security.evaluate("view").code, "ALLOWED");
  assert.equal("signInWithOAuth" in context.session, false);
  assert.equal("getAccessToken" in context.session, false);
});

test("shared platform creates an Investment context without Supabase Auth coupling", () => {
  const platform = SharedPlatform.createSharedPlatform({
    readSession: () => authenticatedSession(),
    capabilities: ["investment.read"],
    policies: { "investment.view": { capability: "investment.read" } }
  });
  const investment = platform.forModule("investment");

  assert.equal(investment.identity.getCurrent().email, "owner@example.com");
  assert.equal(investment.security.require("view").allowed, true);
  assert.equal("supabase" in investment, false);
  assert.equal("oauth" in investment, false);
});

test("classic browser scripts compose in the documented Shared Platform load order", () => {
  const context = vm.createContext({ console, Date, URL, Object, Set, Error, TypeError });
  const files = [
    "shared/identity/identity-service.js",
    "shared/auth/session-service.js",
    "shared/security/permission-service.js",
    "shared/security/security-gate.js",
    "shared/services/module-context.js",
    "shared/services/shared-platform.js"
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  const platform = context.ZhugeSharedPlatform.createSharedPlatform({
    readSession: () => authenticatedSession()
  });
  assert.equal(platform.forModule("investment").identity.getUserId(), USER_ID);
});
