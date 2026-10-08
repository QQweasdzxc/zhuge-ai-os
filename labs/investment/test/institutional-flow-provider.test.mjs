import assert from "node:assert/strict";
import test from "node:test";
import { clearProviderCache } from "../src/lib/http-cache.mjs";
import { loadInstitutional } from "../src/providers/official-taiwan.mjs";

const TWSE_FIELDS = [
  "證券代號",
  "外陸資買賣超股數(不含外資自營商)",
  "投信買賣超股數",
  "自營商買賣超股數",
  "三大法人買賣超股數",
];

function weekdayDates(endDate, limit) {
  const cursor = new Date(`${endDate}T12:00:00.000Z`);
  const dates = [];
  for (; dates.length < limit;) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  clearProviderCache();
  globalThis.fetch = handler;
  return Promise.resolve().then(run).finally(() => {
    globalThis.fetch = originalFetch;
    clearProviderCache();
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("TWSE T86 institutional evidence loads dated sessions and exposes complete 5/10-day totals", async () => {
  await withFetch(async input => {
    const url = new URL(String(input));
    const key = url.searchParams.get("date");
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    return jsonResponse({ date, fields: TWSE_FIELDS, data: [["2330", "10", "-2", "3", "11"]] });
  }, async () => {
    const evidence = await loadInstitutional({ symbol: "2330", market: "TW", venue: "TWSE" }, "2026-10-07");
    assert.equal(evidence.status, "AVAILABLE");
    assert.equal(evidence.dataTimestamp, "2026-10-07");
    assert.equal(evidence.data.historySummary.points.length, 10);
    assert.equal(evidence.data.historySummary.fiveSessions.foreignNetShares, 50);
    assert.equal(evidence.data.historySummary.fiveSessions.trustNetShares, -10);
    assert.equal(evidence.data.historySummary.tenSessions.allThreeNetShares, 110);
    assert.equal(evidence.data.historySummary.fiveSessions.complete, true);
    assert.equal(evidence.data.historySummary.tenSessions.complete, true);
    assert.equal(evidence.data.historySummary.streaks.foreignNetShares.sessions, 10);
    assert.equal(evidence.source.length, 12);
  });
});

test("TWSE T86 institutional evidence keeps missing sessions partial instead of filling zeros", async () => {
  const availableDates = new Set(weekdayDates("2026-10-07", 3).map(date => date.replace(/-/g, "")));
  await withFetch(async input => {
    const url = new URL(String(input));
    const key = url.searchParams.get("date");
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    return jsonResponse({ date, fields: TWSE_FIELDS, data: availableDates.has(key) ? [["2330", "10", "-2", "3", "11"]] : [] });
  }, async () => {
    const evidence = await loadInstitutional({ symbol: "2330", market: "TW", venue: "TWSE" }, "2026-10-07");
    assert.equal(evidence.status, "PARTIAL");
    assert.equal(evidence.data.historySummary.points.length, 3);
    assert.equal(evidence.data.historySummary.fiveSessions.foreignNetShares, null);
    assert.equal(evidence.data.historySummary.tenSessions.complete, false);
    assert.equal(evidence.data.historySummary.points.some(point => point.foreignNetShares === 0), false);
  });
});

test("TPEx institutional rows use source dates and derive the three-group total only when all groups exist", async () => {
  const dates = weekdayDates("2026-10-07", 12);
  await withFetch(async () => jsonResponse(dates.map(date => ({
    SecuritiesCompanyCode: "7456",
    Date: date,
    "ForeignInvestorsIncludeMainlandAreaInvestors-Difference": "10",
    "SecuritiesInvestmentTrustCompanies-Difference": "-2",
    "Dealers-Difference": "3",
  }))), async () => {
    const evidence = await loadInstitutional({ symbol: "7456", market: "TW", venue: "TPEX" });
    assert.equal(evidence.status, "AVAILABLE");
    assert.equal(evidence.data.historySummary.points.length, 10);
    assert.equal(evidence.data.foreignNetShares, 10);
    assert.equal(evidence.data.allThreeNetShares, 11);
    assert.equal(evidence.data.historySummary.tenSessions.allThreeNetShares, 110);
    assert.equal(evidence.data.historySummary.tenSessions.complete, true);
  });
});
