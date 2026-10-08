import assert from "node:assert/strict";
import test from "node:test";
import { renderTaiwanScanResults } from "../src/components/taiwan-scan-results.mjs";

const row = {
  rank: 1,
  symbol: "7456",
  name: "Example Holdings",
  venue: "TPEX",
  date: "2026-10-07",
  industry: "半導體業",
  close: 100,
  change: 2,
  changePercent: 2.04,
  volume: 10000,
  tradeValue: 1000000,
  score: 92,
  scoreComponents: { dailyChangePercentile: 100, tradeValuePercentile: 80 },
};

test("Taiwan scanner table mode preserves ranked source identity and research route", () => {
  const html = renderTaiwanScanResults([row], "table");
  assert.match(html, /class="data-table scanner-table"/);
  assert.match(html, /7456 Example Holdings/);
  assert.match(html, /\+2\.04%/);
  assert.match(html, /data-venue="TPEX" data-symbol="7456"/);
  assert.match(html, /官方日收 · 非即時/);
  assert.match(html, /漲跌百分位 100 × 60% \+ 成交額百分位 80 × 40%/);
});

test("Taiwan scanner card mode presents the same ranked row without inventing fields", () => {
  const html = renderTaiwanScanResults([row], "cards");
  assert.match(html, /class="scanner-grid"/);
  assert.match(html, /#1 · 7456/);
  assert.match(html, /Example Holdings/);
  assert.match(html, /NT\$ 1,000,000/);
  assert.match(html, /開啟研究/);
  assert.doesNotMatch(renderTaiwanScanResults([{ ...row, close: null, change: null, tradeValue: null }], "cards"), /NT\$ 0/);
});

test("Taiwan scanner with no result rows stays explicitly empty", () => {
  assert.match(renderTaiwanScanResults([], "cards"), /目前篩選條件沒有符合的標的/);
});
