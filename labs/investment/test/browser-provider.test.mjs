import test from "node:test";
import assert from "node:assert/strict";
import { mapTwseCsvQuote, TWSE_BROWSER_QUOTES } from "../src/providers/browser-taiwan.mjs";

// Fixture validates the official CSV parser only; it is never loaded into the UI or runtime.
const fixture = [
  "日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數",
  '"1151001","0050","元大台灣50","55443347","6223565909","112.20","112.90","111.70","112.90","0.8500","73100"',
  '"1151001","2330","台積電","20666092","51702445610","2490.00","2510.00","2485.00","2510.00","30.0000","57634"',
].join("\n");

test("TWSE browser CSV mapping produces dated official quote evidence for supported listings", () => {
  const quote = mapTwseCsvQuote(fixture, "2330.TW", { fetchedAt: "2026-10-01T09:00:00.000Z" });
  assert.equal(quote.status, "AVAILABLE");
  assert.equal(quote.dataTruth, "OFFICIAL");
  assert.equal(quote.provider, "TWSE");
  assert.equal(quote.source[0], TWSE_BROWSER_QUOTES);
  assert.equal(quote.dataTimestamp, "2026-10-01");
  assert.equal(quote.data.close, 2510);
  assert.equal(quote.data.change, 30);
  assert.equal(quote.data.changePercent, 30 / 2480 * 100);
  assert.equal(quote.fallback, false);
});

test("TWSE browser CSV maps ETF quote but never invents a missing row", () => {
  const etf = mapTwseCsvQuote(fixture, "0050.TW");
  assert.equal(etf.data.instrumentType, "ETF");
  assert.equal(etf.data.close, 112.9);
  const absent = mapTwseCsvQuote(fixture, "6488.TWO");
  assert.equal(absent.status, "UNAVAILABLE");
  assert.equal(absent.data, null);
});

test("TWSE browser CSV fails closed on malformed columns", () => {
  const result = mapTwseCsvQuote("date,code,close\n20261001,2330,2510", "2330.TW");
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.data, null);
  assert.equal(result.errorCode, "SOURCE_SCHEMA_CHANGED");
});
