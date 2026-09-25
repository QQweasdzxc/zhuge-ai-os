const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const intelligence = require("../modules/investment/services/investment-intelligence-layer.js");
const providers = require("../modules/investment/services/investment-intelligence-providers.js");
const analysis = require("../modules/investment/services/investment-analysis-service.js");
const strategyLibrary = require("../modules/investment/services/investment-strategy-library.js");
const homeworkPack = require("../modules/investment/services/investment-homework-pack.js");
const strategyBacktest = require("../modules/investment/services/investment-strategy-backtest.js");
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

test("Investment provider exposes the read-only Strategy Backtest contract without owning signals", () => {
  const runtime = providers.create({ intelligence, strategyBacktest });
  const result = runtime.runBacktest({
    bars: [
      { timestamp: "2026-01-01", open: 100, close: 101 },
      { timestamp: "2026-01-02", open: 110, close: 111 },
      { timestamp: "2026-01-03", open: 120, close: 121 }
    ],
    signals: [{ action: "ENTER", barIndex: 0 }, { action: "EXIT", barIndex: 1 }]
  });
  assert.equal(result.contract, "zhuge-investment-strategy-backtest-v1");
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.readOnly, true);
  assert.equal(result.mutation, "none");
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

test("Investment runtime enriches Context Pack Evidence with the #9-#13 analysis projection", async () => {
  intelligence.clearProvidersForTest();
  const runtime = providers.create({
    intelligence,
    analysis,
    strategyLibrary,
    homeworkPack,
    invokeFunction: async () => ({
      contract: "zhuge-investment-intelligence-edge-v1",
      read_only: true,
      generated_at: "2026-09-18T09:00:00.000Z",
      quotes: [],
      fx: { available: false },
      news: [],
      contexts: [{
        contract: "zhuge-investment-context-pack-v1",
        symbol: "2330",
        market: "TW",
        generatedAt: "2026-09-18T09:00:00.000Z",
        marketPhase: { phase: "OPEN", source: "test-session" },
        evidence: [{ type: "ohlc", title: "daily candles", source: "test", facts: ["sma20=2400"] }],
        missing: [],
        strategyIds: ["ma_golden_cross"]
      }],
      quality: {},
      provider_trace: {},
      stream_subscriptions: 0,
      mutating_operations_invoked: false
    })
  });

  const result = await runtime.load({ symbols: [{ symbol: "2330", market: "TW" }] });

  assert.equal(result.analyses.length, 1);
  assert.equal(result.contexts[0].analysis.contract, "zhuge-investment-analysis-v1");
  assert.equal(result.contexts[0].analysis.marketPhase.status, "AVAILABLE");
  assert.equal(result.contexts[0].analysis.technical.status, "AVAILABLE");
  assert.equal(result.contexts[0].analysis.strategyLibrary.matches[0].status, "AVAILABLE");
  assert.equal(result.homeworkPacks.length, 1);
  assert.equal(result.contexts[0].homeworkPack.contract, "zhuge-investment-homework-pack-v1");
  assert.equal(result.contexts[0].homeworkPack.readOnly, true);
});

test("Investment Intelligence Edge adapter is read-only and has no Product Data write surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "supabase/functions/investment-intelligence-read/index.ts"), "utf8");
  assert.match(source, /Deno\.serve/);
  assert.match(source, /read_only: true/);
  assert.match(source, /mutating_operations_invoked: false/);
  assert.doesNotMatch(source, /createClient|SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/);
  assert.match(source, /investment-intelligence-edge-v1/);
  assert.match(source, /yuantaEtfBridge/);
  assert.match(source, /type: "industry_exposure"/);
  assert.match(source, /type: "related_symbol"/);
  assert.match(source, /FUNDAMENTAL_FRESH_MS/);
});

