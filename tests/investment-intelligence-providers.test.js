const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const intelligence = require("../modules/investment/services/investment-intelligence-layer.js");
const providers = require("../modules/investment/services/investment-intelligence-providers.js");
const calculation = require("../modules/investment/services/portfolio-calculation-service.js");

function responseJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

function responseText(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return value; } };
}

test("Investment provider adapters normalize real quote shapes, fallback, FX, news, and context", async () => {
  intelligence.clearProvidersForTest();
  const calls = [];
  const rss = `<?xml version="1.0"?><rss><channel><item><title>TSMC evidence</title><link>https://news.test/tsmc</link><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate><source>Test News</source><description>Verified summary</description></item></channel></rss>`;
  const fetch = async url => {
    calls.push(url);
    if (url.includes("query2.finance.yahoo.com") && url.includes("2330.TW")) return responseJson({}, 429);
    if (url.includes("query2.finance.yahoo.com") && url.includes("AAPL")) {
      return responseJson({ chart: { result: [{ meta: { symbol: "AAPL", currency: "USD", regularMarketPrice: 220.5, regularMarketTime: 1789710000 } }] } });
    }
    if (url.includes("mis.twse.com.tw")) return responseJson({ msgArray: [{ c: "2330", n: "台積電", z: "2460", tlong: "1789713000000" }] });
    if (url.includes("open.er-api.com")) return responseJson({ rates: { TWD: 31.86 }, time_last_update_utc: "Fri, 18 Sep 2026 00:02:31 GMT" });
    if (url.includes("news.google.com")) return responseText(rss);
    if (url.includes("bing.com/news")) return responseText(rss);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const runtime = providers.create({ intelligence, fetch, now: () => Date.parse("2026-09-18T09:00:00.000Z") });
  const result = await runtime.load({ symbols: [
    { symbol: "2330", market: "TW" },
    { symbol: "0050", market: "TW" },
    { symbol: "AAPL", market: "US" }
  ], newsLimit: 1 });

  assert.equal(result.quotes.length, 3);
  assert.equal(result.quotes.find(item => item.symbol === "2330").provider, "twse-open");
  assert.equal(result.quotes.find(item => item.symbol === "2330").price, 2460);
  assert.equal(result.quotes.find(item => item.symbol === "AAPL").provider, "yahoo-chart");
  assert.equal(result.quotes.find(item => item.symbol === "0050").available, false);
  assert.equal(result.fx.available, true);
  assert.equal(result.fx.rate, 31.86);
  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].freshness, "stale");
  assert.equal(result.news[0].stale, true);
  assert.equal(result.contexts.length, 3);
  assert.equal(result.contexts.find(item => item.symbol === "2330").evidence[0].type, "market_quote");
  assert.equal(result.contexts.find(item => item.symbol === "AAPL").evidence.some(item => item.type === "fx_benchmark"), true);
  assert.equal(calls.some(url => url.includes("query2.finance.yahoo.com")), true);
});

test("Investment provider quote overlay reuses the canonical P&L calculation", () => {
  const positions = [{
    symbol: "2330",
    market: "TW",
    quantity: 10,
    investedCost: 9000,
    marketValue: 9000,
    unrealizedPnl: 0,
    unrealizedPercent: 0
  }];
  const live = calculation.applyQuotes(positions, [{
    symbol: "2330",
    market: "TW",
    price: 2460,
    provider: "twse-open",
    available: true,
    freshness: "fresh"
  }]);
  assert.equal(live[0].lastPrice, 2460);
  assert.equal(live[0].marketValue, 24600);
  assert.equal(live[0].unrealizedPnl, 15600);
  assert.equal(live[0].quoteProvider, "twse-open");
});

test("Investment production path uses the authenticated Shared Gateway Edge adapter", async () => {
  intelligence.clearProvidersForTest();
  const calls = [];
  const runtime = providers.create({
    intelligence,
    fetch: async () => { throw new Error("Direct provider fetch must not run on the Edge path."); },
    invokeFunction: async (functionName, body) => {
      calls.push({ functionName, body });
      return {
        contract: "zhuge-investment-intelligence-edge-v1",
        read_only: true,
        generated_at: "2026-09-18T09:00:00.000Z",
        quotes: [{
          symbol: "2330",
          market: "TW",
          currency: "TWD",
          price: 2460,
          provider: "twse-open",
          source: "TWSE Open Market Quote",
          sourceUrl: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
          asOf: "2026-09-18T05:30:10.000Z",
          freshness: "stale",
          stale: true,
          available: true
        }],
        fx: {
          base: "USD",
          quote: "TWD",
          rate: 31.86,
          provider: "open-er-api",
          source: "ExchangeRate-API Open Rates",
          asOf: "2026-09-18T00:02:31.000Z",
          freshness: "fresh",
          available: true
        },
        news: [{
          type: "news",
          symbol: "2330",
          market: "TW",
          title: "TSMC evidence",
          summary: "Verified summary",
          source: "Test News",
          sourceUrl: "https://news.test/tsmc",
          observedAt: "2026-09-18T08:00:00.000Z",
          quality: "provider",
          freshness: "fresh",
          stale: false
        }],
        contexts: [{
          contract: "zhuge-investment-context-pack-v1",
          symbol: "2330",
          market: "TW",
          generatedAt: "2026-09-18T09:00:00.000Z",
          portfolioContext: {},
          dataQuality: { quote: "stale", fx: "not_applicable", news: "provider" },
          evidence: [],
          missing: [],
          strategyIds: []
        }],
        quality: { market: { total: 1, available: 1, stale: 1 }, fx: { available: true, freshness: "fresh" }, news: { count: 1, available: true } },
        provider_trace: { market: [], fx: {}, news: [] },
        stream_subscriptions: 0,
        mutating_operations_invoked: false
      };
    }
  });
  const result = await runtime.load({ symbols: [{ symbol: "2330", market: "TW" }] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].functionName, "investment-intelligence-read");
  assert.deepEqual(calls[0].body.symbols, [{ symbol: "2330", market: "TW", name: "", query: "" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, "url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, "credential"), false);
  assert.equal(result.quotes[0].provider, "twse-open");
  assert.equal(result.quotes[0].freshness, "stale");
  assert.equal(result.fx.rate, 31.86);
  assert.equal(result.contexts[0].contract, "zhuge-investment-context-pack-v1");
});

test("Investment Intelligence Edge adapter is read-only and has no Product Data write surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "supabase/functions/investment-intelligence-read/index.ts"), "utf8");
  assert.match(source, /Deno\.serve/);
  assert.match(source, /read_only: true/);
  assert.match(source, /mutating_operations_invoked: false/);
  assert.doesNotMatch(source, /createClient|SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/);
  assert.match(source, /investment-intelligence-edge-v1/);
});
