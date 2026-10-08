import assert from "node:assert/strict";
import test from "node:test";
import { renderTaiwanSectorHeatmap } from "../src/components/taiwan-sector-heatmap.mjs";

test("sector heatmap renders source-backed breadth and a scanner filter action", () => {
  const html = renderTaiwanSectorHeatmap([{
    rank: 1,
    venue: "TWSE",
    date: "2026-10-07",
    industry: "半導體業",
    averageChangePercent: 1.25,
    up: 7,
    down: 2,
    flat: 1,
    symbols: 10,
    changeCoverage: 10,
  }]);
  assert.match(html, /sector-heat-tile positive/);
  assert.match(html, /data-action="sector-scan" data-venue="TWSE" data-industry="半導體業"/);
  assert.match(html, /\+1\.25%/);
  assert.match(html, /漲 7 · 跌 2 · 平 1/);
  assert.match(html, /漲跌資料 10/);
});

test("sector heatmap keeps unavailable averages truthful and escapes source labels", () => {
  const html = renderTaiwanSectorHeatmap([{
    venue: 'TWSE" data-extra="x',
    date: "2026-10-07",
    industry: '<script>alert("x")</script>',
    averageChangePercent: null,
    up: 0,
    down: 0,
    flat: 0,
    symbols: 2,
    changeCoverage: 0,
  }]);
  assert.match(html, /sector-heat-tile neutral/);
  assert.match(html, /資料不足/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, / data-extra="x"/);
});

test("empty heatmap reports a source-data empty state", () => {
  assert.match(renderTaiwanSectorHeatmap([]), /沒有可驗證的產業分類日收資料/);
});
