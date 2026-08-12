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
const Mfa = require("../shared/security/mfa-service.js");

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

test("Investment requires AAL2 and a module unlock while Dashboard and WorkLog remain available", () => {
  let current = authenticatedSession({ aal: "aal1" });
  let locked = true;
  const sessionService = Session.createSessionService({ readSession: () => current });
  const gate = Security.createSecurityGate({
    sessionService,
    policies: { "investment.view": { requiredAal: "aal2" } },
    readSecurityState: ({ moduleId }) => ({ locked: moduleId === "investment" && locked })
  });

  assert.equal(gate.evaluate({ moduleId: "dashboard", action: "view" }).allowed, true);
  assert.equal(gate.evaluate({ moduleId: "worklog", action: "view" }).allowed, true);
  assert.equal(gate.evaluate({ moduleId: "investment", action: "view" }).code, "STEP_UP_REQUIRED");
  current = authenticatedSession({ aal: "aal2" });
  assert.equal(gate.evaluate({ moduleId: "investment", action: "view" }).code, "MODULE_LOCKED");
  locked = false;
  assert.equal(gate.evaluate({ moduleId: "investment", action: "view" }).allowed, true);
});

test("Shared MFA supports TOTP, keeps future providers, and expires Investment unlock after 10 minutes", async () => {
  let clock = 1000;
  let verified = false;
  let staleRemoved = false;
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const auth = {
    mfa: {
      listFactors: async () => ({ data: { totp: [{ id: "factor-1", factor_type: "totp", status: "verified" }], all: [{ id: "stale-1", factor_type: "totp", status: "unverified" }] }, error: null }),
      unenroll: async ({ factorId }) => {
        staleRemoved = factorId === "stale-1";
        return { error: null };
      },
      enroll: async () => ({ data: { id: "factor-2", totp: { qr_code: "data:image/svg+xml,test", secret: "SECRET" } }, error: null }),
      challengeAndVerify: async ({ factorId, code }) => {
        verified = factorId === "factor-1" && code === "123456";
        return { error: verified ? null : new Error("invalid code") };
      }
    }
  };
  const service = Mfa.createMfaService({
    gateway: { getAuthClient: async () => ({ auth }), syncCanonicalSession: async () => ({}) },
    now: () => clock,
    unlockDurationMs: 10 * 60 * 1000,
    storage
  });

  assert.equal(service.providers().totp.available, true);
  assert.equal(service.providers().emailOtp.available, false);
  assert.equal(service.providers().passkey.available, false);
  assert.deepEqual(await service.prepare(), { mode: "challenge", provider: "totp", factorId: "factor-1", friendlyName: "Google Authenticator" });
  assert.equal((await service.enroll()).factorId, "factor-2");
  assert.equal(staleRemoved, true);
  await service.verify({ moduleId: "investment", userId: USER_ID, factorId: "factor-1", code: "123456" });
  assert.equal(verified, true);
  assert.equal(service.getUnlockState("investment", USER_ID).unlocked, true);
  clock += 10 * 60 * 1000 + 1;
  assert.equal(service.getUnlockState("investment", USER_ID).unlocked, false);
});

test("canonical module security levels cannot be lowered or overridden", () => {
  const sessionService = Session.createSessionService({ readSession: () => authenticatedSession() });
  assert.throws(
    () => Security.createSecurityGate({ sessionService, levels: { investment: 1 } }),
    /cannot be overridden/
  );
});

test("module context exposes only redacted identity, session, and security APIs", async () => {
  const sessionService = Session.createSessionService({ readSession: () => authenticatedSession() });
  const gate = Security.createSecurityGate({ sessionService });
  const context = ModuleContext.createModuleContext({ moduleId: "investment", sessionService, securityGate: gate });

  assert.deepEqual(Object.keys(context).sort(), ["data", "identity", "moduleId", "security", "session"]);
  assert.equal(context.identity.getUserId(), USER_ID);
  assert.equal(context.security.can("view"), true);
  assert.equal(context.security.evaluate("view").code, "ALLOWED");
  assert.equal("signInWithOAuth" in context.session, false);
  assert.equal("getAccessToken" in context.session, false);
  await assert.rejects(async () => context.data.select("portfolios"), /Data Gateway/);
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
