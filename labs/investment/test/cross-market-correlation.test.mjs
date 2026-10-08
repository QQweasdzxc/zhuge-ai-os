import test from "node:test";
import assert from "node:assert/strict";
import { calculateCrossMarketCorrelation } from "../src/domain/cross-market-correlation.mjs";
import { renderCrossMarketCorrelation } from "../src/components/cross-market-correlation.mjs";

const history = (provider, closes, omitted = []) => ({ provider, bars: closes.flatMap((close, index) => omitted.includes(index) ? [] : [{ date: `2026-09-${String(index + 1).padStart(2, "0")}`, close }]) });

test("cross-market correlation aligns same-date returns and exposes both providers", () => {
  const target = history("TW official close", Array.from({ length: 25 }, (_, index) => 100 + index));
  const reference = history("Zhuge Yahoo-compatible US", Array.from({ length: 25 }, (_, index) => 200 + index * 2));
  const result = calculateCrossMarketCorrelation(target, reference, { minimumPairs: 20 });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.pairedReturns, 24);
  assert.equal(result.correlation, 1);
  assert.equal(result.targetProvider, "TW official close");
  assert.equal(result.referenceProvider, "Zhuge Yahoo-compatible US");
  assert.match(renderCrossMarketCorrelation(result, "2330", "AAPL"), /data-cross-market-status="AVAILABLE"/);
});

test("cross-market correlation withholds output when common dated returns are insufficient", () => {
  const target = history("TW", Array.from({ length: 25 }, (_, index) => 100 + index));
  const reference = history("US", Array.from({ length: 25 }, (_, index) => 200 + index), Array.from({ length: 18 }, (_, index) => index + 3));
  const result = calculateCrossMarketCorrelation(target, reference, { minimumPairs: 20 });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.correlation, null);
  assert.match(result.note, /共同有效日期不足/);
});
