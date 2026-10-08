import assert from "node:assert/strict";
import test from "node:test";
import { renderInstitutionalFlowSummary } from "../src/components/institutional-flow-view.mjs";
import { summarizeInstitutionalFlows } from "../src/domain/institutional-flow-summary.mjs";

const points = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  foreignNetShares: 100 + index,
  trustNetShares: -20,
  dealerNetShares: 5,
  allThreeNetShares: 85 + index,
}));

test("institutional summary UI presents actual 5/10-session flows and directional streaks", () => {
  const html = renderInstitutionalFlowSummary(summarizeInstitutionalFlows(points));
  assert.match(html, /近 5 個來源交易日/);
  assert.match(html, /近 10 個來源交易日/);
  assert.match(html, /2026-09-01 至 2026-09-10/);
  assert.match(html, /連買 10 個交易日/);
  assert.match(html, /連賣 10 個交易日/);
  assert.match(html, /\+1,045 股/);
});

test("institutional summary UI labels incomplete history and does not present missing flows as zero", () => {
  const summary = summarizeInstitutionalFlows(points.slice(0, 3).map((point, index) => ({ ...point, date: `2026-09-0${index + 1}` })));
  const html = renderInstitutionalFlowSummary(summary);
  assert.match(html, /資料不足：3\/5 個來源交易日/);
  assert.match(html, /資料不足：3\/10 個來源交易日/);
  assert.match(html, /外資/);
  assert.match(html, />—</);
  assert.doesNotMatch(html, /<td>0 股<\/td>/);
});
