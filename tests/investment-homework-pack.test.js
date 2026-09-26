const test = require("node:test");
const assert = require("node:assert/strict");

const homework = require("../modules/investment/services/investment-homework-pack.js");
const analysis = require("../modules/investment/services/investment-analysis-service.js");
const scanner = require("../modules/investment/services/investment-strategy-scanner.js");
const strategies = require("../modules/investment/services/investment-strategy-library.js");

function context(overrides = {}) {
  return {
    contract: "zhuge-investment-context-pack-v1",
    symbol: "0050",
    market: "TW",
    generatedAt: "2026-09-26T00:00:00.000Z",
    evidence: [],
    missing: ["fundamental_evidence", "relationship_evidence"],
    strategyIds: ["ma_golden_cross"],
    ...overrides
  };
}

test("Homework Pack is read-only and preserves insufficient evidence", () => {
  const enriched = analysis.enrichContextPack(context(), { strategyLibrary: strategies });
  const scan = scanner.scanContext(enriched, { analysis: enriched.analysis, strategyLibrary: strategies, analysisService: analysis });
  const result = homework.buildContext({ ...enriched, strategyScan: scan }, { analysis: enriched.analysis, strategyScan: scan });

  assert.equal(result.contract, "zhuge-investment-homework-pack-v1");
  assert.equal(result.readOnly, true);
  assert.equal(result.mutation, "none");
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.missing.includes("基本面 Evidence"), true);
  assert.equal(result.homework.some(item => item.status === "OPEN"), true);
  assert.match(result.plainLanguage.next, /補齊|觀察/);
});

test("Homework Pack keeps source, as-of, freshness and limitations", () => {
  const result = homework.buildContext(context({
    missing: [],
    evidence: [{
      type: "market_quote",
      title: "0050 最新可用行情",
      source: "TWSE",
      sourceUrl: "https://example.test/quote",
      observedAt: "2026-09-26T00:00:00.000Z",
      freshness: "fresh",
      quality: "provider",
      limitations: ["僅作最新可用資料。"]
    }],
    strategyIds: []
  }), { analysis: { status: "AVAILABLE", marketPhase: { status: "AVAILABLE", summary: "市場階段已取得" } } });

  assert.equal(result.status, "READY");
  assert.equal(result.evidence[0].source, "TWSE");
  assert.equal(result.evidence[0].observedAt, "2026-09-26T00:00:00.000Z");
  assert.equal(result.evidence[0].freshness, "fresh");
  assert.deepEqual(result.evidence[0].limitations, ["僅作最新可用資料。"]);
});

test("Homework Pack retains conflicting strategy factors instead of selecting an answer", () => {
  const result = homework.buildContext(context({ missing: [], strategyIds: ["ma_golden_cross"] }), {
    analysis: {
      status: "PARTIAL",
      strategySynthesis: {
        supportingFactors: ["均線條件支持"],
        opposingFactors: ["基本面仍待確認"],
        conflicts: ["不同策略方向衝突"],
        watchConditions: ["觀察後續量價確認"]
      }
    },
    strategyScan: { status: "PARTIAL", conflicts: ["不同策略方向衝突"] }
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.homework.filter(item => item.label === "策略衝突").length, 1);
  assert.equal(result.plainLanguage.next, "觀察後續量價確認");
});

test("Homework Pack caps output and never exposes a write command", () => {
  const result = homework.buildContext(context({
    missing: Array.from({ length: 30 }, (_, index) => `missing_${index}`),
    evidence: Array.from({ length: 30 }, (_, index) => ({ type: "note", title: `Evidence ${index}`, source: "test" }))
  }), { analysis: { status: "PARTIAL" } });

  assert.equal(result.evidence.length, 12);
  assert.equal(result.homework.length <= 20, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "createTask"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "write"), false);
});
