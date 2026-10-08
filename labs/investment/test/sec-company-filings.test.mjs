import test from "node:test";
import assert from "node:assert/strict";
import { mapSecCompanyFilings } from "../../../supabase/functions/_shared/sec-company-filings.mjs";

const recent = {
  form: ["8-K", "10-Q", "13F-HR", "10-K"],
  filingDate: ["2026-10-06", "2026-08-01", "2026-07-01", "2026-03-01"],
  reportDate: ["2026-10-05", "2026-06-30", "2026-06-30", "2025-12-31"],
  accessionNumber: ["0000320193-26-000001", "0000320193-26-000002", "0000320193-26-000003", "0000320193-26-000004"],
  primaryDocument: ["aapl-20261006.htm", "aapl-20260801.htm", "aapl-13f.htm", "aapl-20260301.htm"],
  primaryDocDescription: ["Current Report", "Quarterly Report", "Holdings", "Annual Report"],
};

test("SEC company filings become source-dated official filing items, limited to relevant forms", () => {
  const items = mapSecCompanyFilings({ symbol: "AAPL", cik: "0000320193", payload: { filings: { recent } }, now: Date.parse("2026-10-07T00:00:00Z") });
  assert.equal(items.length, 3);
  assert.equal(items[0].form, "8-K");
  assert.equal(items[0].evidenceType, "official_company_filing");
  assert.equal(items[0].market, "US");
  assert.equal(items[0].source, "SEC EDGAR Company Filings");
  assert.match(items[0].sourceUrl, /sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000001\/aapl-20261006\.htm/);
  assert.match(items[0].summary, /不代表新聞報導或投資結論/);
  assert.equal(items[0].freshness, "fresh");
});

test("SEC filing mapper bounds rows and rejects unsafe CIK, document paths, and unknown forms", () => {
  const unsafe = {
    ...recent,
    form: ["8-K", "8-K"],
    filingDate: ["2026-10-06", "2026-10-06"],
    accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"],
    primaryDocument: ["../private.htm", "normal.htm"],
  };
  assert.deepEqual(mapSecCompanyFilings({ symbol: "AAPL", cik: "0000320193", payload: { filings: { recent: unsafe } } }).map(row => row.title), ["AAPL · SEC 8-K · Quarterly Report"]);
  assert.deepEqual(mapSecCompanyFilings({ symbol: "AAPL", cik: "not-a-cik", payload: { filings: { recent } } }), []);
  assert.deepEqual(mapSecCompanyFilings({ symbol: "AAPL", cik: "0000320193", payload: {} }), []);
});
