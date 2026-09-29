const test = require("node:test");
const assert = require("node:assert/strict");

const vectors = require("./fixtures/investment-intelligence-097-098-vectors.js");
const analysis = require("../modules/investment/services/investment-analysis-service.js");
const scanner = require("../modules/investment/services/investment-strategy-scanner.js");
const homework = require("../modules/investment/services/investment-homework-pack.js");
const strategies = require("../modules/investment/services/investment-strategy-library.js");

function run(vector) {
  const enriched = analysis.enrichContextPack(vector.context, { strategyLibrary: strategies });
  const scan = scanner.scanContext(enriched, {
    analysis: enriched.analysis,
    analysisService: analysis,
    strategyLibrary: strategies
  });
  const pack = homework.buildContext({ ...enriched, strategyScan: scan }, {
    analysis: enriched.analysis,
    strategyScan: scan
  });
  return { enriched, scan, pack };
}

test("TASK-097/098 deterministic vectors use the canonical Evidence path", () => {
  for (const vector of vectors) {
    const { enriched, scan, pack } = run(vector);
    assert.equal(enriched.contract, "zhuge-investment-context-pack-v1");
    assert.equal(enriched.analysis.contract, "zhuge-investment-analysis-v1");
    assert.equal(enriched.analysis.technical.status, vector.expected.technical);
    assert.equal(enriched.analysis.fundamental.status, vector.expected.fundamental);
    if (vector.expected.relationships) assert.equal(enriched.analysis.relationships.status, vector.expected.relationships);
    assert.equal(scan.selectedIds.length, vector.expected.selected);
    assert.equal(scan.status, vector.expected.scanner);
    assert.equal(pack.contract, "zhuge-investment-homework-pack-v1");
    assert.equal(pack.readOnly, true);
    assert.equal(pack.mutation, "none");
  }
});

test("0050 keeps missing fundamental evidence explicit and never fabricates a conclusion", () => {
  const vector = vectors.find(item => item.id === "0050.TW");
  const { enriched, scan, pack } = run(vector);
  assert.equal(enriched.analysis.fundamental.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(enriched.analysis.relationships.status, "AVAILABLE");
  assert.equal(scan.matches.find(item => item.id === "growth_quality").status, "INSUFFICIENT_EVIDENCE");
  assert.equal(pack.missing.includes("基本面 Evidence"), true);
  assert.equal(pack.plainLanguage.next.includes("補齊") || pack.plainLanguage.next.includes("觀察"), true);
  assert.doesNotMatch(JSON.stringify(pack), /recommend|buy|sell|score/i);
});
