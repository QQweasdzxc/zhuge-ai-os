import test from "node:test";
import assert from "node:assert/strict";
import { matchWatchlistEventCandidates } from "../src/watchlist/events.mjs";

test("candidate news attaches only to the exact canonical market and symbol", () => {
  const result = matchWatchlistEventCandidates([
    { symbol: "ABC", market: "TW", name: "甲公司" },
    { symbol: "ABC", market: "US", name: "ABC Inc." },
  ], [
    { symbol: "ABC", market: "TW", title: "TW result", sourceUrl: "https://news.example/tw", source: "Provider" },
    { symbol: "ABC", market: "US", title: "US result", sourceUrl: "https://news.example/us", source: "Provider" },
    { title: "unscoped result", sourceUrl: "https://news.example/unscoped" },
  ]);

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.scannedCount, 2);
  assert.deepEqual(result.items.map(item => `${item.market}:${item.symbol}`).sort(), ["TW:ABC", "US:ABC"]);
  assert.equal(result.items.some(item => item.title === "unscoped result"), false);
  assert.equal(result.items.every(item => item.classification === "candidate_provider_search_result"), true);
  assert.equal(result.notificationDelivery, "HUMAN_GATE");
});

test("event candidates reject unsafe source URLs and incomplete provider rows", () => {
  const result = matchWatchlistEventCandidates([{ symbol: "AAPL", market: "US", name: "Apple" }], [
    { symbol: "AAPL", market: "US", title: "unsafe", sourceUrl: "javascript:alert(1)" },
    { symbol: "AAPL", market: "US", title: "no URL" },
    { symbol: "NVDA", market: "US", title: "other symbol", sourceUrl: "https://news.example/nvda" },
  ]);
  assert.equal(result.status, "EMPTY");
  assert.deepEqual(result.items, []);
});

test("event candidates deduplicate a symbol and repeated provider item", () => {
  const row = { symbol: "0050.TW", market: "TW", title: "ETF news", sourceUrl: "https://news.example/0050", source: "RSS" };
  const result = matchWatchlistEventCandidates([
    { symbol: "0050", market: "TW", name: "ETF" },
    { symbol: "0050.TW", market: "TW", name: "ETF" },
  ], [row, row]);
  assert.equal(result.totalCount, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "ETF");
});

test("watchlist event coverage reports a bounded partial scan instead of implying full coverage", () => {
  const result = matchWatchlistEventCandidates([
    { symbol: "AAA", market: "US" },
    { symbol: "BBB", market: "US" },
  ], [], { maxSymbols: 1 });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.scannedCount, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.unscannedCount, 1);
});
