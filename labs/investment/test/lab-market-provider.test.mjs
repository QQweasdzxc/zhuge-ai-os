import test from "node:test";
import assert from "node:assert/strict";
import { createLabMarketProvider } from "../src/providers/lab-market-provider.mjs";

const RUNTIME = "zhuge-investment-intelligence-runtime-v1";
const EDGE = "zhuge-investment-intelligence-edge-v1";

function fixture({ authorize = async () => true, catalog = [], runtime = {}, taiwanScan = null, invalidTaiwanScan = false } = {}) {
  const calls = [];
  const intelligenceProvider = {
    load: async input => {
      calls.push({ type: "load", input });
      return { contract: RUNTIME, generatedAt: "2026-10-07T00:00:00.000Z", quotes: [], histories: [], fundamentals: [], relationships: [], news: [], contexts: [], ...runtime };
    },
  };
  const invokeFunction = async (name, payload) => {
    calls.push({ type: "invoke", name, payload });
    if (payload.catalog_query) return { contract: EDGE, read_only: true, catalog_results: catalog, catalog_source: "official catalog", catalog_data_timestamp: null };
    if (payload.taiwan_market_scan && invalidTaiwanScan) return { contract: EDGE, read_only: true };
    if (payload.taiwan_market_scan) return {
      contract: EDGE,
      read_only: true,
      taiwan_market_scan: taiwanScan || { contract: "zhuge-taiwan-market-scan-v1", status: "AVAILABLE", items: [], sectorSummary: [], source: ["https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"] },
    };
    return { contract: EDGE, read_only: true };
  };
  return { provider: createLabMarketProvider({ intelligenceProvider, invokeFunction, authorize }), calls };
}

