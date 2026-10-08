import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildSmaCrossoverSignals, runSmaCrossoverBacktest } from "../src/domain/sma-crossover-backtest.mjs";

const require = createRequire(import.meta.url);
const strategyBacktest = require("../../../modules/investment/services/investment-strategy-backtest.js");

function bars(closes) {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index,
  }));
}

test("SMA crossover emits only close-confirmed transitions and preserves next-bar execution contract", () => {
  const values = [...Array(20).fill(20), 19, 18, 17, 18, 19, 21, 23, 25, 26, 25, 23, 20, 18, 16, 14, 13, 14, 15, 16, 17, 18, 19, 20];
  const plan = buildSmaCrossoverSignals(bars(values), { fastWindow: 3, slowWindow: 5, provider: "official fixture" });
  assert.equal(plan.status, "READY");
  assert.deepEqual(plan.signals.map(item => item.action), ["ENTER", "EXIT", "ENTER"]);
  assert.ok(plan.signals.every(item => item.barIndex < plan.bars.length));
  assert.match(plan.signals[0].reason, /收盤確認 SMA3 上穿 SMA5/);
  assert.equal(plan.signals[0].evidenceRefs[0].source, "official fixture");
  assert.equal(plan.signals.at(-1).action, "ENTER", "the final unmatched entry remains open evidence rather than becoming an invented closing trade");
});

test("insufficient history, invalid windows, and out-of-order bars never produce a result", () => {
  assert.equal(buildSmaCrossoverSignals(bars([1, 2, 3]), { fastWindow: 2, slowWindow: 5 }).status, "INSUFFICIENT_EVIDENCE");
  assert.equal(buildSmaCrossoverSignals(bars([1, 2, 3, 4]), { fastWindow: 5, slowWindow: 3 }).status, "INVALID_INPUT");
  const reversed = bars(Array.from({ length: 24 }, (_, index) => index + 1)).reverse();
  assert.equal(buildSmaCrossoverSignals(reversed, { fastWindow: 3, slowWindow: 5 }).status, "INVALID_INPUT");
  const duplicateDate = bars(Array.from({ length: 24 }, (_, index) => index + 1));
  duplicateDate[10].date = duplicateDate[9].date;
  assert.equal(buildSmaCrossoverSignals(duplicateDate, { fastWindow: 3, slowWindow: 5 }).status, "INVALID_INPUT");
  const invalidDate = bars(Array.from({ length: 24 }, (_, index) => index + 1));
  invalidDate[10].date = "not-a-date";
  assert.equal(buildSmaCrossoverSignals(invalidDate, { fastWindow: 3, slowWindow: 5 }).status, "INVALID_INPUT");
});

test("backtest uses the existing read-only engine and returns no result when no evidence-backed cross exists", () => {
  const values = [...Array(20).fill(20), 19, 18, 17, 18, 19, 21, 23, 25, 26, 25, 23, 20, 18, 16, 14, 13, 14, 15, 16, 17, 18, 19, 20];
  const rows = bars(values);
  const { result, settings, plan } = runSmaCrossoverBacktest(rows, strategyBacktest, { fastWindow: 3, slowWindow: 5, feeBps: 10, slippageBps: 5, provider: "test source" });
  assert.equal(result.status, "PARTIAL", "a final unclosed ENTER stays open instead of receiving an invented exit");
  assert.equal(result.readOnly, true);
  assert.equal(result.mutation, "none");
  assert.equal(settings.feeBps, 10);
  assert.equal(settings.slippageBps, 5);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryPrice, rows[plan.signals[0].barIndex + 1].open * 1.0005);
  assert.match(result.warnings.join(" "), /仍有未平倉/);
  const noCross = runSmaCrossoverBacktest(bars(Array(30).fill(20)), strategyBacktest, { fastWindow: 3, slowWindow: 5 });
  assert.equal(noCross.plan.status, "NO_CROSSINGS");
  assert.equal(noCross.result, null);
});
