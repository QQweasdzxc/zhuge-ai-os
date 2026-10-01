import test from "node:test";
import assert from "node:assert/strict";
import { calculateIndicators } from "../src/domain/indicators.mjs";

const testBars = Array.from({ length: 45 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  close: 100 + index,
  high: 102 + index,
  low: 98 + index,
  volume: 1_000 + index * 10,
}));

test("indicator engine computes deterministic values from explicitly test-only bars", () => {
  const result = calculateIndicators(testBars);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.barsUsed, 45);
  assert.equal(result.sma5, 142);
  assert.equal(result.sma20, 134.5);
  assert.equal(result.rsi14, 100);
  assert.ok(Number.isFinite(result.kd.k));
  assert.ok(Number.isFinite(result.macd.macd));
  assert.ok(Number.isFinite(result.bollinger20.upper));
});

test("insufficient history remains PARTIAL and does not invent indicator values", () => {
  const result = calculateIndicators(testBars.slice(0, 12));
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.sma20, null);
  assert.equal(result.macd, null);
  assert.equal(result.bollinger20, null);
  assert.equal(result.errorCode, "HISTORY_TOO_SHORT");
});
