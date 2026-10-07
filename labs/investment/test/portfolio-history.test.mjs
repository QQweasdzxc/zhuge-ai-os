import test from "node:test";
import assert from "node:assert/strict";
import { loadPortfolioHistoryMap, portfolioHistoryForPosition } from "../src/portfolio/history.mjs";

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
  assert.equal(histories.get("TW:0050.TW"), existing);
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "0050", researchSymbol: "0050.TW", market: "TW" }), existing);
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "2330", researchSymbol: "2330.TW", market: "TW" }), histories.get("TW:2330.TW"));
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
  assert.equal(histories.get("TW:3333.TW").status, "UNAVAILABLE");
  assert.equal(histories.get("TW:3333.TW").data, null);
  assert.equal(histories.get("TW:3333.TW").fallback, false);
});

test("portfolio history keeps identical tickers isolated by market identity", async () => {
  const calls = [];
  const histories = await loadPortfolioHistoryMap({
    positions: [
      { symbol: "1234", researchSymbol: "1234", market: "TW" },
      { symbol: "1234", researchSymbol: "1234", market: "US" },
    ],
    loadHistory: async (symbol, position) => {
      calls.push(position.market);
      return { ...evidence(symbol), provider: position.market, market: position.market };
    },
  });
  assert.deepEqual(calls.sort(), ["TW", "US"]);
  assert.equal(histories.get("TW:1234").provider, "TW");
  assert.equal(histories.get("US:1234").provider, "US");
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234", market: "TW" }).provider, "TW");
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234", market: "US" }).provider, "US");
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234" }), null);
});

test("unresolved bare tickers cannot reuse market-scoped history or infer Taiwan from digit length", async () => {
  const histories = await loadPortfolioHistoryMap({
    positions: [{ symbol: "1234", researchSymbol: "1234" }],
    trends: [{ symbol: "1234", market: "US", history: { provider: "US-only" } }],
    loadHistory: async () => ({ provider: "UNRESOLVED" }),
  });
  assert.equal(histories.get("UNRESOLVED:1234").provider, "UNRESOLVED");
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234", market: "TW" }), null);
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234", market: "US" }).provider, "US-only");
  assert.equal(portfolioHistoryForPosition(histories, { symbol: "1234" }).provider, "UNRESOLVED");
});
