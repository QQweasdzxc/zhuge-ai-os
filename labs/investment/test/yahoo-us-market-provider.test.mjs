import assert from "node:assert/strict";
import test from "node:test";
import { createYahooUsMarketProvider, loadYahooGlobalMarketContext } from "../../../supabase/functions/_shared/yahoo-us-market.mjs";

const NOW = Date.parse("2026-10-08T20:00:00.000Z");
function payload(symbol, base = 100) {
  return { chart: { result: [{
    meta: { symbol, currency: "USD", regularMarketPrice: base + 1, regularMarketTime: Math.floor((NOW - 60_000) / 1000) },
    timestamp: [Math.floor((NOW - 86_400_000) / 1000), Math.floor((NOW - 60_000) / 1000)],
    indicators: { quote: [{ open: [base - 1, base], high: [base + 1, base + 2], low: [base - 2, base - 1], close: [base, base + 1], volume: [1000, 1200] }] },
  }] } };
}

test("Zhuge-owned Yahoo-compatible provider supplies AAPL and NVDA quote/history without credentials", async () => {
  const calls = [];
  const provider = createYahooUsMarketProvider({
    now: () => NOW,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const symbol = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      return { ok: true, async json() { return payload(symbol, symbol === "AAPL" ? 220 : 180); } };
    },
  });
  for (const symbol of ["AAPL", "NVDA"]) {
    const quote = await provider.getQuote(symbol);
    const history = await provider.getHistory(symbol);
    assert.equal(quote.symbol, symbol);
    assert.equal(quote.market, "US");
    assert.equal(quote.available, true);
    assert.equal(quote.delayed, true);
    assert.equal(quote.priceKind.includes("not independently verified"), true);
    assert.equal(history.symbol, symbol);
    assert.equal(history.available, true);
    assert.equal(history.bars.length, 2);
    assert.equal(history.bars.at(-1).close, quote.price);
    assert.equal(history.fetchedAt, quote.receivedAt);
  }
  assert.equal(provider.readOnly, true);
  assert.equal(calls.every(call => new URL(call.url).hostname === "query1.finance.yahoo.com"), true);
  assert.equal(calls.every(call => call.init.method === "GET"), true);
  assert.equal(calls.every(call => !("authorization" in call.init.headers)), true);
  assert.equal(calls.every(call => new URL(call.url).searchParams.get("interval") === "1d"), true);
});

test("US chart provider validates symbol syntax before network access", async () => {
  let calls = 0;
  const provider = createYahooUsMarketProvider({ fetcher: async () => { calls += 1; throw new Error("unexpected"); } });
  await assert.rejects(() => provider.getQuote("AAPL&range=max"), error => error.code === "US_SYMBOL_INVALID");
  assert.equal(calls, 0);
});

test("global context includes source-dated SOX, TSM ADR, and Korea index observations", async () => {
  const items = await loadYahooGlobalMarketContext({
    now: () => NOW,
    provider: { async getQuote(symbol) {
      return { available: true, symbol, price: symbol === "TSM" ? 300 : 5000, currency: symbol === "TSM" ? "USD" : "USD", sourceUrl: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, provider: "zhuge-yahoo-chart", asOf: new Date(NOW - 60_000).toISOString(), receivedAt: new Date(NOW).toISOString(), freshness: "fresh", stale: false, delayed: true, fallback: false };
    } },
  });
  assert.deepEqual(items.map(item => item.seriesId), ["^SOX", "TSM", "^KS11"]);
  assert.deepEqual(items.map(item => item.category), ["market", "adr", "market"]);
  assert.equal(items.every(item => item.available && item.dataTimestamp && item.fetchedAt && item.delayed === true), true);
  assert.equal(items.find(item => item.seriesId === "TSM").unit, "USD per share");
});
