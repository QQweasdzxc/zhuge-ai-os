import test from "node:test";
import assert from "node:assert/strict";
import { supportedSymbol } from "../src/providers/official-taiwan.mjs";

test("official Taiwan provider accepts catalog-resolved arbitrary listings without a fixed symbol pool", () => {
  const item = supportedSymbol({ symbol: "7456", market: "TW", venue: "TPEX", name: "Example Holdings" });
  assert.equal(item.symbol, "7456.TWO");
  assert.equal(item.code, "7456");
  assert.equal(item.venue, "TPEx");
  assert.equal(item.displayName, "Example Holdings");
  assert.equal(item.instrumentType, "UNKNOWN");
});

test("a bare Taiwan ticker fails closed until the catalog resolves its listing venue", () => {
  assert.equal(supportedSymbol("7456"), null);
  assert.equal(supportedSymbol({ symbol: "7456", market: "TW" }), null);
});
