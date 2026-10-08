import test from "node:test";
import assert from "node:assert/strict";
import { mergeTdccPublishedHistory, parseTdccWeeklyCsv } from "../src/domain/tdcc-historical-series.mjs";
import { renderTdccHistoricalSeries } from "../src/components/tdcc-history.mjs";

const csv = [
  "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%",
  "20261002,2330,第13級,12,1000,10.0",
  "20261002,2330,第14級,5,2000,15.0",
  "20261002,2330,第15級,2,3000,25.0",
  "20261009,2330,第13級,12,1000,11.0",
  "20261009,2330,第14級,5,2000,15.5",
  "20261009,2330,第15級,2,3000,25.5",
  "20261009,2317,第13級,1,100,5.0",
].join("\n");

test("TDCC official weekly CSV becomes source-dated tier history for the requested symbol", () => {
  const result = parseTdccWeeklyCsv(csv, { symbol: "2330", fetchedAt: "2026-10-09T10:00:00Z" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[0].topThreeSourceLevelsPct, 50);
  assert.equal(result.observations[1].changePercentagePoints, 2);
  assert.equal(result.observations.every(item => item.sourceUrl === "https://data.gov.tw/dataset/11452"), true);
});

test("TDCC history is insufficient instead of zero-filled when a level/date is absent", () => {
  const result = parseTdccWeeklyCsv(csv.split("\n").filter(row => !row.includes("20261009,2330,第15級")).join("\n"), { symbol: "2330" });
  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.observations.find(item => item.date === "2026-10-09").topThreeSourceLevelsPct, null);
  const html = renderTdccHistoricalSeries(result);
  assert.match(html, /不補造歷史值/);
});

test("multi-symbol TDCC deltas compare each symbol only with its own previous date", () => {
  const result = parseTdccWeeklyCsv([
    "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%",
    "20261002,2330,第13級,1,1,10", "20261002,2330,第14級,1,1,15", "20261002,2330,第15級,1,1,25",
    "20261002,2317,第13級,1,1,5", "20261002,2317,第14級,1,1,10", "20261002,2317,第15級,1,1,20",
    "20261009,2330,第13級,1,1,11", "20261009,2330,第14級,1,1,15", "20261009,2330,第15級,1,1,25",
    "20261009,2317,第13級,1,1,5", "20261009,2317,第14級,1,1,11", "20261009,2317,第15級,1,1,20",
  ].join("\n"));
  const latestBySymbol = new Map(result.observations.filter(item => item.date === "2026-10-09").map(item => [item.symbol, item]));
  assert.equal(latestBySymbol.get("2330").changePercentagePoints, 1);
  assert.equal(latestBySymbol.get("2317").changePercentagePoints, 1);
});

test("scheduled publication merges only official dates, keeps symbol-scoped deltas and bounds history", () => {
  const first = mergeTdccPublishedHistory(csv, null, {
    fetchedAt: "2026-10-09T10:00:00Z",
    sourceSha256: "a".repeat(64),
  });
  const secondCsv = csv.replaceAll("20261009", "20261016").replace("20261016,2330,第13級,12,1000,11.0", "20261016,2330,第13級,12,1000,12.0");
  const second = mergeTdccPublishedHistory(secondCsv, first, {
    fetchedAt: "2026-10-16T10:00:00Z",
    sourceSha256: "b".repeat(64),
    maxDatesPerSymbol: 2,
  });
  assert.equal(second.contract, "zhuge-tdcc-static-history-v1");
  assert.deepEqual(second.sourceDates, ["2026-10-09", "2026-10-16"]);
  assert.equal(second.observations.find(item => item.symbol === "2330" && item.date === "2026-10-16").changePercentagePoints, 1);
  assert.equal(second.observations.some(item => item.date === "2026-10-08"), false, "publisher must not synthesize dates");
  assert.equal(second.license, "政府資料開放授權條款第 1 版");
});
