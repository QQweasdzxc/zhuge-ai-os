const test = require("node:test");
const assert = require("node:assert/strict");

const backtest = require("../modules/investment/services/investment-strategy-backtest.js");

function bars() {
  return [
    { timestamp: "2026-01-01", open: 100, high: 105, low: 95, close: 101 },
    { timestamp: "2026-01-02", open: 110, high: 115, low: 105, close: 112 },
    { timestamp: "2026-01-03", open: 120, high: 125, low: 115, close: 121 },
    { timestamp: "2026-01-04", open: 130, high: 135, low: 125, close: 132 },
    { timestamp: "2026-01-05", open: 125, high: 128, low: 120, close: 124 }
  ];
}

test("backtest fails closed without enough bars or caller signals", () => {
  const noBars = backtest.run({ bars: [{ timestamp: "2026-01-01", open: 1, close: 1 }] });
  assert.equal(noBars.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(noBars.readOnly, true);
  const noSignals = backtest.run({ bars: bars() });
  assert.equal(noSignals.status, "INSUFFICIENT_EVIDENCE");
  assert.match(noSignals.warnings.join("|"), /沒有 caller-supplied signal/);
});

test("backtest executes on the next bar open and never uses signal-bar close", () => {
  const result = backtest.run({
    strategyId: "ma_golden_cross",
    bars: bars(),
    signals: [
      { action: "ENTER", barIndex: 0, strategyId: "ma_golden_cross", evidenceRefs: [{ source: "TWSE", observedAt: "2026-01-01", freshness: "fresh" }] },
      { action: "EXIT", barIndex: 2, strategyId: "ma_golden_cross", evidenceRefs: [{ source: "TWSE", observedAt: "2026-01-03", freshness: "fresh" }] }
    ],
    feeBps: 0,
    slippageBps: 0
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryPrice, 110);
  assert.equal(result.trades[0].exitPrice, 130);
  assert.ok(Math.abs(result.metrics.cumulativeReturn - (20 / 110)) < 1e-12);
  assert.equal(result.methodology.execution, "next_bar_open");
});

test("backtest includes costs, evidence refs and explicit risk metrics", () => {
  const result = backtest.run({
    bars: bars(),
    signals: [{ action: "ENTER", barIndex: 0 }, { action: "EXIT", barIndex: 2 }],
    feeBps: 10,
    slippageBps: 20,
    evidence: [{ source: "TWSE", observedAt: "2026-01-05", freshness: "stale", sourceUrl: "https://example.test" }]
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.evidence[0].source, "TWSE");
  assert.equal(result.metrics.maxDrawdown, 0);
  assert.equal(result.metrics.winRate, 1);
  assert.equal(result.trades[0].return > 0, true);
  assert.equal(result.mutation, "none");
});

test("backtest remains partial instead of hiding unresolved or duplicate signals", () => {
  const result = backtest.run({
    bars: bars(),
    signals: [
      { action: "ENTER", barIndex: 0 },
      { action: "ENTER", barIndex: 1 },
      { action: "EXIT", barIndex: 2 }
    ]
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.metrics.completedTrades, 1);
  assert.match(result.warnings.join("|"), /再次 ENTER/);
});

test("backtest rejects malformed signals instead of inventing execution", () => {
  const result = backtest.run({ bars: bars(), signals: [{ action: "BUY", barIndex: 0 }] });
  assert.equal(result.status, "INVALID_INPUT");
  assert.equal(result.trades.length, 0);
});
