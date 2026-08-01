const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

const Identity = require("../../shared/identity/identity-service.js");
const Session = require("../../shared/auth/session-service.js");
const Permissions = require("../../shared/security/permission-service.js");
const Security = require("../../shared/security/security-gate.js");
const ModuleContext = require("../../shared/services/module-context.js");
const SharedPlatform = require("../../shared/services/shared-platform.js");
const PlatformPolicy = require("../../shared/security/platform-policy.js");

require("../../modules/investment/models/portfolio.js");
require("../../modules/investment/models/position.js");
require("../../modules/investment/models/transaction.js");
require("../../modules/investment/models/watchlist-item.js");
require("../../modules/investment/models/strategy.js");
require("../../modules/investment/models/settings.js");

const Config = require("../../modules/investment/config/module-config.js");
const RepositoryContract = require("../../modules/investment/services/investment-repository.js");
const MockRepository = require("../../modules/investment/services/mock-investment-repository.js");
const Calculation = require("../../modules/investment/services/portfolio-calculation-service.js");

function authenticatedSession() {
  return {
    user_uuid: USER_ID,
    email: "owner@example.com",
    name: "Owner",
    provider: "google",
    expires_at: 4102444800000,
    aal: "aal1"
  };
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

test("Investment is registered as a Level 3 Shared Platform module", () => {
  const platform = SharedPlatform.createSharedPlatform({
    readSession: authenticatedSession,
    capabilities: PlatformPolicy.capabilities,
    policies: PlatformPolicy.policies
  });
  const context = platform.forModule("investment");

  assert.equal(context.identity.getUserId(), USER_ID);
  assert.equal(context.session.getSnapshot().identity.email, "owner@example.com");
  assert.equal(context.security.require("view").level, 3);
  assert.deepEqual(Object.keys(context).sort(), ["identity", "moduleId", "security", "session"]);
  assert.equal("supabase" in context, false);
  assert.equal("oauth" in context, false);
});

test("Mock Repository implements the contract and scopes every record to Shared UUID", async () => {
  const repository = RepositoryContract.assertRepository(MockRepository.create({ userId: USER_ID }));
  const values = await Promise.all([
    repository.loadPortfolio(),
    repository.loadPositions(),
    repository.loadTransactions(),
    repository.loadWatchlist(),
    repository.loadStrategies(),
    repository.loadSettings()
  ]);
  const [portfolio, positions, transactions, watchlist, strategies, settings] = values;

  assert.equal(repository.mode, "mock");
  assert.equal(portfolio.userId, USER_ID);
  assert.equal(settings.userId, USER_ID);
  assert.equal(positions.length, 6);
  assert.equal(transactions.length, 3);
  assert.equal(watchlist.length, 3);
  assert.equal(strategies.length, 2);
  for (const row of [...positions, ...transactions, ...watchlist, ...strategies]) {
    assert.equal(row.userId, USER_ID);
  }
});

test("Portfolio calculation keeps TWD and USD totals independent", async () => {
  const repository = MockRepository.create({ userId: USER_ID });
  const positions = await repository.loadPositions();
  const summary = Calculation.summarize(positions);

  assert.equal(summary.assetCount, 6);
  assert.equal(summary.tw.count, 3);
  assert.equal(summary.us.count, 3);
  assert.equal(summary.tw.value, 631680);
  assert.equal(summary.tw.pnl, 32840);
  assert.equal(summary.us.value, 13569);
  assert.ok(summary.us.pnl > 0);
  assert.equal(Calculation.classify({ unrealizedPnl: -1 }), "loss");
  assert.equal(Calculation.classify({ unrealizedPnl: 1 }), "gain");
});

test("Investment exposes the required SIT pages and standard folders", () => {
  assert.deepEqual(Config.pages, ["overview", "portfolio", "watchlist", "strategy", "settings"]);
  for (const folder of ["pages", "components", "services", "models", "store", "config", "assets", "utils"]) {
    assert.equal(fs.statSync(path.join(ROOT, "modules", "investment", folder)).isDirectory(), true);
  }
});

test("Investment source has no independent identity, storage, OAuth, or direct Supabase access", () => {
  const directory = path.join(ROOT, "modules", "investment");
  const sources = walk(directory)
    .filter(file => /\.(?:js|html)$/.test(file))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");

  for (const forbidden of [
    /signInWithOAuth\s*\(/,
    /supabase\.auth/,
    /createClient\s*\(/,
    /localStorage\.(?:getItem|setItem|removeItem)\s*\(/,
    /sessionStorage\.(?:getItem|setItem|removeItem)\s*\(/,
    /\/rest\/v1\//,
    /workspaceUser/i,
    /Workspace\s*001/i,
    /\bJackal\b/
  ]) {
    assert.doesNotMatch(sources, forbidden);
  }

  const entry = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  assert.match(entry, /shared\/services\/module-context\.js/);
  assert.match(entry, /shared\/auth\/runtime-session-provider\.js/);
  assert.doesNotMatch(entry, /shared\/auth\/auth-service\.js/);
  assert.doesNotMatch(entry, /supabase-js|@supabase/i);
});

test("both Dashboard presentations link to the Investment module without router changes", () => {
  const staticDashboard = fs.readFileSync(path.join(ROOT, "app", "dashboard", "index.html"), "utf8");
  const runtimeDashboard = fs.readFileSync(path.join(ROOT, "app", "dashboard", "zhuge-dashboard.js"), "utf8");
  const router = fs.readFileSync(path.join(ROOT, "app", "router", "index.js"), "utf8");

  assert.match(staticDashboard, /href="\.\.\/\.\.\/modules\/investment\/"/);
  assert.match(runtimeDashboard, /href="\.\.\/investment\/"/);
  assert.match(router, /investment:\s*"modules\/investment\/"/);
});
