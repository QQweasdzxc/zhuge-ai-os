import assert from "node:assert/strict";
import test from "node:test";
import { formalWatchlistMembership } from "../src/portfolio/research-context.mjs";

test("formal watchlist context matches the same canonical market and normalized ticker", () => {
  const items = [{ market: "US", symbol: "AAPL", name: "Apple Inc." }, { market: "TW", symbol: "2330.TW" }];
  assert.equal(formalWatchlistMembership({ symbol: "AAPL", market: "US", status: "AVAILABLE", items }), true);
  assert.equal(formalWatchlistMembership({ symbol: "2330", market: "TW", status: "AVAILABLE", items }), true);
  assert.equal(formalWatchlistMembership({ symbol: "AAPL", market: "TW", status: "AVAILABLE", items }), false);
  assert.equal(formalWatchlistMembership({ symbol: "NVDA", market: "US", status: "EMPTY", items: [] }), false);
});

test("unavailable canonical watchlist is unknown, never represented as not watched", () => {
  assert.equal(formalWatchlistMembership({ symbol: "NVDA", market: "US", status: "SESSION_REQUIRED", items: [] }), null);
  assert.equal(formalWatchlistMembership({ symbol: "NVDA", market: "US", status: "AVAILABLE", items: null }), null);
});
