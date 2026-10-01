import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createReadOnlyPortfolioAdapter, PortfolioReadError } from "../src/portfolio/readonly-adapter.mjs";
import { createUnconnectedResearch } from "../src/portfolio/research-placeholder.mjs";
import { renderPortfolioCard, renderPortfolioResearchContext, renderPortfolioSection } from "../src/portfolio/view.mjs";

const OWNER_ID = "test-owner-id";
const AUTH_ID = "test-auth-id";
const PORTFOLIO_ID = "test-portfolio-id";

function fakeRuntime({ authenticated = true, approved = true, permitted = true, responses = {} } = {}) {
  const calls = [];
  const context = {
    data: Object.freeze({ select: async (resource, query) => {
      calls.push({ method: "select", resource, query });
      const response = responses[resource];
      if (response instanceof Error) throw response;
      return typeof response === "function" ? response(query) : response || [];
    } }),
    session: { getSnapshot: () => ({ isAuthenticated: authenticated }) },
    identity: { getUserId: () => AUTH_ID },
    creator: { resolve: async () => ({ status: "resolved", is_creator: false }) },
    security: {
      loadMfaPolicy: async () => ({ status: "ready" }),
      evaluate: () => ({ allowed: permitted, code: permitted ? "ALLOWED" : "STEP_UP_REQUIRED" }),
    },
  };
  const appAccess = { getCurrent: async () => ({ status: approved ? "APPROVED" : "PENDING" }) };
  const appAccessGate = { isApproved: value => value.status === "APPROVED" };
  return { adapter: createReadOnlyPortfolioAdapter({ context, appAccess, appAccessGate, now: () => new Date("2026-10-01T12:00:00Z") }), calls };
}

function baseResponses(positions = []) {
  return {
    app_users: [{ id: OWNER_ID }],
    portfolios: [{ id: PORTFOLIO_ID, is_default: true }],
    investment_current_positions_view: positions,
  };
}

const current0050 = {
  symbol: "0050", name: "元大台灣50", market: "TW", asset_type: "ETF", currency: "TWD",
  quantity: "709", avg_cost: "65.45", invested_cost: "46404.05", last_price: "68.25",
  market_value: "48389.25", unrealized_pnl: "1985.20", unrealized_pct: "4.278",
  effective_at: "2026-10-01T09:00:00+08:00", market_value_source: "transaction_calculated",
  position_status: "current",
};

test("unauthenticated and unapproved sessions fail closed before portfolio reads", async () => {
  const anonymous = fakeRuntime({ authenticated: false });
  await assert.rejects(anonymous.adapter.load(), error => error.code === "SESSION_REQUIRED");
  assert.deepEqual(anonymous.calls, []);

  const pending = fakeRuntime({ approved: false });
  await assert.rejects(pending.adapter.load(), error => error.code === "APP_ACCESS_REQUIRED");
  assert.deepEqual(pending.calls, []);

  const locked = fakeRuntime({ permitted: false });
  await assert.rejects(locked.adapter.load(), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(locked.calls, []);
});

test("canonical holdings use only the authenticated owner-scoped SELECT path and return redacted current positions", async () => {
  const history = { ...current0050, symbol: "2330", position_status: "history", quantity: "0" };
  const { adapter, calls } = fakeRuntime({ responses: baseResponses([current0050, history]) });
  const result = await adapter.load();

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.source, "Zhuge Investment Portfolio");
  assert.equal(result.positions.length, 1);
  const [position] = result.positions;
  assert.deepEqual(Object.keys(position).sort(), [
    "asOf", "assetType", "averageCost", "currency", "investedCost", "lastPrice", "market", "marketLabel",
    "marketValue", "marketValueSource", "name", "portfolioSource", "quantity", "researchSymbol", "snapshotKind",
    "status", "symbol", "unrealizedPct", "unrealizedPnl",
  ].sort());
  assert.equal(position.researchSymbol, "0050.TW");
  assert.equal(position.quantity, 709);
  assert.equal(position.lastPrice, 68.25);
  assert.equal(position.status, "AVAILABLE");
  assert.equal(position.marketValueSource, "依正式交易紀錄計算");
  assert.equal(Object.hasOwn(position, "account"), false);
  assert.equal(Object.hasOwn(position, "raw_broker_values"), false);
  assert.deepEqual(calls.map(call => call.resource), ["app_users", "portfolios", "investment_current_positions_view"]);
  assert.ok(calls.every(call => call.method === "select"));
  assert.match(calls[0].query, /select=id&auth_user_id=eq.test-auth-id/);
  assert.match(calls[1].query, /user_id=eq.test-owner-id/);
  assert.match(calls[2].query, /user_id=eq.test-owner-id&portfolio_id=eq.test-portfolio-id/);
  assert.doesNotMatch(calls[2].query, /account|raw_broker_values|source_id=/);
});

