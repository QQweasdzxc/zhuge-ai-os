import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createReadOnlyPortfolioAdapter, PortfolioReadError, researchSymbolFor } from "../src/portfolio/readonly-adapter.mjs";
import { createUnconnectedResearch } from "../src/portfolio/research-placeholder.mjs";
import { renderPortfolioCard, renderPortfolioResearchContext, renderPortfolioSection, renderPortfolioMiniChart } from "../src/portfolio/view.mjs";

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
    "status", "symbol", "unrealizedPct", "unrealizedPnl", "venue",
  ].sort());
  assert.equal(position.researchSymbol, "0050");
  assert.equal(position.venue, "");
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
  assert.match(calls[2].query, /position_status=eq.current&quantity=gt.0/);
  assert.doesNotMatch(calls[2].query, /account|raw_broker_values|source_id=/);
});

test("Taiwan portfolio symbols are resolved only by an explicit venue or authenticated catalog", () => {
  assert.equal(researchSymbolFor({ symbol: "9876", market: "TW" }), "9876");
  assert.equal(researchSymbolFor({ symbol: "9876", market: "TW", venue: "TWSE" }), "9876.TW");
  assert.equal(researchSymbolFor({ symbol: "9876", market: "TW", venue: "TPEX" }), "9876.TWO");
  assert.equal(researchSymbolFor({ symbol: "NVDA", market: "US" }), "NVDA");
});

test("canonical watchlist is owner-scoped and exposes only the requested research fields", async () => {
  const { adapter, calls } = fakeRuntime({ responses: {
    ...baseResponses(),
    watchlists: [{ id: "watch-1", symbol: "0050", name: "元大台灣50", market: "TW", status: "active", research_theme: "大型權值", reason: "長期配置", importance: 1, updated_at: "2026-10-06T08:00:00Z", user_id: "must-not-leak" }],
  } });
  const result = await adapter.loadWatchlist();
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.source, "watchlists");
  assert.deepEqual(result.items[0], {
    id: "watch-1", symbol: "0050", name: "元大台灣50", market: "TW", status: "active",
    researchTheme: "大型權值", reason: "長期配置", importance: 1, updatedAt: "2026-10-06T08:00:00.000Z",
  });
  const query = calls.find(call => call.resource === "watchlists");
  assert.match(query.query, /user_id=eq.test-owner-id/);
  assert.match(query.query, /select=id,symbol,name,market,status,research_theme,reason,importance,updated_at/);
  assert.ok(calls.every(call => call.method === "select"));
});

test("closed history comes from history rows of the canonical positions view only", async () => {
  const { adapter, calls } = fakeRuntime({ responses: {
    ...baseResponses(),
    investment_current_positions_view: [
      { source_kind: "transaction", symbol: "2330", name: "台積電", market: "TW", currency: "TWD", realized_pnl: "1250.5", effective_at: "2026-09-30T08:00:00Z", position_status: "history" },
      { source_kind: "opening_position", symbol: "0050", name: "元大台灣50", market: "TW", currency: "TWD", realized_pnl: "0", position_status: "current" },
    ],
  } });
  const result = await adapter.loadClosedHistory();
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.source, "investment_current_positions_view");
  assert.deepEqual(result.items, [{
    symbol: "2330", sourceId: "", name: "台積電", market: "TW", currency: "TWD", realizedPnl: 1250.5,
    effectiveAt: "2026-09-30T08:00:00.000Z", sourceKind: "transaction",
  }]);
  const query = calls.find(call => call.resource === "investment_current_positions_view");
  assert.match(query.query, /select=source_kind,source_id,symbol/);
  assert.match(query.query, /user_id=eq.test-owner-id&portfolio_id=eq.test-portfolio-id&position_status=eq.history/);
  assert.ok(calls.every(call => call.method === "select"));
});

