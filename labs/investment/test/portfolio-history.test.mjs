import test from "node:test";
import assert from "node:assert/strict";
import { loadPortfolioHistoryMap } from "../src/portfolio/history.mjs";

const evidence = (symbol) => ({
  status: "AVAILABLE", provider: "TWSE", dataTruth: "OFFICIAL", dataTimestamp: "2026-10-01",
  delayed: true, stale: false, fallback: false, data: [{ date: "2026-10-01", close: 100 }], symbol,
});

test("portfolio cards reuse research-card history and fetch a repeated symbol only once", async () => {
  const existing = evidence("0050.TW");
  const calls = [];
  const histories = await loadPortfolioHistoryMap({
    positions: [
      { symbol: "0050", researchSymbol: "0050.TW" },
      { symbol: "2330", researchSymbol: "2330.TW" },
      { symbol: "2330.TW", researchSymbol: "2330.TW" },
    ],
    trends: [{ symbol: "0050.TW", history: existing }],
    loadHistory: async (symbol) => { calls.push(symbol); return evidence(symbol); },
  });

  assert.deepEqual(calls, ["2330.TW"]);
  assert.equal(histories.get("0050.TW"), existing);
  assert.equal(histories.get("0050"), existing);
  assert.equal(histories.get("2330"), histories.get("2330.TW"));
});

test("portfolio history requests are bounded and provider failures remain unavailable", async () => {
  let active = 0;
  let peak = 0;
  const histories = await loadPortfolioHistoryMap({
    positions: ["1111.TW", "2222.TW", "3333.TW", "4444.TW", "5555.TW"].map((researchSymbol) => ({ researchSymbol })),
    concurrency: 2,
    loadHistory: async (symbol) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      if (symbol === "3333.TW") throw new Error("provider transport failure");
      return evidence(symbol);
    },
  });

  assert.ok(peak <= 2);
  assert.equal(histories.get("3333.TW").status, "UNAVAILABLE");
  assert.equal(histories.get("3333.TW").data, null);
  assert.equal(histories.get("3333.TW").fallback, false);
});

