const test = require("node:test");
const assert = require("node:assert/strict");
const page = require("../modules/investment/pages/strategy-page.js");

const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const format = { date: value => String(value || "") };

test("Strategy page consumes read-only scanner/homework runtime projections", () => {
  const markup = page.render({
    strategies: [],
    intelligence: {
      strategyScans: [{ symbol: "0050", market: "TW", status: "PARTIAL", matches: [{ id: "growth_quality", name: "成長品質", status: "INSUFFICIENT_EVIDENCE" }], insufficientEvidence: ["成長品質：缺少 fundamental analysis"] }],
      homeworkPacks: [{ symbol: "0050", market: "TW", status: "PARTIAL" }]
    }
  }, { escape, format, strategyLibrary: { list: () => [] } });
  assert.match(markup, /data-investment-strategy-runtime/);
  assert.match(markup, /0050/);
  assert.match(markup, /成長品質/);
  assert.match(markup, /資料不足/);
  assert.match(markup, /不建立策略紀錄/);
});

test("Strategy page does not fabricate runtime results when no scan exists", () => {
  const markup = page.render({ strategies: [], intelligence: {} }, { escape, format, strategyLibrary: { list: () => [] } });
  assert.match(markup, /尚未有即時策略掃描/);
  assert.doesNotMatch(markup, /推薦買進|推薦賣出|AI 分數/);
});
