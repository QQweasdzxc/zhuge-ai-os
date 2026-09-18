const test = require("node:test");
const assert = require("node:assert/strict");
const intelligence = require("../modules/investment/services/investment-intelligence-layer.js");
const strategies = require("../modules/investment/services/investment-strategy-library.js");

test("Investment Intelligence provider fallback uses next healthy provider", async () => {
  intelligence.clearProvidersForTest();
  intelligence.registerProvider({ id: "first", kind: "market", priority: 1, markets: ["TW"], fetch: async () => { throw new Error("rate limited"); } });
  intelligence.registerProvider({ id: "second", kind: "market", priority: 2, markets: ["TW"], fetch: async req => ({ symbol: req.symbol, price: 100 }) });
  const result = await intelligence.fetchWithFallback("market", { market: "TW", symbol: "0050" });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "second");
  assert.equal(result.value.symbol, "0050");
  assert.equal(result.attempts.length, 1);
});

test("Investment Context Pack deduplicates evidence and preserves limitations", () => {
  const pack = intelligence.buildContextPack({ symbol: "0051", market: "TW", generatedAt: "2026-09-18T03:00:00.000Z", evidence: [
    { type: "news", title: "A", source: "S", sourceUrl: "https://example.test/a", observedAt: "2026-09-18", limitations: ["delayed"] },
    { type: "news", title: "A", source: "S", sourceUrl: "https://example.test/a", observedAt: "2026-09-18", limitations: ["delayed"] }
  ] });
  assert.equal(pack.contract, "zhuge-investment-context-pack-v1");
  assert.equal(pack.evidence.length, 1);
  assert.deepEqual(pack.evidence[0].limitations, ["delayed"]);
});

test("Investment Strategy Library exposes the studied 15-skill catalog", () => {
  const list = strategies.list();
  assert.equal(list.length, 15);
  assert.equal(strategies.get("ma_golden_cross").name, "均線金叉");
  assert.equal(strategies.get("event_driven").name, "事件驅動");
  assert.equal(strategies.get("missing"), null);
});
