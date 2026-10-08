import assert from "node:assert/strict";
import test from "node:test";
import { loadFredGlobalFxContext, parseFredDailyObservation, parseFredDailyObservations } from "../../../supabase/functions/_shared/fred-global-fx-context.mjs";
import { clearProviderCache } from "../src/lib/http-cache.mjs";
import { renderGlobalFxContext } from "../src/components/global-fx-context.mjs";

const now = Date.parse("2026-10-07T20:00:00.000Z");

test("FRED CSV parser selects the latest valid non-future observation and ignores missing values", () => {
  const csv = "observation_date,DEXUSEU\n2026-10-05,1.1712\n2026-10-06,.\n2026-10-08,1.19\n2026-02-30,4.3";
  assert.deepEqual(parseFredDailyObservation(csv, { now }), { date: "2026-10-05", value: 1.1712 });
  assert.equal(parseFredDailyObservation("observation_date,DEXUSEU\n2026-10-08,1.19", { now }), null);
  assert.equal(parseFredDailyObservation("observation_date,DEXUSEU\n2026-10-05,0", { now }), null);
  assert.deepEqual(parseFredDailyObservations("observation_date,SP500\n2026-10-02,5670\n2026-10-05,.\n2026-10-06,5780\n2026-10-08,5890", { now }), [
    { date: "2026-10-06", value: 5780 },
    { date: "2026-10-02", value: 5670 },
  ]);
});

test("global context provider requests only fixed FRED index/H.10 series and preserves source date/freshness", async () => {
  clearProviderCache();
  const requests = [];
  const seriesValues = { SP500: "5780.12", NASDAQCOM: "18220.45", VIXCLS: "18.5", NIKKEI225: "48200.25", DEXUSEU: "1.17", DEXJPUS: "157.2", DEXUSUK: "1.34", DEXCHUS: "7.12", DEXKOUS: "1368.4" };
  const result = await loadFredGlobalFxContext({
    now: () => now,
    fetchImpl: async url => {
      requests.push(new URL(url));
      const id = new URL(url).searchParams.get("id");
      return { ok: true, status: 200, text: async () => `observation_date,${id}\n2026-10-05,${Number(seriesValues[id]) * 0.99}\n2026-10-06,${seriesValues[id]}` };
    },
  });
  assert.equal(result.length, 9);
  assert.equal(requests.length, 9);
  assert.ok(requests.every(url => url.origin === "https://fred.stlouisfed.org" && url.pathname === "/graph/fredgraph.csv"));
  assert.ok(requests.every(url => url.searchParams.get("cosd") === "2026-08-23"));
  assert.deepEqual(result.map(item => item.seriesId), ["SP500", "NASDAQCOM", "VIXCLS", "NIKKEI225", "DEXUSEU", "DEXJPUS", "DEXUSUK", "DEXCHUS", "DEXKOUS"]);
  assert.ok(result.every(item => item.available && item.dataTimestamp === "2026-10-06" && item.freshness === "fresh" && item.delayed));
  assert.equal(result[0].data.value, 5780.12);
  assert.equal(result[0].data.previousDate, "2026-10-05");
  assert.ok(result[0].data.change > 0 && result[0].data.changePct > 0);
  assert.match(result[0].attribution, /Federal Reserve Bank of St\. Louis/);
  assert.equal(result[0].category, "market");
  assert.equal(result[4].category, "fx");
  assert.equal(result.some(item => item.provider === "Yahoo"), false);
  clearProviderCache();
});

test("FRED provider returns truthful unavailable rows rather than filling missing currency values", async () => {
  clearProviderCache();
  const result = await loadFredGlobalFxContext({
    now: () => now,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "observation_date,DEXUSEU\n2026-10-06,." }),
  });
  assert.equal(result.length, 9);
  assert.ok(result.every(item => item.available === false && item.data === null && item.dataTimestamp === null));
  assert.ok(result.every(item => item.errorCode === "FRED_OBSERVATION_UNAVAILABLE"));
  clearProviderCache();
});