test("null and malformed canonical fields remain null and produce a partial status, never zero-fill", async () => {
  const partial = { ...current0050, last_price: null, market_value: "not-a-number", unrealized_pct: null };
  const { adapter } = fakeRuntime({ responses: baseResponses([partial]) });
  const result = await adapter.load();
  assert.equal(result.positions[0].lastPrice, null);
  assert.equal(result.positions[0].marketValue, null);
  assert.equal(result.positions[0].unrealizedPct, null);
  assert.equal(result.positions[0].status, "PARTIAL");
});

test("empty canonical projection uses only the formal confirmed-snapshot compatibility fallback", async () => {
  const responses = {
    ...baseResponses([]),
    broker_position_snapshots: [{ id: "test-snapshot-id", snapshot_at: "2026-09-30T16:00:00Z", position_count: 1 }],
    current_broker_positions_view: [{ ...current0050, snapshot_id: "test-snapshot-id", item_id: "test-item-id" }],
  };
  const { adapter, calls } = fakeRuntime({ responses });
  const result = await adapter.load();
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.positions[0].snapshotKind, "confirmed_snapshot_fallback");
  assert.equal(result.positions[0].asOf, "2026-09-30T16:00:00.000Z");
  assert.deepEqual(calls.map(call => call.resource), [
    "app_users", "portfolios", "investment_current_positions_view", "broker_position_snapshots", "current_broker_positions_view",
  ]);
  assert.ok(calls.every(call => call.method === "select"));
  assert.match(calls[3].query, /verification=eq.pm_confirmed/);
  assert.doesNotMatch(calls[4].query, /raw_broker_values|account/);
});

test("incomplete fallback snapshot fails closed and no write-shaped capability is used", async () => {
  const responses = {
    ...baseResponses([]),
    broker_position_snapshots: [{ id: "test-snapshot-id", snapshot_at: "2026-09-30T16:00:00Z", position_count: 2 }],
    current_broker_positions_view: [{ ...current0050, snapshot_id: "test-snapshot-id", item_id: "test-item-id" }],
  };
  const { adapter, calls } = fakeRuntime({ responses });
  await assert.rejects(adapter.load(), error => error.code === "SNAPSHOT_INCOMPLETE");
  assert.ok(calls.every(call => call.method === "select"));

  const source = await readFile(new URL("../src/portfolio/readonly-adapter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
});

test("card and research context render missing values as dashes and contain no trading instruction", () => {
  const card = renderPortfolioCard({
    symbol: "AAPL", researchSymbol: "AAPL", name: "Apple", marketLabel: "US", currency: "USD",
    quantity: 4, averageCost: 100, investedCost: null, lastPrice: null, marketValue: null,
    unrealizedPnl: null, unrealizedPct: null, asOf: null, status: "PARTIAL",
  });
  assert.match(card, /data-action="portfolio-research" data-symbol="AAPL"/);
  assert.match(card, /目前價格<\/dt><dd>—/);
  assert.match(card, /目前市值<\/dt><dd>—/);
  assert.match(card, /未實現損益<\/dt><dd class="neutral">—/);
  assert.doesNotMatch(card, /買進|賣出|加碼|減碼/);

  const context = renderPortfolioResearchContext({
    symbol: "0050", researchSymbol: "0050.TW", name: "元大台灣50", marketLabel: "TW", quantity: 709,
    averageCost: 65.45, unrealizedPnl: 12, unrealizedPct: null,
  });
  assert.match(context, /我的持股/);
  assert.match(context, /不代表加碼、減碼、買進或賣出建議/);
  assert.match(renderPortfolioSection({ status: "EMPTY", positions: [] }), /目前沒有可顯示的持股/);
});

test("unsupported US providers stay NOT_CONNECTED without fabricated values", async () => {
  const result = createUnconnectedResearch({ symbol: "AAPL", market: "US", name: "Apple" });
  assert.equal(result.quote.status, "NOT_CONNECTED");
  assert.equal(result.quote.data, null);
  assert.equal(result.quote.errorCode, "NOT_CONNECTED");
  assert.match(result.gaps[0].note, /尚無已核實且可用的 Lab Provider/);
  assert.equal(result.history.data, null);
});
