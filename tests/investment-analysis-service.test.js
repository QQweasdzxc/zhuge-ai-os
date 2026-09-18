const test = require("node:test");
const assert = require("node:assert/strict");

const analysis = require("../modules/investment/services/investment-analysis-service.js");
const strategies = require("../modules/investment/services/investment-strategy-library.js");

function baseContext(overrides = {}) {
  return {
    contract: "zhuge-investment-context-pack-v1",
    symbol: "2330",
    market: "TW",
    generatedAt: "2026-09-18T09:00:00.000Z",
    marketPhase: {},
    evidence: [],
    strategyIds: [],
    ...overrides
  };
}

test("analysis projection consumes the Context Pack without inventing unavailable capabilities", () => {
  const pack = baseContext({
    evidence: [{
      type: "market_quote",
      title: "2330 最新可用行情",
      source: "TWSE Open Market Quote",
      sourceUrl: "https://example.test/quote",
      observedAt: "2026-09-18T05:30:00.000Z",
      freshness: "stale",
      quality: "stale",
      facts: ["price=2460"]
    }, {
      type: "news",
      title: "TSMC evidence",
      source: "Test News",
      sourceUrl: "https://example.test/news",
      observedAt: "2026-09-18T08:00:00.000Z",
      freshness: "fresh",
      quality: "provider"
    }],
    strategyIds: ["event_driven", "growth_quality"]
  });

  const result = analysis.analyzeContextPack(pack, { strategyLibrary: strategies });

  assert.equal(result.contract, "zhuge-investment-analysis-v1");
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.marketPhase.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.technical.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.fundamental.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.relationships.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.strategyLibrary.matches[0].status, "AVAILABLE");
  assert.equal(result.strategyLibrary.matches[1].status, "INSUFFICIENT_EVIDENCE");
  assert.match(result.technical.limitations[0], /不以單一最新價格冒充/);
});

test("analysis projection handles market phase, technical, fundamental, relationship and strategy evidence", () => {
  const pack = baseContext({
    marketPhase: { phase: "OPEN", source: "exchange-session", asOf: "2026-09-18T02:00:00.000Z" },
    evidence: [
      { type: "ohlc", title: "daily candles", source: "Market History", facts: ["sma20=2400", "rsi14=58"] },
      { type: "fundamental", title: "earnings", source: "Issuer Filing", facts: ["revenue_growth=12%"] },
      { type: "etf_component", title: "0050 component", source: "ETF Provider", facts: ["weight=31%", "component=2330"] },
      { type: "news", title: "market event", source: "News Provider", sourceUrl: "https://example.test/event" }
    ],
    strategyIds: ["ma_golden_cross", "growth_quality", "event_driven"]
  });

  const result = analysis.analyzeContextPack(pack, { strategyLibrary: strategies });

  assert.equal(result.marketPhase.status, "AVAILABLE");
  assert.equal(result.marketPhase.summary, "Market phase evidence: OPEN.");
  assert.equal(result.technical.status, "AVAILABLE");
  assert.equal(result.fundamental.status, "AVAILABLE");
  assert.equal(result.relationships.status, "AVAILABLE");
  assert.equal(result.strategyLibrary.status, "AVAILABLE");
  assert.deepEqual(result.strategyLibrary.matches.map(item => item.status), ["AVAILABLE", "AVAILABLE", "AVAILABLE"]);
  assert.equal(result.technical.observations.includes("sma20=2400"), true);
});

test("enrichment is additive and preserves the canonical Context Pack", () => {
  const pack = baseContext({ evidence: [{ type: "news", title: "A", source: "S" }] });
  const enriched = analysis.enrichContextPack(pack, { strategyLibrary: strategies });

  assert.equal(enriched.contract, pack.contract);
  assert.equal(enriched.symbol, pack.symbol);
  assert.deepEqual(enriched.evidence, pack.evidence);
  assert.equal(enriched.analysis.contract, "zhuge-investment-analysis-v1");
  assert.equal(Object.prototype.hasOwnProperty.call(pack, "analysis"), false);
});