test("global FX presentation shows dates and missing values without fabricated zeroes or unsafe links", () => {
  const html = renderGlobalFxContext([
    { status: "AVAILABLE", available: true, provider: "FRED", seriesId: "DEXUSEU", label: "EUR / USD", unit: "USD per EUR", data: { value: 1.1712 }, dataTimestamp: "2026-10-06", freshness: "fresh", source: ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXUSEU"] },
    { status: "UNAVAILABLE", available: false, provider: "FRED", seriesId: "DEXJPUS", label: "USD / JPY", unit: "JPY per USD", data: null, freshness: "unavailable", source: ["javascript:alert(1)"] },
  ]);
  assert.match(html, /1\.1712/);
  assert.match(html, /2026-10-06/);
  assert.match(html, /USD per EUR/);
  assert.match(html, /data-status="UNAVAILABLE"/);
  assert.match(html, />—<\/td>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /0\.0000/);
});

test("global context keeps equity indices separate from FX labels", () => {
  const html = renderGlobalFxContext([
    { status: "AVAILABLE", available: true, provider: "FRED", category: "market", seriesId: "SP500", label: "S&P 500", unit: "index points", data: { value: 5780.12 }, dataTimestamp: "2026-10-06", freshness: "fresh", source: ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500"] },
    { status: "AVAILABLE", available: true, provider: "FRED", category: "fx", seriesId: "DEXUSEU", label: "EUR / USD", unit: "USD per EUR", data: { value: 1.17 }, dataTimestamp: "2026-10-06", freshness: "fresh", source: ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXUSEU"] },
  ]);
  assert.match(html, /主要市場指數/);
  assert.match(html, /主要匯率參考/);
  assert.match(html, /data-global-category="market" data-global-series="SP500"/);
  assert.match(html, /data-global-category="fx" data-global-series="DEXUSEU"/);
  assert.match(html, /變化率/);
  assert.match(html, />—<\/td>/);
  assert.doesNotMatch(html, /SP500[^<]*USD per/);
});

test("global context keeps SOX/Korea indices and TSM ADR in distinct reference groups", () => {
  const html = renderGlobalFxContext([
    { status: "AVAILABLE", available: true, provider: "zhuge-yahoo-chart", category: "market", seriesId: "^SOX", label: "PHLX Semiconductor Sector Index", unit: "index points", data: { value: 6200 }, dataTimestamp: "2026-10-07T20:00:00.000Z", freshness: "fresh", delayed: true, fetchedAt: "2026-10-08T00:00:00.000Z", source: ["https://query1.finance.yahoo.com/v8/finance/chart/%5ESOX?range=5d"] },
    { status: "AVAILABLE", available: true, provider: "zhuge-yahoo-chart", category: "adr", seriesId: "TSM", label: "Taiwan Semiconductor ADR", unit: "USD per share", data: { value: 300 }, dataTimestamp: "2026-10-07T20:00:00.000Z", freshness: "fresh", delayed: true, fetchedAt: "2026-10-08T00:00:00.000Z", source: ["https://query1.finance.yahoo.com/v8/finance/chart/TSM?range=5d"] },
    { status: "PARTIAL", available: true, provider: "zhuge-yahoo-chart", category: "market", seriesId: "^KS11", label: "KOSPI Composite Index", unit: "index points", data: { value: 2700 }, dataTimestamp: "2026-10-07T06:00:00.000Z", freshness: "stale", delayed: true, fetchedAt: "2026-10-08T00:00:00.000Z", source: ["https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=5d"] },
  ]);
  assert.match(html, /PHLX Semiconductor Sector Index/);
  assert.match(html, /Taiwan Semiconductor ADR/);
  assert.match(html, /KOSPI Composite Index/);
  assert.match(html, /data-global-category="adr" data-global-series="TSM"/);
  assert.match(html, /Yahoo chart/);
  assert.match(html, /來源日期/);
  assert.doesNotMatch(html, /href="javascript:/);
});
