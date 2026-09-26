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

test("#14-#17 produce evidence-bounded zones, portfolio risk, confidence, and multi-strategy conflict", () => {
  const pack = baseContext({
    marketPhase: { phase: "OPEN", source: "exchange-session", asOf: "2026-09-18T02:00:00.000Z" },
    decisionZones: {
      buyPoint: { value: "重新站回可驗證支撐", conditions: ["技術與基本面同步確認"] },
      sellPoint: { value: "跌破可驗證失效條件", conditions: ["重新檢查基本面與市場階段"] },
      strategyRange: { value: "支撐至壓力之間", conditions: ["持續取得新鮮 OHLC"] }
    },
    strategyEvidence: [
      { strategyId: "ma_golden_cross", stance: "SUPPORT", reason: "均線證據支持持續觀察。" },
      { strategyId: "event_driven", stance: "OPPOSE", reason: "事件證據帶來反向風險。" }
    ],
    evidence: [
      { type: "market_quote", symbol: "2330", market: "TW", title: "2330 quote", source: "TWSE", observedAt: "2026-09-18T02:00:00.000Z", freshness: "fresh", quality: "official_open_data", facts: ["price=2460"] },
      { type: "ohlc", symbol: "2330", market: "TW", title: "2330 history", source: "TWSE", observedAt: "2026-09-17T08:00:00.000Z", freshness: "fresh", quality: "official_open_data", facts: ["sma20=2400"] },
      { type: "fundamental", symbol: "2330", market: "TW", title: "2330 filing", source: "TWSE", observedAt: "2026-09-10T08:00:00.000Z", freshness: "fresh", quality: "official_open_data", facts: ["revenue_growth=12%"] },
      { type: "industry", symbol: "2330", market: "TW", title: "2330 industry", source: "TWSE", observedAt: "2026-09-10T08:00:00.000Z", freshness: "fresh", quality: "official_open_data", facts: ["industry=semiconductor"] },
      { type: "news", symbol: "2330", market: "TW", title: "2330 event", source: "Public News", observedAt: "2026-09-18T01:00:00.000Z", freshness: "fresh", quality: "provider" }
    ],
    strategyIds: ["ma_golden_cross", "event_driven"]
  });
  const enriched = analysis.enrichContextPack(pack, {
    strategyLibrary: strategies,
    portfolioPositions: [
      { symbol: "2330", name: "台積電", market: "TW", currency: "TWD", quantity: 10, marketValue: 24600, industry: "半導體" },
      { symbol: "0050", name: "元大台灣50", market: "TW", currency: "TWD", quantity: 100, marketValue: 10985, industry: "ETF" }
    ]
  });
  const result = enriched.analysis;

  assert.equal(result.decisionZones.status, "AVAILABLE");
  assert.equal(result.decisionZones.buyPoint.value, "重新站回可驗證支撐");
  assert.equal(result.portfolioRisk.status, "AVAILABLE");
  assert.equal(result.portfolioRisk.holding.isHeld, true);
  assert.equal(result.portfolioRisk.marketExposure[0].key, "TW");
  assert.equal(result.confidence.status, "AVAILABLE");
  assert.ok(Number.isInteger(result.confidence.score));
  assert.deepEqual(result.confidence.factors.map(item => item.id), [
    "evidence_completeness",
    "freshness",
    "provider_quality",
    "data_consistency"
  ]);
  assert.equal(result.strategySynthesis.status, "PARTIAL");
  assert.equal(result.strategySynthesis.supportingFactors.length, 1);
  assert.equal(result.strategySynthesis.opposingFactors.length, 1);
  assert.equal(result.strategySynthesis.conflicts.length, 1);
});

test("#14 stays insufficient and does not invent a price zone when inputs are incomplete", () => {
  const result = analysis.analyzeContextPack(baseContext({
    evidence: [{ type: "market_quote", symbol: "0050", market: "TW", source: "TWSE", freshness: "fresh", quality: "official_open_data", facts: ["price=109.85"] }],
    strategyIds: ["ma_golden_cross"]
  }), { strategyLibrary: strategies });

  assert.equal(result.decisionZones.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.decisionZones.buyPoint.value, null);
  assert.equal(result.decisionZones.sellPoint.value, null);
  assert.equal(result.decisionZones.strategyRange.value, null);
  assert.equal(result.portfolioRisk.status, "NOT_APPLICABLE");
  assert.equal(result.strategySynthesis.status, "INSUFFICIENT_EVIDENCE");
});