test("official/public evidence adapters feed OHLC, fundamental, market phase, ETF components, industry exposure and related symbols", async () => {
  intelligence.clearProvidersForTest();
  const calls = [];
  const now = Date.parse("2026-09-18T04:00:00.000Z");
  const bars = Array.from({ length: 60 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index));
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const close = 100 + index;
    return [`${yyyy}/${mm}/${dd}`, "1000", "100000", String(close - 1), String(close + 1), String(close - 2), String(close), "+1", "100"];
  });
  const yahooBars = Array.from({ length: 60 }, (_, index) => Math.floor(Date.UTC(2026, 0, 1 + index) / 1000));
  const yahooCloses = yahooBars.map((_, index) => 200 + index);
  const endpoint = name => `https://provider.test/${name}`;
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(endpoint("twse-quote"))) {
      const code = new URL(url).searchParams.get("ex_ch")?.match(/tse_(\w+)\.tw/)?.[1];
      return responseJson({ msgArray: code === "2330" ? [{ c: "2330", z: "100", tlong: String(now) }] : [] });
    }
    if (url.startsWith(endpoint("yahoo-quote"))) {
      return responseJson({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 220, regularMarketTime: Math.floor(now / 1000) } }] } });
    }
    if (url.startsWith(endpoint("twse-daily"))) return responseJson({ fields: ["Date", "TradeVolume", "TradeValue", "OpeningPrice", "HighestPrice", "LowestPrice", "ClosingPrice", "Change", "Transaction"], data: bars });
    if (url.startsWith(endpoint("yahoo-history"))) return responseJson({ chart: { result: [{ meta: { currency: "USD" }, timestamp: yahooBars, indicators: { quote: [{ open: yahooCloses, high: yahooCloses.map(value => value + 1), low: yahooCloses.map(value => value - 1), close: yahooCloses, volume: yahooCloses.map(() => 1000) }] } }] } });
    if (url.startsWith(endpoint("twse-holiday"))) return responseJson([{ Date: "1150918", Description: "" }]);
    if (url.startsWith(endpoint("twse-financial"))) return responseJson([{ 公司代號: "2330", 公司名稱: "台積電", 出表日期: "1150918", 營業收入: "2404483690", 營業毛利: "1200000000", 營業利益: "1000000000", 本期淨利: "1279582227", 基本每股盈餘: "49.33" }]);
    if (url.startsWith(endpoint("yuanta-etf"))) {
      const ticker = new URL(url).searchParams.get("ticker");
      if (ticker !== "0050") return responseJson({ PCF: null, FundWeights: { StockWeights: [] } });
      return responseJson({
        PCF: { markcd: "0050", fundname: "元大台灣卓越50基金", trandate: "20260918" },
        FundWeights: { StockWeights: [
          { code: "2330", name: "台積電", weights: 56.78, qty: 100 },
          { code: "2454", name: "聯發科", weights: 6.54, qty: 20 },
          { code: "2308", name: "台達電", weights: 3.16, qty: 30 }
        ] }
      });
    }
    if (url.startsWith(endpoint("twse-company"))) return responseJson([
      { 公司代號: "2330", 公司名稱: "台積電", 產業別: "半導體" },
      { 公司代號: "2454", 公司名稱: "聯發科", 產業別: "半導體" },
      { 公司代號: "2308", 公司名稱: "台達電", 產業別: "電子零組件" }
    ]);
    if (url.startsWith("https://www.sec.gov/files/company_tickers.json")) return responseJson({ 0: { ticker: "AAPL", cik_str: 320193 } });
    if (url.startsWith("https://data.sec.gov/api/xbrl/companyfacts")) return responseJson({ "us-gaap": {
      Revenues: { units: { USD: [{ val: 1000, end: "2025-12-31" }, { val: 800, end: "2024-12-31" }] } },
      Assets: { units: { USD: [{ val: 2000, end: "2025-12-31" }] } },
      NetIncomeLoss: { units: { USD: [{ val: 300, end: "2025-12-31" }] } }
    }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ val: 1000, end: "2025-12-31" }] } } } });
    if (url.startsWith("https://data.sec.gov/submissions")) return responseJson({ sic: "3571", sicDescription: "Electronic Computers" });
    if (url.startsWith(endpoint("fx"))) return responseJson({ rates: { TWD: 31.8 }, time_last_update_utc: "Fri, 18 Sep 2026 00:00:00 GMT" });
    if (url.startsWith(endpoint("news"))) return responseText(`<?xml version="1.0"?><rss><channel><item><title>evidence</title><link>https://news.test/evidence</link><pubDate>Fri, 18 Sep 2026 03:00:00 GMT</pubDate><source>Test News</source><description>verified</description></item></channel></rss>`);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const runtime = providers.create({
    intelligence,
    analysis,
    strategyLibrary,
    fetch,
    now: () => now,
    endpoints: {
      yahooChart: endpoint("yahoo-quote"),
      yahooHistory: endpoint("yahoo-history"),
      twseQuote: endpoint("twse-quote"),
      twseDaily: endpoint("twse-daily"),
      twseHoliday: endpoint("twse-holiday"),
      twseFinancial: endpoint("twse-financial"),
      twseCompany: endpoint("twse-company"),
      yuantaEtfBridge: endpoint("yuanta-etf"),
      exchangeRate: endpoint("fx"),
      frankfurter: endpoint("frankfurter"),
      secTickers: "https://www.sec.gov/files/company_tickers.json",
      secFacts: "https://data.sec.gov/api/xbrl/companyfacts",
      secSubmissions: "https://data.sec.gov/submissions",
      googleNews: endpoint("news"),
      bingNews: endpoint("bing-news")
    }
  });

  const result = await runtime.load({ symbols: [
    { symbol: "2330", market: "TW" },
    { symbol: "0050", market: "TW" },
    { symbol: "AAPL", market: "US" }
  ], newsLimit: 1 });

  assert.equal(result.histories.every(item => item.available), true);
  assert.equal(result.contexts.find(item => item.symbol === "2330").analysis.marketPhase.status, "AVAILABLE");
  assert.equal(result.contexts.find(item => item.symbol === "2330").analysis.technical.status, "AVAILABLE");
  assert.equal(result.contexts.find(item => item.symbol === "2330").analysis.fundamental.status, "AVAILABLE");
  assert.equal(result.contexts.find(item => item.symbol === "2330").analysis.relationships.status, "AVAILABLE");
  assert.equal(result.contexts.find(item => item.symbol === "AAPL").analysis.fundamental.status, "AVAILABLE");
  assert.equal(result.contexts.find(item => item.symbol === "AAPL").analysis.relationships.status, "AVAILABLE");
  const twseEvidence = result.contexts.find(item => item.symbol === "2330").evidence.find(item => item.type === "fundamental");
  assert.match(twseEvidence.facts.join("|"), /net_margin_pct=/);
  const aaplEvidence = result.contexts.find(item => item.symbol === "AAPL").evidence.find(item => item.type === "fundamental");
  assert.match(aaplEvidence.facts.join("|"), /revenue_growth_pct_versus_previous_reported_period=/);
  const etfEvidence = result.contexts.find(item => item.symbol === "0050").evidence;
  assert.equal(result.contexts.find(item => item.symbol === "0050").analysis.relationships.status, "AVAILABLE");
  assert.equal(etfEvidence.some(item => item.type === "etf_component"), true);
  assert.equal(etfEvidence.some(item => item.type === "industry_exposure"), true);
  assert.equal(etfEvidence.some(item => item.type === "related_symbol"), true);
  assert.match(etfEvidence.find(item => item.type === "etf_component").facts.join("|"), /component=2330/);
  assert.match(etfEvidence.find(item => item.type === "industry_exposure").facts.join("|"), /industry=半導體/);
  assert.match(etfEvidence.find(item => item.type === "related_symbol").facts.join("|"), /related_symbol=2330/);
  const secCall = calls.find(item => item.url.startsWith("https://www.sec.gov/files/company_tickers.json"));
  assert.match(secCall.options.headers["User-Agent"], /Zhuge AI OS Investment Intelligence/);
});

