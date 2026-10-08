import assert from "node:assert/strict";
import test from "node:test";
import { loadTreasuryTenYearContext, parseTreasuryTenYearRows } from "../../../supabase/functions/_shared/us-treasury-market-context.mjs";
import { clearProviderCache } from "../src/lib/http-cache.mjs";
import { renderUsTreasuryContext } from "../src/components/us-treasury-context.mjs";

const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"><entry><d:NEW_DATE m:type="Edm.DateTime">2026-10-05T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.95</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">4.12</d:BC_10YEAR><d:BC_30YEAR>4.75</d:BC_30YEAR></entry><entry><d:NEW_DATE>2026-10-06T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.98</d:BC_2YEAR><d:BC_10YEAR>4.18</d:BC_10YEAR><d:BC_30YEAR>4.80</d:BC_30YEAR></entry><entry><d:NEW_DATE>2026-10-07</d:NEW_DATE><d:BC_10YEAR>null</d:BC_10YEAR></entry></feed>`;

test("official Treasury XML parser selects latest dated non-null 10-year value without accepting future observations", () => {
  assert.deepEqual(parseTreasuryTenYearRows(xml, { now: Date.parse("2026-10-06T20:00:00Z") }), { date: "2026-10-06", twoYearPct: 3.98, tenYearPct: 4.18, thirtyYearPct: 4.8, tenYearMinusTwoYearPct: 0.2 });
  assert.equal(parseTreasuryTenYearRows("<feed><entry><d:NEW_DATE>2026-10-06</d:NEW_DATE><d:BC_10YEAR>null</d:BC_10YEAR></entry></feed>", { now: Date.parse("2026-10-06") }), null);
});

test("Treasury provider requests only the official year feed and returns dated, delayed context", async () => {
  clearProviderCache();
  let requested;
  let fetchCount = 0;
  const evidence = await loadTreasuryTenYearContext({
    now: () => Date.parse("2026-10-06T20:00:00Z"),
    fetchImpl: async (url, init) => {
      fetchCount += 1;
      requested = { url, init };
      return { ok: true, status: 200, text: async () => xml };
    },
  });
  assert.equal(new URL(requested.url).origin, "https://home.treasury.gov");
  assert.equal(new URL(requested.url).searchParams.get("data"), "daily_treasury_yield_curve");
  assert.equal(new URL(requested.url).searchParams.get("field_tdr_date_value"), "2026");
  assert.equal(evidence.status, "AVAILABLE");
  assert.equal(evidence.data.tenYearPct, 4.18);
  assert.equal(evidence.data.twoYearPct, 3.98);
  assert.equal(evidence.data.thirtyYearPct, 4.8);
  assert.equal(evidence.data.tenYearMinusTwoYearPct, 0.2);
  assert.equal(evidence.dataTimestamp, "2026-10-06");
  assert.equal(evidence.delayed, true);
  assert.equal(evidence.dataTruth, "OFFICIAL");
  assert.equal(evidence.attribution, "U.S. Department of the Treasury");
  assert.match(evidence.note, /並非股票行情/);
  const cached = await loadTreasuryTenYearContext({
    now: () => Date.parse("2026-10-06T20:05:00Z"),
    fetchImpl: async () => { fetchCount += 1; throw new Error("cached request should not fetch again"); },
  });
  assert.equal(fetchCount, 1);
  assert.equal(cached.fallback, false);
  assert.equal(cached.fetchedAt, evidence.fetchedAt);
  clearProviderCache();
});

test("official macro context UI never fabricates missing values or allows unsafe source links", () => {
  const available = renderUsTreasuryContext({ available: true, provider: "U.S. Treasury", dataTimestamp: "2026-10-06", freshness: "fresh", data: { twoYearPct: 3.98, tenYearPct: 4.18, thirtyYearPct: 4.8, tenYearMinusTwoYearPct: 0.2 }, source: ["https://home.treasury.gov/feed"] });
  assert.match(available, /4\.18%/);
  assert.match(available, /3\.98%/);
  assert.match(available, /10Y − 2Y/);
  assert.match(available, /0\.20 個百分點/);
  assert.match(available, /2026-10-06/);
  assert.match(available, /官方每日殖利率/);
  const missing = renderUsTreasuryContext({ available: false, errorCode: "NO_DATA" });
  assert.match(missing, /無可用資料/);
  assert.doesNotMatch(missing, /4\.18/);
  assert.match(renderUsTreasuryContext({ available: true, data: { tenYearPct: null } }), /無可用資料/);
  assert.doesNotMatch(renderUsTreasuryContext({ available: true, data: { tenYearPct: null } }), /0\.00%/);
  assert.doesNotMatch(renderUsTreasuryContext({ available: true, data: { tenYearPct: 3 }, source: ["javascript:alert(1)"] }), /href="javascript:/);
});
