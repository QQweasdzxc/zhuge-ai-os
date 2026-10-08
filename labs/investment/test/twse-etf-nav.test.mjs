import test from "node:test";
import assert from "node:assert/strict";
import { createTwseEtfNavProvider, twseEtfNavSource } from "../../../supabase/functions/_shared/twse-etf-nav.mjs";

const now = () => Date.parse("2026-10-08T04:00:00.000Z");

test("TWSE MIS NAV provider reads only the resolved ETF venue and preserves the source fields", async () => {
  let requested = null;
  const provider = createTwseEtfNavProvider({
    now,
    fetcher: async (url, options) => {
      requested = { url: new URL(url), options };
      return { ok: true, async json() { return { msgArray: [{ ch: "tse_0050.tw", e: "187.20", f: "186.84", g: "0.19%", c: "9,800,000,000", d: "+120,000", i: "20261008", j: "12:30:00" }] }; } };
    },
  });
  const result = await provider.getFundEvidence({ symbol: "0050", market: "TW", venue: "TWSE" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(requested.url.hostname, "mis.twse.com.tw");
  assert.equal(requested.url.pathname, "/stock/api/getETFNav.jsp");
  assert.equal(requested.url.searchParams.get("ex_ch"), "tse_0050.tw");
  assert.equal(requested.options.method, "GET");
  assert.equal(result.data.nav, 186.84);
  assert.equal(result.data.price, 187.2);
  assert.equal(result.data.reportedPremiumDiscountPct, 0.19);
  assert.equal(result.data.unitsOutstanding, 9_800_000_000);
  assert.equal(result.data.unitsOutstandingChange, 120_000);
  assert.equal(result.dataTimestamp, "2026-10-08 12:30:00");
  assert.equal(result.data.currency, "TWD");
  assert.equal(twseEtfNavSource.documentedFeedFields.d, "change in units");
});

test("TPEx feed uses OTC venue and never treats missing NAV as zero", async () => {
  let requested = null;
  const provider = createTwseEtfNavProvider({
    now,
    fetcher: async url => {
      requested = new URL(url);
      return { ok: true, async json() { return { msgArray: [{ ch: "otc_00999.tw", e: "20.1", f: "-", g: "-", c: "-", d: "-", i: "20261008" }] }; } };
    },
  });
  const result = await provider.getFundEvidence({ symbol: "00999", market: "TW", venue: "TPEX" });
  assert.equal(requested.searchParams.get("ex_ch"), "otc_00999.tw");
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.data, null);
  assert.equal(result.errorCode, "ETF_NAV_FIELDS_MISSING");
});

test("invalid and non-applicable requests fail closed without a feed request", async () => {
  let calls = 0;
  const provider = createTwseEtfNavProvider({ now, fetcher: async () => { calls += 1; throw new Error("unexpected"); } });
  assert.equal((await provider.getFundEvidence({ symbol: "https://example.test", market: "TW" })).status, "UNAVAILABLE");
  assert.equal((await provider.getFundEvidence({ symbol: "AAPL", market: "US" })).status, "NOT_APPLICABLE");
  assert.equal(calls, 0);
});
