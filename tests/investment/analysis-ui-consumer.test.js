const test = require("node:test");
const assert = require("node:assert/strict");

const overview = require("../../modules/investment/pages/overview-page.js");
const analysis = require("../../modules/investment/services/investment-analysis-service.js");
const strategyLibrary = require("../../modules/investment/services/investment-strategy-library.js");

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function context(symbol, market, evidence, missing = [], strategyIds = ["ma_golden_cross"]) {
  return {
    contract: "zhuge-investment-context-pack-v1",
    symbol,
    market,
    generatedAt: "2026-09-18T15:00:00.000Z",
    marketPhase: market === "TW" ? { phase: "CLOSED", available: true } : { phase: "UNKNOWN", available: false },
    evidence,
    missing,
    strategyIds
  };
}

function renderState(contexts, analyses, strategies = []) {
  return overview.render({
    status: "ready",
    activePage: "overview",
    positions: [],
    watchlist: [],
    strategies,
    performance: null,
    todayFocus: [],
    marketEvents: [],
    intelligence: {
      status: "ready",
      quotes: [],
      fx: null,
      news: [],
      contexts,
      analyses,
      quality: {}
    }
  }, {
    escape,
    format: {
      currency: (value, currency) => `${currency} ${value}`,
      percent: value => `${value}%`,
      date: value => String(value || "")
    },
    calculation: {
      summarize: () => ({ assetCount: 0, twd: { count: 0 }, us: { count: 0 } })
    },
    positionCard: { render: () => "" }
  });
}

test("Investment homepage consumes symbol-specific Analysis without writing Strategy records", () => {
  const contexts = [
    context("2330", "TW", [
      { type: "market_quote", title: "2330 最新可用行情", summary: "2460 TWD", source: "TWSE", observedAt: "2026-09-18T06:30:00.000Z", freshness: "stale", stale: true, facts: ["price=2460"] },
      { type: "market_phase", title: "2330 市場階段", summary: "TWSE 交易時段判定為 CLOSED。", source: "TWSE", observedAt: "2026-09-18T15:00:00.000Z", freshness: "fresh", stale: false },
      { type: "technical", title: "2330 OHLC / 技術觀察", summary: "使用 118 筆歷史資料。", source: "TWSE", observedAt: "2026-09-17T16:00:00.000Z", freshness: "fresh", stale: false, facts: ["sma20=2400", "rsi14=55"] },
      { type: "fundamental", title: "2330 TWSE 公開財報資料", summary: "已取得公開財報資料。", source: "TWSE", observedAt: "2026-09-01", freshness: "fresh", stale: false },
      { type: "industry", title: "2330 台灣產業分類", summary: "產業分類已取得。", source: "TWSE", observedAt: "2026-09-01", freshness: "fresh", stale: false },
      { type: "news", title: "2330 公開消息", summary: "有可追溯消息。", source: "Public News", observedAt: "2026-09-18T08:00:00.000Z", freshness: "fresh", stale: false }
    ]),
    context("0050", "TW", [
      { type: "market_quote", title: "0050 最新可用行情", summary: "109.85 TWD", source: "TWSE", observedAt: "2026-09-18T06:30:00.000Z", freshness: "stale", stale: true },
      { type: "technical", title: "0050 OHLC / 技術觀察", summary: "使用 118 筆歷史資料。", source: "TWSE", observedAt: "2026-09-17T16:00:00.000Z", freshness: "fresh", stale: false }
    ], ["fundamental_evidence", "relationship_evidence"]),
    context("AAPL", "US", [
      { type: "market_quote", title: "AAPL 最新可用行情", summary: "333.475 USD", source: "Yahoo Finance Chart", observedAt: "2026-09-18T14:27:36.000Z", freshness: "fresh", stale: false },
      { type: "fx_benchmark", title: "USD/TWD 基準匯率", summary: "1 USD ≈ 31.86 TWD", source: "ExchangeRate-API", observedAt: "2026-09-18T00:02:31.000Z", freshness: "fresh", stale: false },
      { type: "technical", title: "AAPL OHLC / 技術觀察", summary: "使用 252 筆歷史資料。", source: "Yahoo Finance Chart", observedAt: "2026-09-18T13:30:00.000Z", freshness: "fresh", stale: false },
      { type: "fundamental", title: "AAPL SEC Company Facts", summary: "SEC 基本面資料已取得。", source: "SEC EDGAR", observedAt: "2026-09-17", freshness: "fresh", stale: false },
      { type: "industry", title: "AAPL SEC industry classification", summary: "SEC 產業分類已取得。", source: "SEC EDGAR", observedAt: "2026-09-17", freshness: "fresh", stale: false }
    ], ["news_search", "market_phase"])
  ];
  const analyses = contexts.map(item => analysis.enrichContextPack(item, { strategyLibrary }).analysis);
  const persisted = [{ title: "既有決策紀錄", decision: "觀望", evidence: "歷史 Evidence", reason: "保留原用途", updatedAt: "2026-09-18" }];
  const beforeStrategies = JSON.stringify(persisted);
  const markup = renderState(contexts, analyses, persisted);

  assert.match(markup, /data-investment-analysis-consumer/);
  assert.match(markup, /data-investment-analysis-symbol="2330"/);
  assert.match(markup, /data-investment-analysis-symbol="0050"/);
  assert.match(markup, /data-investment-analysis-symbol="AAPL"/);
  assert.match(markup, /發生什麼？/);
  assert.match(markup, /對我有什麼影響？/);
  assert.match(markup, /接下來觀察什麼？/);
  assert.match(markup, /為什麼？/);
  assert.match(markup, /目前資料還不夠，諸葛暫時不判斷/);
  assert.match(markup, /TWSE/);
  assert.match(markup, /SEC EDGAR/);
  assert.match(markup, /sma20=2400/);
  assert.match(markup, /既有決策紀錄/);
  assert.doesNotMatch(markup, /目前沒有可供分析的 Evidence/);
  assert.equal(JSON.stringify(persisted), beforeStrategies);
});

test("Investment homepage keeps the existing empty state when no live or persisted analysis exists", () => {
  const markup = renderState([], [], []);
  assert.match(markup, /目前沒有可供分析的 Evidence/);
  assert.doesNotMatch(markup, /data-investment-analysis-consumer/);
});
