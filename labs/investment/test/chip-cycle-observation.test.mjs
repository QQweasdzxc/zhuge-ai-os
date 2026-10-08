import test from "node:test";
import assert from "node:assert/strict";
import { buildChipCycleObservation } from "../src/domain/chip-cycle-observation.mjs";
import { renderChipCycleObservation } from "../src/components/chip-cycle-observation.mjs";

function bars({ direction = 1, volumes = null, finalCandle = null } = {}) {
  return Array.from({ length: 24 }, (_, index) => {
    const close = 100 + direction * index * 0.1;
    const standard = {
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      open: close - 0.02,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: volumes?.[index] ?? (index % 2 ? 100 : 10),
    };
    if (index === 23 && finalCandle) return { ...standard, ...finalCandle, date: standard.date };
    return standard;
  });
}

function markupBars() {
  return bars({ volumes: Array.from({ length: 24 }, (_, index) => index < 19 ? 100 : 500) });
}

const institution = (net = 5000, net10 = net * 2, direction = net > 0 ? "BUY" : net < 0 ? "SELL" : "NEUTRAL", sessions = 5) => ({
  fiveSessions: { sessions: 5, complete: true, through: "2026-09-30", allThreeNetShares: net },
  tenSessions: { sessions: 10, complete: true, through: "2026-09-30", allThreeNetShares: net10 },
  streaks: { allThreeNetShares: { direction, sessions, netShares: net, through: "2026-09-30" } },
});

test("five-stage chip-cycle observation returns explainable source evidence and rule scores", () => {
  const result = buildChipCycleObservation({ bars: markupBars(), institutionalSummary: institution(5000, 10000), historySource: "TWSE daily OHLCV", institutionalSource: "TWSE T86" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.stage, "P4_MARKUP");
  assert.equal(result.asOf, "2026-09-24");
  assert.equal(result.ruleVersion, "zhuge-wyckoff-evidence-v2");
  assert.equal(result.stageScores.length, 5);
  assert.ok(result.stageScores.some(item => item.id === "P1_ACCUMULATION"));
  assert.ok(result.stageScores.some(item => item.id === "P3_MARKUP_IGNITION"));
  assert.ok(result.stageScores.every(item => Array.isArray(item.factors) && item.factors.length > 0));
  assert.ok(result.sourceObservations.some(item => item.source === "TWSE daily OHLCV"));
  assert.ok(result.sourceObservations.some(item => item.source === "TWSE T86"));
  assert.match(result.reason, /Markup 趨勢條件候選/);
  assert.match(result.note, /不是經典 Wyckoff 階段確認/);
  assert.equal(result.confidence.basis, "evidence_coverage_only_not_probability");
});

test("distribution candidate requires both dated institutional outflow and an observed upper shadow", () => {
  const volumes = Array.from({ length: 24 }, (_, index) => index < 19 ? 100 : 230);
  const rows = bars({
    direction: 0.02,
    volumes,
    finalCandle: { open: 101, high: 105, low: 97.5, close: 98, volume: 300 },
  });
  const result = buildChipCycleObservation({ bars: rows, institutionalSummary: institution(-12000, -20000, "SELL", 4) });
  assert.equal(result.stage, "P5_DISTRIBUTION");
  assert.ok(result.stageScores.find(item => item.id === "P5_DISTRIBUTION").score >= 45);
  assert.match(result.reason, /上影線/);
  assert.ok(result.evidence.some(item => item.includes("波動度") && item.includes("上影線比例")));
});

test("TDCC observations are supporting evidence with exact source dates, not a guessed stage input", () => {
  const result = buildChipCycleObservation({
    bars: markupBars(),
    institutionalSummary: institution(5000, 10000),
    tdccHistory: { observations: [
      { date: "2026-09-04", topThreeSourceLevelsPct: 24.2, source: "TDCC" },
      { date: "2026-09-11", topThreeSourceLevelsPct: 24.8, source: "TDCC" },
    ] },
  });
  assert.equal(result.sufficiency.status, "AVAILABLE");
  assert.equal(result.sufficiency.score, 100);
  assert.ok(result.sourceObservations.some(item => item.label === "TDCC 第 13–15 級占比" && item.asOf === "2026-09-11"));
  assert.match(result.tdccHistory, /2 個官方來源日期/);
});

test("missing OHLCV or incomplete institutional windows fail closed without zero filling", () => {
  const short = buildChipCycleObservation({ bars: bars().slice(0, 12), institutionalSummary: institution() });
  assert.equal(short.status, "INSUFFICIENT_EVIDENCE");
  assert.match(short.missing[0], /12\/20/);
  const noInstitution = buildChipCycleObservation({ bars: bars(), institutionalSummary: { fiveSessions: { sessions: 3, complete: false, allThreeNetShares: null } } });
  assert.equal(noInstitution.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(noInstitution.stage, "INSUFFICIENT_EVIDENCE");
  assert.match(noInstitution.missing[0], /三大法人/);
  assert.deepEqual(short.evidence, []);
});

test("mixed or weak evidence shows rule scores and insufficiency rather than an unexplained phase", () => {
  const result = buildChipCycleObservation({ bars: bars({ direction: 0 }), institutionalSummary: institution(0, 0, "NEUTRAL", 0) });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.stage, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.stageScores.length, 5);
  assert.match(result.reason, /不產生階段標籤/);
});

test("renderer exposes the candidate, dated observations, rule score details, and explicit insufficiency", () => {
  const available = renderChipCycleObservation(buildChipCycleObservation({ bars: bars(), institutionalSummary: institution(5000, 10000) }));
  assert.match(available, /data-chip-cycle-rule="zhuge-wyckoff-evidence-v2"/);
  assert.match(available, /五階段分數、規則與來源證據/);
  assert.match(available, /P4_MARKUP/);
  assert.match(available, /TWSE/);
  const missing = renderChipCycleObservation(buildChipCycleObservation({ bars: [], institutionalSummary: null }));
  assert.match(missing, /data-chip-cycle-status="INSUFFICIENT_EVIDENCE"/);
  assert.match(missing, /未判定階段/);
});