test("catalog search is authenticated, bounded, and validates the fixed Edge contract", async () => {
  const { provider, calls } = fixture({
    catalog: [{ symbol: "AAPL", name: "Apple Inc.", market: "US", venue: "US", source: "SEC" }],
  });
  const result = await provider.searchSymbols({ market: "US", query: "Apple" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.items[0].symbol, "AAPL");
  assert.equal(calls[0].name, "investment-intelligence-read");
  assert.deepEqual(calls[0].payload.catalog_query, { market: "US", query: "Apple" });

  const unauthorized = fixture({ authorize: async () => "MFA_REQUIRED" });
  await assert.rejects(unauthorized.provider.searchSymbols({ market: "US", query: "AAPL" }), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(unauthorized.calls, []);
});

test("Taiwan listing resolution uses exact venue catalog identity and carries it to the existing provider", async () => {
  const { provider, calls } = fixture({
    catalog: [
      { symbol: "1234", name: "Listed Co", market: "TW", venue: "TWSE" },
      { symbol: "1234", name: "OTC Co", market: "TW", venue: "TPEX" },
    ],
  });
  await assert.rejects(provider.loadResearch({ symbol: "1234", market: "TW" }), error => error.code === "LISTING_AMBIGUOUS");
  assert.equal(calls.filter(item => item.type === "load").length, 0);

  const exact = fixture({ catalog: [{ symbol: "6488", name: "GlobalWafers", market: "TW", venue: "TPEX" }] });
  await exact.provider.loadResearch({ symbol: "6488", market: "TW" });
  const loadCall = exact.calls.find(item => item.type === "load");
  assert.equal(loadCall.input.symbols[0].venue, "TPEX");
});

test("TW research requests include the resolved listing identity for canonical chip evidence", async () => {
  const { provider, calls } = fixture({
    catalog: [{ symbol: "7456", name: "Example Holdings", market: "TW", venue: "TWSE" }],
  });
  await provider.loadResearch({ symbol: "7456", market: "TW" }, { includeTaiwanEvidence: true });
  const request = calls.find(item => item.type === "load").input;
  assert.equal(request.symbols[0].venue, "TWSE");
  assert.deepEqual(request.taiwanEvidence, [{
    symbol: "7456", market: "TW", venue: "TWSE", name: "Example Holdings",
    kinds: ["institutional", "ownership", "margin", "announcements", "brokerBranches"],
  }]);
});

test("quote/history/technical results preserve provider data and never use portfolio values as quotes", async () => {
  const { provider } = fixture({
    catalog: [{ symbol: "0050", name: "ETF", market: "TW", venue: "TWSE" }],
    runtime: {
      quotes: [{ symbol: "0050", market: "TW", currency: "TWD", price: 123, provider: "twse-open", asOf: "2026-10-06T05:00:00Z", available: true }],
      histories: [{ symbol: "0050", market: "TW", provider: "twse-daily-history", source: "TWSE", asOf: "2026-10-06", available: true, bars: Array.from({ length: 30 }, (_, index) => ({ asOf: "2026-09-" + String(index + 1).padStart(2, "0"), open: 100, high: 102, low: 99, close: 100 + index, volume: index + 100 })) }],
    },
  });
  const quote = await provider.getQuote({ symbol: "0050", market: "TW" });
  assert.equal(quote.price, 123);
  assert.equal(quote.provider, "twse-open");
  assert.equal(Object.hasOwn(quote, "marketValue"), false);
  const technical = await provider.getTechnical({ symbol: "0050.TW", market: "TW" });
  assert.equal(technical.status, "AVAILABLE");
  assert.equal(technical.indicators.barsUsed, 30);
  assert.equal(technical.provider, "twse-daily-history");
});

test("US AAPL and NVDA catalog identities remain explicit through research requests", async () => {
  const { provider, calls } = fixture({
    catalog: [
      { symbol: "AAPL", name: "Apple Inc.", market: "US", venue: "US", source: "SEC" },
      { symbol: "NVDA", name: "NVIDIA Corporation", market: "US", venue: "US", source: "SEC" },
    ],
  });
  const aapl = await provider.searchSymbols({ market: "US", query: "AAPL" });
  const nvda = await provider.searchSymbols({ market: "US", query: "NVDA" });
  assert.ok(aapl.items.some(item => item.symbol === "AAPL" && item.market === "US"));
  assert.ok(nvda.items.some(item => item.symbol === "NVDA" && item.market === "US"));
  await provider.loadResearch([
    { symbol: "AAPL", market: "US" },
    { symbol: "NVDA", market: "US" },
  ]);
  const request = calls.find(item => item.type === "load").input;
  assert.deepEqual(request.symbols.map(item => [item.symbol, item.market, item.venue]), [
    ["AAPL", "US", "US"],
    ["NVDA", "US", "US"],
  ]);
  assert.deepEqual(request.taiwanEvidence, []);
});

test("market-specific chip contracts do not apply Taiwan datasets to US symbols", async () => {
  const { provider, calls } = fixture();
  const result = await provider.getMargin({ symbol: "AAPL", market: "US" });
  assert.equal(result.status, "NOT_APPLICABLE");
  assert.equal(result.data, null);
  assert.equal(calls.length, 0);
});

test("Taiwan chip and market reads use the authenticated existing Edge and official adapter contract", async () => {
  const { provider, calls } = fixture({ runtime: {
    taiwanEvidence: [{ symbol: "0050", market: "TW", venue: "TWSE", evidence: {
      institutional: { status: "AVAILABLE", data: { allThreeNetShares: 10 } },
      ownership: { status: "PARTIAL", data: null },
      margin: { status: "AVAILABLE", data: { marginBalance: 20 } },
      announcements: { status: "EMPTY", data: [] },
    } }],
    taiwanMarketOverview: {
      index: { status: "AVAILABLE" }, breadth: { status: "AVAILABLE" },
      institutions: { status: "AVAILABLE", provider: "TWSE", data: { allThreeNetShares: 30 } },
      tpexInstitutions: { status: "PARTIAL", provider: "TPEx", data: { allThreeNetShares: null } },
      margin: { status: "AVAILABLE", provider: "TWSE / TPEx", data: { TWSE: { status: "AVAILABLE" }, TPEx: { status: "AVAILABLE" } } },
      futures: { status: "AVAILABLE", provider: "TAIFEX", data: { last: 22000 } },
    },
  } });
  const result = await provider.getTaiwanEvidence({ symbol: "0050.TW", market: "TW" });
  assert.equal(result.evidence.institutional.data.allThreeNetShares, 10);
  assert.equal(result.evidence.ownership.status, "PARTIAL");
  assert.equal(result.evidence.margin.data.marginBalance, 20);
  assert.equal(result.evidence.announcements.status, "EMPTY");
  const edgeRequest = calls.find(item => item.type === "load").input;
  assert.deepEqual(edgeRequest.symbols, []);
  assert.deepEqual(edgeRequest.taiwanEvidence[0], {
    symbol: "0050", market: "TW", venue: "TWSE", name: "", kinds: ["institutional", "ownership", "margin", "announcements", "brokerBranches"],
  });

  const overview = await provider.getTaiwanMarketOverview();
  assert.equal(overview.index.status, "AVAILABLE");
  assert.equal(overview.futures.provider, "TAIFEX");
  assert.equal(overview.futures.data.last, 22000);
  assert.equal(overview.institutions.data.allThreeNetShares, 30);
  assert.equal(overview.tpexInstitutions.data.allThreeNetShares, null);
  assert.equal(overview.margin.data.TPEx.status, "AVAILABLE");
  assert.equal(calls.filter(item => item.type === "load")[1].input.taiwanMarketOverview, true);
});

test("global market context uses the existing authenticated read Edge and preserves official Treasury evidence", async () => {
  const evidence = {
    status: "AVAILABLE", available: true, provider: "U.S. Treasury Daily Treasury Yield Curve",
    source: ["https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"],
    data: { series: "10-year par yield", tenYearPct: 4.18, date: "2026-10-06" },
    dataTimestamp: "2026-10-06", freshness: "fresh", delayed: true,
  };
  const commodities = [{ status: "AVAILABLE", provider: "World Bank Pink Sheet", data: { id: "oil", observations: [{ month: "2026-09", value: 71 }] } }];
  const references = [{ status: "AVAILABLE", available: true, provider: "FRED", category: "market", seriesId: "SP500", label: "S&P 500", data: { value: 5780.12 }, dataTimestamp: "2026-10-06" }];
  const { provider, calls } = fixture({ runtime: { globalMarketContext: evidence, globalReferenceContext: references, globalCommodityContext: commodities } });
  const result = await provider.getMarketContext([]);
  const request = calls.find(item => item.type === "load").input;
  assert.equal(request.globalMarketContext, true);
  assert.deepEqual(request.symbols, []);
  assert.deepEqual(result.globalMarketContext, evidence);
  assert.deepEqual(result.globalReferenceContext, references);
  assert.deepEqual(result.globalCommodityContext, commodities);
  assert.equal(result.readOnly, true);

  const denied = fixture({ authorize: async () => "MFA_REQUIRED" });
  await assert.rejects(denied.provider.getMarketContext([]), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(denied.calls, []);
});

test("TDCC history uses the existing authenticated read authority and stays TW-only", async () => {
  const series = {
    contract: "zhuge-tdcc-series-v1", status: "AVAILABLE", symbol: "2330",
    provider: "TDCC public dataset 11452", dataTimestamp: "2026-10-09",
    fetchedAt: "2026-10-10T01:00:00.000Z", observations: [{ date: "2026-10-09", topThreeSourceLevelsPct: 50 }],
  };
  const { provider, calls } = fixture({ runtime: { tdccHistoricalSeries: series } });
  const result = await provider.getTdccHistoricalSeries({ symbol: "2330", market: "TW", venue: "TWSE" });
  assert.deepEqual(result, series);
  const request = calls.find(item => item.type === "load").input;
  assert.deepEqual(request.symbols, []);
  assert.equal(request.tdccHistorySymbol, "2330");
  assert.equal(calls.filter(item => item.type === "invoke").length, 0);

  const us = await provider.getTdccHistoricalSeries({ symbol: "AAPL", market: "US" });
  assert.equal(us.status, "NOT_APPLICABLE");
  assert.equal(calls.filter(item => item.type === "load").length, 1);

  const denied = fixture({ authorize: async () => "MFA_REQUIRED" });
  await assert.rejects(denied.provider.getTdccHistoricalSeries({ symbol: "2330", market: "TW", venue: "TWSE" }), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(denied.calls, []);
});

test("watchlist event candidates use authenticated read-only news mode and exact market identities", async () => {
  const runtime = {
    news: [
      { symbol: "ABC", market: "TW", title: "Taiwan result", sourceUrl: "https://news.example/tw", source: "RSS" },
      { symbol: "ABC", market: "US", title: "US result", sourceUrl: "https://news.example/us", source: "RSS" },
      { title: "Unscoped result", sourceUrl: "https://news.example/global", source: "RSS" },
    ],
  };
  const { provider, calls } = fixture({
    runtime,
    catalog: [{ symbol: "ABC", name: "台灣公司", market: "TW", venue: "TWSE" }],
  });
  const result = await provider.getWatchlistEventCandidates([
    { symbol: "ABC", market: "TW", name: "台灣公司" },
    { symbol: "ABC", market: "US", name: "ABC Inc." },
  ]);
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(result.items.map(item => `${item.market}:${item.symbol}`).sort(), ["TW:ABC", "US:ABC"]);
  const request = calls.find(item => item.type === "load").input;
  assert.equal(request.newsOnly, true);
  assert.equal(request.newsLimit, 5);
  assert.equal(request.symbols.length, 2);
  assert.equal(result.readOnly, true);
});

test("watchlist event candidates fail closed without authorization", async () => {
  const { provider, calls } = fixture({ authorize: async () => "MFA_REQUIRED" });
  await assert.rejects(provider.getWatchlistEventCandidates([{ symbol: "AAPL", market: "US" }]), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(calls, []);
});

test("Taiwan full-market scanner uses the authenticated read-only Edge contract", async () => {
  const { provider, calls } = fixture({ taiwanScan: {
    contract: "zhuge-taiwan-market-scan-v1",
    status: "AVAILABLE",
    items: [{ symbol: "2330", market: "TW", venue: "TWSE", score: 90 }],
    sectorSummary: [{ venue: "TWSE", industry: "半導體業", averageChangePercent: 1.25 }],
  } });
  const result = await provider.getTaiwanMarketScan({ venue: "TWSE", sort: "score", limit: 25 });
  assert.equal(result.readOnly, true);
  assert.equal(result.items[0].symbol, "2330");
  assert.equal(result.sectorSummary[0].industry, "半導體業");
  assert.equal(calls[0].name, "investment-intelligence-read");
  assert.deepEqual(calls[0].payload.taiwan_market_scan, { venue: "TWSE", sort: "score", limit: 25 });

  const unauthorized = fixture({ authorize: async () => "MFA_REQUIRED" });
  await assert.rejects(unauthorized.provider.getTaiwanMarketScan(), error => error.code === "MFA_REQUIRED");
  assert.deepEqual(unauthorized.calls, []);
});

test("Taiwan full-market scanner rejects an unexpected Edge response", async () => {
  const { provider } = fixture({ invalidTaiwanScan: true });
  await assert.rejects(provider.getTaiwanMarketScan(), error => error.code === "TAIWAN_SCANNER_CONTRACT_INVALID");
});