test("watchlist and closed-history reads preserve the existing session, App Access and MFA gates", async () => {
  for (const scenario of [{ authenticated: false, code: "SESSION_REQUIRED" }, { approved: false, code: "APP_ACCESS_REQUIRED" }, { permitted: false, code: "MFA_REQUIRED" }]) {
    const { adapter, calls } = fakeRuntime(scenario);
    await assert.rejects(adapter.loadWatchlist(), error => error.code === scenario.code);
    await assert.rejects(adapter.loadClosedHistory(), error => error.code === scenario.code);
    assert.deepEqual(calls, []);
  }
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

test("empty current-position projection stays empty and never falls back to snapshots", async () => {
  const { adapter, calls } = fakeRuntime({ responses: {
    ...baseResponses([]),
    broker_position_snapshots: [{ id: "must-not-read", snapshot_at: "2026-09-30T16:00:00Z", position_count: 1 }],
    current_broker_positions_view: [{ ...current0050, snapshot_id: "must-not-read", item_id: "must-not-read" }],
  } });
  const result = await adapter.load();
  assert.equal(result.status, "EMPTY");
  assert.deepEqual(result.positions, []);
  assert.deepEqual(calls.map(call => call.resource), ["app_users", "portfolios", "investment_current_positions_view"]);
  assert.ok(calls.every(call => call.method === "select"));
});

test("adapter exposes no write capability and only canonical view resources", async () => {
  const { adapter, calls } = fakeRuntime({ responses: baseResponses([]) });
  await adapter.load();
  assert.deepEqual(Object.keys(adapter).sort(), [
    "assertReadAccess", "load", "loadClosedHistory", "loadClosedPositions", "loadCurrentPositions", "loadTransactions", "loadWatchlist",
  ]);
  assert.equal(adapter.load, adapter.loadCurrentPositions);
  assert.equal(adapter.loadClosedHistory, adapter.loadClosedPositions);
  assert.ok(calls.every(call => call.method === "select"));

  const source = await readFile(new URL("../src/portfolio/readonly-adapter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
  assert.doesNotMatch(source, /broker_position_snapshots|current_broker_positions_view/);
});

test("transactions are an optional owner-scoped read-only detail source", async () => {
  const { adapter, calls } = fakeRuntime({ responses: {
    ...baseResponses(),
    transactions: [{
      id: "tx-1", portfolio_id: PORTFOLIO_ID, trade_date: "2026-09-30", trade_type: "buy",
      symbol: "2330", name: "台積電", market: "TW", quantity: "10", price: "100",
      gross_amount: "1000", fee: "1", tax: "0", net_amount: "1001", currency: "TWD",
      source: "statement", note: "evidence", created_at: "2026-10-01T00:00:00Z", user_id: "must-not-leak",
    }],
  } });
  const result = await adapter.loadTransactions({ symbol: "2330.TW", market: "TW", limit: 500 });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.items[0].id, "tx-1");
  assert.equal(result.items[0].symbol, "2330");
  assert.equal(result.items[0].netAmount, 1001);
  assert.equal(Object.hasOwn(result.items[0], "user_id"), false);
  const query = calls.find(call => call.resource === "transactions");
  assert.match(query.query, /user_id=eq.test-owner-id&portfolio_id=eq.test-portfolio-id&symbol=eq.2330/);
  assert.match(query.query, /market=eq.TW/);
  assert.match(query.query, /limit=200/);
  assert.ok(calls.every(call => call.method === "select"));
});

test("read authorization can be checked without introducing a mutation path", async () => {
  const { adapter, calls } = fakeRuntime({ responses: baseResponses([]) });
  assert.equal(await adapter.assertReadAccess(), true);
  assert.deepEqual(calls.map(call => call.resource), ["app_users", "portfolios"]);
  assert.ok(calls.every(call => call.method === "select"));
});

test("transaction lookup requires market identity and never queries a bare ticker across markets", async () => {
  const { adapter, calls } = fakeRuntime({ responses: { ...baseResponses(), transactions: [] } });
  await assert.rejects(adapter.loadTransactions({ symbol: "1234" }), error => error.code === "MARKET_IDENTITY_REQUIRED");
  assert.deepEqual(calls, []);
  await adapter.loadTransactions({ symbol: "1234", market: "US" });
  const query = calls.find(call => call.resource === "transactions");
  assert.match(query.query, /symbol=eq.1234&market=eq.US/);
});

test("card and research context render missing values as dashes and contain no trading instruction", () => {
  const card = renderPortfolioCard({
    symbol: "AAPL", researchSymbol: "AAPL", name: "Apple", marketLabel: "US", currency: "USD",
    quantity: 4, averageCost: 100, investedCost: null, lastPrice: null, marketValue: null,
    unrealizedPnl: null, unrealizedPct: null, asOf: null, status: "PARTIAL",
  });
  assert.match(card, /data-action="portfolio-research" data-market="US".*data-symbol="AAPL"/);
  assert.match(card, /持股估值／非即時<\/dt><dd>—/);
  assert.match(card, /effective_at/);
  assert.match(card, /market_value_source/);
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

test("portfolio research action fails closed when canonical market identity is unresolved", () => {
  const card = renderPortfolioCard({
    symbol: "1234", researchSymbol: "1234", name: "Unknown-market asset", market: "OTHER",
    marketLabel: "市場未提供", quantity: 1, status: "PARTIAL",
  });
  assert.match(card, /市場身分未確認/);
  assert.doesNotMatch(card, /data-action="portfolio-research"/);
  assert.doesNotMatch(card, /data-market="TW"/);
});

test("generic research placeholder remains fail-closed when no provider has been selected", async () => {
  const result = createUnconnectedResearch({ symbol: "AAPL", market: "US", name: "Apple" });
  assert.equal(result.quote.status, "NOT_CONNECTED");
  assert.equal(result.quote.data, null);
  assert.equal(result.quote.errorCode, "NOT_CONNECTED");
  assert.match(result.gaps[0].note, /尚無已核實且可用的 Lab Provider/);
  assert.equal(result.history.data, null);
});

test("portfolio card uses the shared 20-bar candlestick chart, actual volume, and canonical average-cost reference", () => {
  const bars = Array.from({ length: 25 }, (_, index) => {
    const close = 50 + index;
    const open = close - 0.5;
    return { date: `2026-09-${String(index + 1).padStart(2, "0")}`, open, high: close + 1, low: open - 1, close, volume: index * 100 };
  });
  const card = renderPortfolioCard({
    symbol: "0050", researchSymbol: "0050.TW", name: "元大台灣50", marketLabel: "TW", currency: "TWD",
    quantity: 709, averageCost: 65, status: "AVAILABLE",
  }, {
    status: "AVAILABLE", provider: "TWSE", dataTruth: "OFFICIAL", dataTimestamp: "2026-10-01",
    fetchedAt: "2026-10-01T09:00:00.000Z", delayed: true, stale: false, fallback: false, data: bars,
  });

  assert.match(card, /近 20 日 K 線/);
  assert.match(card, /NT\$65/);
  assert.match(card, /data-mode="portfolio" data-chart-type="candlestick"/);
  assert.match(card, /data-bar-count="20"/);
  assert.equal((card.match(/data-candle="true"/g) || []).length, 20);
  assert.equal((card.match(/data-volume-bar="true"/g) || []).length, 20);
  assert.match(card, /data-has-cost-reference="true"/);
  assert.match(card, /data-average-cost-reference="true"/);
  assert.match(card, /data-candle-index="19" data-latest-point="true"/);
  assert.match(card, /TWSE · 2026-10-01 · 延遲收盤 · 時效正常 · Fallback：否/);
});

test("missing average cost omits the reference line without estimating a replacement", () => {
  const evidence = {
    status: "AVAILABLE", provider: "TWSE", dataTimestamp: "2026-10-01", delayed: true, stale: false,
    fallback: false, data: [{ date: "2026-09-30", close: 100 }, { date: "2026-10-01", close: 101 }],
  };
  const card = renderPortfolioCard({ symbol: "2330", researchSymbol: "2330.TW", name: "台積電", currency: "TWD", averageCost: null }, evidence);
  assert.match(card, /data-has-cost-reference="false"/);
  assert.doesNotMatch(card, /data-average-cost-reference="true"/);
  assert.match(card, /data-chart-type="close-line"/);
  assert.match(card, /PARTIAL_HISTORY/);
  assert.match(card, /平均成本／股<\/dt><dd>—/);
});

test("unconnected and unavailable history render truthful empty states, never a synthetic path", () => {
  const notConnected = renderPortfolioMiniChart({ averageCost: 65, currency: "TWD" }, {
    status: "NOT_CONNECTED", provider: "TPEx", errorCode: "HISTORY_NOT_CONNECTED", delayed: true, fallback: false, data: null,
  });
  assert.match(notConnected, /尚無已驗證的官方歷史行情來源/);
  assert.match(notConnected, /NOT_CONNECTED/);
  assert.match(notConnected, /TPEx/);
  assert.doesNotMatch(notConnected, /<svg|<path|data-average-cost-reference="true"/);

  const unavailable = renderPortfolioMiniChart({}, { status: "UNAVAILABLE", provider: "TWSE", errorCode: "TIMEOUT", data: null });
  assert.match(unavailable, /歷史行情暫時無法取得/);
  assert.match(unavailable, /TIMEOUT/);
  assert.doesNotMatch(unavailable, /<svg|<path/);
});

test("Lab exposes full Investment content navigation while preserving the canonical personal data sources", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/portfolio/readonly-adapter.mjs", import.meta.url), "utf8");
  const nav = html.match(/<nav class="lab-content-nav[\s\S]*?<\/nav>/)?.[0] || "";
  for (const view of ["overview", "scanner", "market", "holdings", "watchlist", "research", "chips", "technical", "backtest", "history"]) {
    assert.match(nav, new RegExp('data-view="' + view + '"'));
  }
  assert.equal((nav.match(/data-view=/g) || []).length, 10);
  assert.match(html, /data-symbol-search-form/);
  assert.match(html, /data-market-select/);
  assert.match(app, /InvestmentIntelligenceProviders\?\.create/);
  assert.match(app, /開放資料/);
  assert.match(app, /我的正式觀察名單/);
  assert.match(app, /本機暫存觀察/);
  assert.match(app, /我的平倉歷史/);
  assert.match(source, /"watchlists"/);
  assert.match(source, /position_status=eq\.history/);
  assert.match(source, /"transactions"/);
  assert.doesNotMatch(source, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
});
