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
const SupabaseRepository = require("../../modules/investment/services/supabase-investment-repository.js");
const Calculation = require("../../modules/investment/services/portfolio-calculation-service.js");

function authenticatedSession() {
  return {
    user_uuid: USER_ID,
    email: "owner@example.com",
    name: "Owner",
    provider: "google",
    expires_at: 4102444800000,
    aal: "aal2"
  };
}

function investmentDataGateway() {
  const calls = [];
  const rows = {
    app_users: [{ id: "legacy-owner-1", display_name: "Owner", email: "owner@example.com" }],
    portfolios: [{ id: "portfolio-1", name: "主要投資組合", base_currency: "TWD", is_default: true }],
    opening_positions: [
      { id: "tw-1", portfolio_id: "portfolio-1", symbol: "2330", name: "台積電", market: "TW", asset_type: "stock", quantity: 10, avg_cost: 900, invested_cost: 9000, last_price: 950, market_value: 9500, unrealized_pnl: 500, unrealized_pct: 5.56, currency: "TWD" },
      { id: "us-1", portfolio_id: "portfolio-1", symbol: "MSFT", name: "Microsoft", market: "US", asset_type: "stock", quantity: 2, avg_cost: 400, invested_cost: 800, last_price: 420, market_value: 840, unrealized_pnl: 40, unrealized_pct: 5, currency: "USD" }
    ],
    transactions: [{ id: "transaction-1", portfolio_id: "portfolio-1", trade_date: "2026-08-01", trade_type: "BUY", symbol: "2330", name: "台積電", market: "TW", quantity: 10, price: 900, net_amount: 9000, currency: "TWD" }],
    watchlists: [{ id: "watch-1", portfolio_id: "portfolio-1", symbol: "0050", name: "元大台灣50", market: "TW", status: "觀察", research_theme: "大型權值", reason: "長期配置", importance: 1 }],
    strategies: [{ id: "strategy-1", portfolio_id: "portfolio-1", symbol: "2330", name: "台積電", strategy_type: "分批布局", decision_status: "觀察", target_price: 1000, support_price: 900, pressure_price: 980, strategist_note: "等待合理價格" }],
    user_settings: [{ setting_key: "base_currency", setting_value: "TWD" }]
  };
  return {
    calls,
    async select(table, query) {
      calls.push({ table, query });
      return rows[table] || [];
    }
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
    policies: PlatformPolicy.policies,
    dataGateway: investmentDataGateway()
  });
  const context = platform.forModule("investment");

  assert.equal(context.identity.getUserId(), USER_ID);
  assert.equal(context.session.getSnapshot().identity.email, "owner@example.com");
  assert.equal(context.security.require("view").level, 3);
  assert.deepEqual(Object.keys(context).sort(), ["creator", "data", "identity", "moduleId", "security", "session"]);
  assert.equal("supabase" in context, false);
  assert.equal("oauth" in context, false);
});

test("Supabase Repository maps Shared UUID to the legacy owner and reads only owner-scoped cloud rows", async () => {
  const data = investmentDataGateway();
  const repository = RepositoryContract.assertRepository(SupabaseRepository.create({ userId: USER_ID, data }));
  const values = await Promise.all([
    repository.loadPortfolio(),
    repository.loadPositions(),
    repository.loadTransactions(),
    repository.loadWatchlist(),
    repository.loadStrategies(),
    repository.loadSettings()
  ]);
  const [portfolio, positions, transactions, watchlist, strategies, settings] = values;

  assert.equal(repository.mode, "cloud");
  assert.equal(portfolio.userId, USER_ID);
  assert.equal(settings.userId, USER_ID);
  assert.equal(positions.length, 2);
  assert.equal(transactions.length, 1);
  assert.equal(watchlist.length, 1);
  assert.equal(strategies.length, 1);
  for (const row of [...positions, ...transactions, ...watchlist, ...strategies]) {
    assert.equal(row.userId, USER_ID);
  }
  assert.equal(data.calls.filter(call => call.table === "app_users").length, 1);
  assert.match(data.calls.find(call => call.table === "app_users").query, new RegExp(`auth_user_id=eq\\.${USER_ID}`));
  for (const call of data.calls.filter(call => call.table !== "app_users")) {
    assert.match(call.query, /user_id=eq\.legacy-owner-1/);
  }
});

test("Portfolio calculation keeps TWD and USD totals independent", async () => {
  const repository = SupabaseRepository.create({ userId: USER_ID, data: investmentDataGateway() });
  const positions = await repository.loadPositions();
  const summary = Calculation.summarize(positions);

  assert.equal(summary.assetCount, 2);
  assert.equal(summary.tw.count, 1);
  assert.equal(summary.us.count, 1);
  assert.equal(summary.tw.value, 9500);
  assert.equal(summary.tw.pnl, 500);
  assert.equal(summary.us.value, 840);
  assert.ok(summary.us.pnl > 0);
  assert.equal(Calculation.classify({ unrealizedPnl: -1 }), "loss");
  assert.equal(Calculation.classify({ unrealizedPnl: 1 }), "gain");
});

test("Investment exposes the required SIT pages and standard folders", () => {
  assert.deepEqual(Config.pages, ["overview", "portfolio", "strategy", "settings", "import"]);
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
  assert.match(entry, /shared\/supabase\/supabase-gateway\.js/);
  assert.match(entry, /shared\/security\/mfa-service\.js/);
  assert.doesNotMatch(entry, /supabase-js|@supabase/i);
});

test("Investment UI is Traditional Chinese and no longer exposes engineering or mock status", () => {
  const directory = path.join(ROOT, "modules", "investment");
  const uiSources = walk(directory)
    .filter(file => /\/(?:pages|components)\/.+\.js$/.test(file) || /\/services\/investment-module\.js$/.test(file))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");

  for (const forbidden of ["Shared Session", "Security Gate", "Mock Data", "Module Version", "INVESTMENT SIT", "Unknown error"]) {
    assert.equal(uiSources.includes(forbidden), false);
  }
  assert.equal(uiSources.includes("AAL1"), false);
  assert.equal(uiSources.includes("AAL2"), false);
  for (const expected of ["投資首頁", "投資組合", "投資策略", "偏好設定", "解鎖投資模組"]) {
    assert.equal(uiSources.includes(expected), true);
  }
  assert.equal(uiSources.includes("觀察清單｜追蹤關注中的市場標的"), false);
  const ivtkAdapter = fs.readFileSync(path.join(directory, "services", "ivtk-board-adapter.js"), "utf8");
  assert.equal(ivtkAdapter.includes("觀察名單"), true);
  const entry = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  assert.doesNotMatch(entry, /pages\/watchlist-page\.js/);
});

test("both Dashboard presentations link to the Investment module without router changes", () => {
  const staticDashboard = fs.readFileSync(path.join(ROOT, "app", "dashboard", "index.html"), "utf8");
  const runtimeDashboard = fs.readFileSync(path.join(ROOT, "app", "dashboard", "zhuge-dashboard.js"), "utf8");
  const router = fs.readFileSync(path.join(ROOT, "app", "router", "index.js"), "utf8");

  assert.match(staticDashboard, /href="\.\.\/\.\.\/modules\/investment\/"/);
  assert.match(runtimeDashboard, /\["investment",/);
  assert.match(router, /investment:\s*"modules\/investment\/"/);
});
