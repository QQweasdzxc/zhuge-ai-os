const test = require("node:test");
const assert = require("node:assert/strict");

const backtest = require("../modules/investment/services/investment-strategy-backtest.js");
const volume = require("../modules/investment/services/investment-volume-confirmation.js");

function bars() {
  return Array.from({ length: 40 }, (_, index) => {
    const bullishPath = index >= 22 && index <= 26;
    const bearishPath = index >= 29 && index <= 33;
    const close = index === 21 ? 105 : index === 28 ? 95 : bullishPath ? 100 + (index - 21) * 2 : bearishPath ? 110 - (index - 28) * 2 : 100;
    const open = index === 21 ? 100 : index === 28 ? 100 : close;
    const volumeValue = index === 20 || index === 27 ? 50 : index === 21 || index === 28 ? 180 : 100;
    return { timestamp: `2026-01-${String(index + 1).padStart(2, "0")}`, open, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2, close, volume: volumeValue };
  });
}

function history() {
  return {
    contract: "zhuge-investment-history-v1",
    symbol: "2330",
    market: "TW",
    provider: "twse-daily-history",
    source: "TWSE Daily Trading Open Data",
    sourceUrl: "https://www.twse.com.tw/rwd/en/afterTrading/STOCK_DAY",
    asOf: "2026-02-09T00:00:00.000Z",
    freshness: "fresh",
    stale: false,
    available: true,
    bars: bars()
  };
}

test("volume confirmation separates bullish and bear-trap patterns and enters after confirmation close", () => {
  const result = volume.runHistory({ history: history(), strategyBacktest: backtest, retrievedAt: "2026-02-10T00:00:00.000Z" });
  assert.equal(result.contract, "volume_contraction_confirmation_v1");
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.patternCounts.bullish, 1);
  assert.equal(result.patternCounts.bearish, 1);
  assert.equal(result.metrics.sampleCount, 2);
  assert.equal(result.events[0].confirmationIndex + 1, result.events[0].entryIndex);
  assert.equal(result.events[0].entryAt, "2026-01-23");
  assert.equal(result.methodology.lookaheadGuard.includes("following bar open"), true);
  assert.equal(result.evidence[0].source, "TWSE Daily Trading Open Data");
  assert.equal(result.evidence[0].retrievedAt, "2026-02-10T00:00:00.000Z");
  assert.equal(result.mutation, "none");
});

test("volume confirmation remains insufficient without OHLCV and never fabricates samples", () => {
  const result = volume.runHistory({ history: { ...history(), available: false, bars: [] }, strategyBacktest: backtest });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.metrics.sampleCount, 0);
  assert.equal(result.evidence[0].summary.includes("沒有足夠"), true);
  assert.equal(result.mutation, "none");
});

test("threshold sweep preserves all configurations instead of selecting the best result", () => {
  const result = volume.runThresholdSweep({ history: history(), strategyBacktest: backtest });
  assert.equal(result.readOnly, true);
  assert.equal(result.runs.length > 6, true);
  assert.equal(result.stability.runCount, result.runs.length);
  assert.match(result.stability.conclusion, /保留全貌/);
});

test("universe aggregation includes symbol, industry and year breakdowns", () => {
  const result = volume.runUniverse({ histories: [{ ...history(), industry: "半導體" }, { ...history(), symbol: "0050", industry: "ETF" }], strategyBacktest: backtest });
  assert.equal(result.coverage.requested, 2);
  assert.equal(Array.isArray(result.breakdown.bySymbol), true);
  assert.equal(Array.isArray(result.breakdown.byIndustry), true);
  assert.equal(Array.isArray(result.breakdown.byYear), true);
  assert.equal(result.mutation, "none");
});
