import assert from "node:assert/strict";
import test from "node:test";
import { parseTpexHistoryPayload, tpexHistoryContract, tpexHistoryRequestUrl } from "../src/providers/tpex-history.mjs";

const now = Date.parse("2026-10-07T20:00:00.000Z");

test("TPEx official monthly rows become dated OHLC bars and normalize source lots to shares", () => {
  const payload = {
    date: "115/10/06",
    tables: [{ fields: ["日期", "成交張數", "成交仟元", "開盤", "最高", "最低", "收盤", "漲跌", "筆數"], data: [
      ["115/10/06", "100", "10,500", "100", "112", "98", "105", "+5", "120"],
      ["115/10/05", "--", "--", "99", "102", "97", "100", "+1", "90"],
    ] }],
  };
  const bars = parseTpexHistoryPayload(payload, { now });
  assert.deepEqual(bars.map(row => row.date), ["2026-10-05", "2026-10-06"]);
  assert.equal(bars[1].open, 100);
  assert.equal(bars[1].high, 112);
  assert.equal(bars[1].low, 98);
  assert.equal(bars[1].close, 105);
  assert.equal(bars[1].volumeLots, 100);
  assert.equal(bars[1].volume, 100000);
  assert.equal(bars[1].sourceVolumeUnit, "lots");
  assert.equal(bars[0].volume, null);
  assert.equal(bars[1].transactionValueThousands, 10500);
  assert.equal(bars[1].transactions, 120);
});

test("TPEx history parser rejects malformed/future bars and returns no fabricated values", () => {
  const payload = { tables: [{ data: [
    ["115/10/08", "3", "30", "10", "12", "9", "11", "1", "2"],
    ["115/10/06", "3", "30", "10", "9", "11", "10", "1", "2"],
    ["115/02/30", "3", "30", "10", "12", "9", "11", "1", "2"],
    ["115/10/06", "3", "30", "--", "12", "9", "11", "1", "2"],
    ["115/10/06", "3", "30"],
  ] }] };
  assert.deepEqual(parseTpexHistoryPayload(payload, { now }), []);
  assert.deepEqual(parseTpexHistoryPayload({ tables: [{ data: [] }] }, { now }), []);
});

test("TPEx request builder is fixed to the official history endpoint and rejects URL injection", () => {
  const url = new URL(tpexHistoryRequestUrl("6488", "20261001"));
  assert.equal(url.origin, "https://www.tpex.org.tw");
  assert.equal(url.pathname, "/www/zh-tw/afterTrading/tradingStock");
  assert.equal(url.searchParams.get("code"), "6488");
  assert.equal(url.searchParams.get("date"), "2026/10/01");
  assert.equal(url.searchParams.get("response"), "json");
  assert.throws(() => tpexHistoryRequestUrl("https://evil.invalid", "20261001"), error => error.code === "TPEX_HISTORY_REQUEST_INVALID");
  assert.equal(tpexHistoryContract.readOnly, true);
  assert.match(tpexHistoryContract.volumeConversion, /1 lot = 1000 shares/);
  assert.match(tpexHistoryContract.limitations[0], /fixed-price trades/);
});