test("ETF relationship evidence remains insufficient when the official PCF source is unavailable", async () => {
  intelligence.clearProvidersForTest();
  const endpoint = name => `https://provider.test/${name}`;
  const runtime = providers.create({
    intelligence,
    fetch: async url => {
      if (url.startsWith(endpoint("yuanta-etf"))) return responseJson({ PCF: null, FundWeights: { StockWeights: [] } });
      if (url.startsWith(endpoint("twse-company"))) return responseJson([]);
      throw new Error(`Unexpected URL: ${url}`);
    },
    endpoints: { yuantaEtfBridge: endpoint("yuanta-etf"), twseCompany: endpoint("twse-company") }
  });
  const result = await runtime.loadRelationships([{ symbol: "006208", market: "TW" }]);
  assert.equal(result[0].available, false);
  assert.equal(result[0].evidence.length, 0);
  assert.equal(result[0].error, "RELATIONSHIP_UNAVAILABLE");
});

test("ETF component evidence survives an optional industry-source outage", async () => {
  intelligence.clearProvidersForTest();
  const endpoint = name => `https://provider.test/${name}`;
  const runtime = providers.create({
    intelligence,
    fetch: async url => {
      if (url.startsWith(endpoint("yuanta-etf"))) return responseJson({
        PCF: { markcd: "0050", fundname: "元大台灣卓越50基金", trandate: "20260918" },
        FundWeights: { StockWeights: [{ code: "2330", name: "台積電", weights: 56.78 }] }
      });
      if (url.startsWith(endpoint("twse-company"))) throw new Error("TWSE company classification unavailable");
      throw new Error(`Unexpected URL: ${url}`);
    },
    endpoints: { yuantaEtfBridge: endpoint("yuanta-etf"), twseCompany: endpoint("twse-company") }
  });
  const result = await runtime.loadRelationships([{ symbol: "0050", market: "TW" }]);
  assert.equal(result[0].available, true);
  assert.deepEqual(result[0].evidence.map(item => item.type), ["etf_component", "related_symbol"]);
  assert.match(result[0].evidence[0].limitations.join("|"), /industry_exposure=INSUFFICIENT_EVIDENCE/);
});
