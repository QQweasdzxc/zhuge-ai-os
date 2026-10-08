import assert from "node:assert/strict";
import test from "node:test";
import { renderTaiwanMarginBalance, renderTdccOwnership } from "../src/components/taiwan-positioning-evidence.mjs";

test("TDCC view renders all source tiers and optional browser-local history without inferring holder identity", () => {
  const data = Array.from({ length: 17 }, (_, index) => ({
    band: `來源級距 ${index + 1}`,
    holders: index + 1,
    shares: (index + 1) * 100,
    percent: index === 16 ? null : index + 0.5,
  }));
  const html = renderTdccOwnership({ data, dataTimestamp: "2026-10-02" });
  assert.match(html, /2026-10-02/);
  assert.equal((html.match(/<tr>/g) || []).length, 18);
  assert.match(html, /來源級距 17/);
  assert.match(html, /第 16 級為差異數、第 17 級為合計/);
  assert.match(html, /<td>—<\/td>/);
  const withLocalObservation = renderTdccOwnership({ data, dataTimestamp: "2026-10-02" }, {
    status: "AVAILABLE",
    currentDate: "2026-10-02",
    currentTopThreeSourceLevelsPct: 52.75,
    previousDate: "2026-09-25",
    previousTopThreeSourceLevelsPct: 51.5,
    changePercentagePoints: 1.25,
    note: "比較本瀏覽器曾讀取的兩個最近 TDCC 來源日期。",
  });
  assert.match(withLocalObservation, /最高三個來源級距合計/);
  assert.match(withLocalObservation, /52\.75%/);
  assert.match(withLocalObservation, /\+1\.25 個百分點/);
  assert.match(withLocalObservation, /本瀏覽器曾讀取/);
});

test("margin view shows source balance changes only when both dated balances exist", () => {
  const html = renderTaiwanMarginBalance({
    dataTimestamp: "2026-10-07",
    data: { marginBalancePrevious: 1000, marginBalance: 1125, shortBalancePrevious: 250, shortBalance: 225, unit: "交易所表列股數" },
  });
  assert.match(html, /融資餘額/);
  assert.match(html, /融資日變化<\/label><strong>\+125/);
  assert.match(html, /融券日變化<\/label><strong>-25/);
  assert.match(html, /2026-10-07/);
  const partial = renderTaiwanMarginBalance({ data: { marginBalance: 10, marginBalancePrevious: null, shortBalance: null, shortBalancePrevious: 2 } });
  assert.match(partial, /融資日變化<\/label><strong>—/);
  assert.match(partial, /融券餘額<\/label><strong>—/);
  assert.doesNotMatch(partial, /—25/);
});

test("missing TDCC source stays empty for the evidence boundary to render unavailable", () => {
  assert.equal(renderTdccOwnership({ data: null }), "");
});
