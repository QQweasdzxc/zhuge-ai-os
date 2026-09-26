const test = require("node:test");
const assert = require("node:assert/strict");

const scanner = require("../modules/investment/services/investment-strategy-scanner.js");
const analysis = require("../modules/investment/services/investment-analysis-service.js");
const strategies = require("../modules/investment/services/investment-strategy-library.js");

function context(overrides = {}) {
  return {
    contract: "zhuge-investment-context-pack-v1",
    symbol: "2330",
    market: "TW",
    evidence: [],
    strategyIds: ["ma_golden_cross", "growth_quality"],
    ...overrides
  };
}

test("strategy scanner is evidence-bounded and reuses the existing Analysis result", () => {
  const pack = context({
    evidence: [{ type: "ohlc", symbol: "2330", market: "TW", source: "TWSE", title: "history", facts: ["sma20=2400"] }]
  });
  const result = scanner.scanContext(pack, { analysisService: analysis, strategyLibrary: strategies });
  assert.equal(result.contract, "zhuge-investment-strategy-scanner-v1");
  assert.equal(result.matches[0].status, "READY");
  assert.equal(result.matches[1].status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.mutation, "none");
  assert.deepEqual(result.matches[1].missing, ["fundamental_analysis"]);
});

test("scanner preserves multi-strategy conflict instead of selecting one answer", () => {
  const pack = context({
    marketPhase: { phase: "OPEN", source: "test" },
    evidence: [
      { type: "ohlc", source: "TWSE", title: "history", facts: ["sma20=2400"] },
      { type: "fundamental", source: "TWSE", title: "filing", facts: ["growth=12%"] }
    ],
    strategyEvidence: [
      { strategyId: "ma_golden_cross", stance: "SUPPORT", reason: "技術條件支持" },
      { strategyId: "growth_quality", stance: "OPPOSE", reason: "基本面仍需確認" }
    ]
  });
  const enriched = analysis.enrichContextPack(pack, { strategyLibrary: strategies });
  const result = scanner.scanContext(enriched, { analysis: enriched.analysis, strategyLibrary: strategies });
  assert.equal(result.status, "READY");
  assert.equal(result.supportingFactors.length, 1);
  assert.equal(result.opposingFactors.length, 1);
  assert.equal(result.conflicts.length, 1);
});

test("scanner returns NOT_SELECTED rather than auto-selecting a Strategy", () => {
  const result = scanner.scanContext(context({ strategyIds: [] }), { analysisService: analysis, strategyLibrary: strategies });
  assert.equal(result.status, "NOT_SELECTED");
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.insufficientEvidence[0].includes("沒有指定策略"), true);
});

test("all fifteen catalog strategies have an explicit evidence requirement", () => {
  for (const strategy of strategies.list()) {
    assert.ok(Array.isArray(scanner.requirementFor(strategy)));
    assert.ok(scanner.requirementFor(strategy).length > 0);
  }
});
