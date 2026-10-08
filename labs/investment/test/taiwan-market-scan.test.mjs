import test from "node:test";
import assert from "node:assert/strict";
import { buildTaiwanMarketScan, filtersForTaiwanSector, normalizeTaiwanScanFilters } from "../src/domain/taiwan-market-scan.mjs";

const twseQuotes = [
  { Date: "2026/10/07", Code: "1101", Name: "台泥", TradeVolume: "1,000", TradeValue: "50,000", OpeningPrice: "49", HighestPrice: "52", LowestPrice: "48", ClosingPrice: "51", Change: "2" },
  { Date: "2026/10/07", Code: "2330", Name: "台積電", TradeVolume: "2,000", TradeValue: "600,000", OpeningPrice: "300", HighestPrice: "305", LowestPrice: "299", ClosingPrice: "303", Change: "3" },
  { Date: "2026/10/06", Code: "9999", Name: "舊日資料", TradeVolume: "99", TradeValue: "99", ClosingPrice: "10", Change: "1" },
];
const tpexQuotes = [
  { Date: "2026/10/06", SecuritiesCompanyCode: "6488", CompanyName: "環球晶", TradingShares: "900", TradingAmount: "400,000", Open: "500", High: "510", Low: "490", Close: "505", Change: "5" },
];
const twseCatalog = [
  { 公司代號: "1101", 公司名稱: "台灣水泥", 產業別: "水泥工業" },
  { 公司代號: "2330", 公司名稱: "台灣積體電路", 產業別: "半導體業" },
];
const tpexCatalog = [{ 證券代號: "6488", 證券名稱: "環球晶圓", 產業別: "半導體業" }];

test("official Taiwan market scan joins only exchange evidence and keeps latest daily rows per listing venue", () => {
  const result = buildTaiwanMarketScan({ twseQuotes, tpexQuotes, twseCatalog, tpexCatalog });
  assert.equal(result.contract, "zhuge-taiwan-market-scan-v1");
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.total, 3);
  assert.deepEqual(result.venueDates, { TWSE: "2026-10-07", TPEX: "2026-10-06" });
  assert.equal(result.items.some(item => item.symbol === "9999"), false);
  assert.equal(result.items.find(item => item.symbol === "2330").industry, "半導體業");
  assert.equal(result.items.find(item => item.symbol === "6488").date, "2026-10-06");
  assert.equal(result.sectorSummary.find(item => item.industry === "半導體業" && item.venue === "TWSE").symbols, 1);
  assert.equal(result.sectorSummary.find(item => item.industry === "半導體業" && item.venue === "TPEX").symbols, 1);
  assert.equal(result.methodology.venueAndDateScoped, true);
  assert.match(result.sourceLimitations.join(" "), /不是預測或買賣訊號/);
});

test("scan score is traceable to daily-change and turnover percentiles, and filters apply before ranking", () => {
  const result = buildTaiwanMarketScan({
    twseQuotes,
    tpexQuotes,
    twseCatalog,
    tpexCatalog,
    filters: { venue: "TWSE", industry: "半導體業", sort: "score", limit: 10 },
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].symbol, "2330");
  assert.equal(result.items[0].score, 50);
  assert.deepEqual(result.items[0].scoreComponents, { dailyChangePercentile: 50, tradeValuePercentile: 50 });
  assert.equal(result.items[0].rankingUniverseCount, 1);
});

test("missing official comparison fields remain null and do not receive a fabricated score", () => {
  const result = buildTaiwanMarketScan({
    twseQuotes: [{ Date: "2026/10/07", Code: "1101", Name: "台泥", ClosingPrice: "51" }],
    tpexQuotes: [],
    twseCatalog,
    tpexCatalog,
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.items[0].changePercent, null);
  assert.equal(result.items[0].tradeValue, null);
  assert.equal(result.items[0].score, null);
});

test("scan filters are bounded and invalid venue/ranges fail closed", () => {
  assert.equal(normalizeTaiwanScanFilters({ venue: "US" }), null);
  assert.equal(normalizeTaiwanScanFilters({ minPrice: 20, maxPrice: 10 }), null);
  assert.equal(normalizeTaiwanScanFilters({ sort: "arbitrary" }), null);
  assert.equal(normalizeTaiwanScanFilters({ limit: 9999 }).limit, 200);
  assert.equal(normalizeTaiwanScanFilters({ offset: 100000 }).offset, 5000);
});

test("price, change and volume filters are applied together before relative ranking", () => {
  const result = buildTaiwanMarketScan({
    twseQuotes,
    tpexQuotes,
    twseCatalog,
    tpexCatalog,
    filters: { venue: "TWSE", minPrice: 300, maxPrice: 304, minChangePct: 0, maxChangePct: 2, minVolume: 1500, minTradeValue: 100_000 },
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].symbol, "2330");
  assert.deepEqual(result.filters, {
    venue: "TWSE", industry: "", minPrice: 300, maxPrice: 304, minChangePct: 0,
    maxChangePct: 2, minVolume: 1500, minTradeValue: 100_000,
    sort: "score", limit: 50, offset: 0,
  });
  assert.equal(normalizeTaiwanScanFilters({ minChangePct: 2, maxChangePct: 1 }), null);
});

test("selecting a heatmap tile opens bounded scanner filters for its source industry", () => {
  assert.deepEqual(filtersForTaiwanSector({ sort: "change", limit: 25, offset: 50 }, { venue: "TPEX", industry: "半導體業" }), {
    venue: "TPEX",
    industry: "半導體業",
    minPrice: null,
    maxPrice: null,
    minChangePct: null,
    maxChangePct: null,
    minVolume: null,
    minTradeValue: null,
    sort: "change",
    limit: 25,
    offset: 0,
  });
  assert.equal(filtersForTaiwanSector({}, { venue: "not-a-venue", industry: "半導體業" }).venue, "ALL");
});

test("industry options are canonical source labels and do not invent an unknown industry", () => {
  const result = buildTaiwanMarketScan({
    twseQuotes,
    tpexQuotes: [],
    twseCatalog: [{ 公司代號: "1101", 公司名稱: "台泥", 產業別: "水泥工業" }],
    tpexCatalog: [],
  });
  assert.deepEqual(result.industryOptions, ["水泥工業"]);
  assert.equal(result.items.find(item => item.symbol === "2330").industry, null);
});

test("sector summary retains every source-backed industry instead of truncating the heatmap universe", () => {
  const quotes = Array.from({ length: 10 }, (_, index) => ({
    Date: "2026/10/07",
    Code: String(1000 + index),
    Name: `公司${index}`,
    ClosingPrice: String(20 + index),
    Change: String(index % 2 ? -1 : 1),
    TradeVolume: "100",
    TradeValue: "2000",
  }));
  const catalog = quotes.map((row, index) => ({
    公司代號: row.Code,
    公司名稱: row.Name,
    產業別: `產業${index}`,
  }));
  const result = buildTaiwanMarketScan({ twseQuotes: quotes, tpexQuotes: [], twseCatalog: catalog, tpexCatalog: [] });
  assert.equal(result.sectorSummary.length, 10);
  assert.deepEqual(result.sectorSummary.map(item => item.rank), Array.from({ length: 10 }, (_, index) => index + 1));
});
