import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaiwanEtfFundEvidence } from "../src/domain/etf-fund-evidence.mjs";
import { renderTaiwanEtfFundEvidence } from "../src/components/etf-fund-evidence.mjs";

test("ETF NAV premium is computed only from same-date real price and NAV; flow remains independent", () => {
  const evidence = normalizeTaiwanEtfFundEvidence({
    symbol: "TEST",
    quote: { status: "AVAILABLE", provider: "Exchange daily close", dataTimestamp: "2026-10-07", data: { close: 105 } },
    nav: { status: "AVAILABLE", provider: "Issuer NAV", source: "https://issuer.example/nav", dataTimestamp: "2026-10-07 13:30:00", fetchedAt: "2026-10-07T10:00:00Z", data: { nav: 100, currency: "TWD", reportedPremiumDiscountPct: 4.8, unitsOutstanding: 10000, unitsOutstandingChange: 120 } },
    flow: { status: "PARTIAL", provider: "Issuer scale report", dataTimestamp: "2026-10-06", data: { netUnits: 20 } },
    constituents: { status: "AVAILABLE", provider: "Issuer PCF", dataTimestamp: "2026-10-07", data: { items: [{ symbol: "ABC", name: "Example", weightPct: 12.5 }] } },
  });
  assert.equal(evidence.status, "PARTIAL");
  assert.ok(Math.abs(evidence.nav.premiumDiscountPct - 5) < 1e-9);
  assert.equal(evidence.nav.reportedPremiumDiscountPct, 4.8);
  assert.ok(Math.abs(evidence.nav.derivedPremiumDiscountPct - 5) < 1e-9);
  assert.equal(evidence.nav.dataTimestamp, "2026-10-07");
  assert.equal(evidence.scale.unitsOutstanding, 10000);
  assert.equal(evidence.scale.unitsOutstandingChange, 120);
  assert.equal(evidence.scale.note.includes("不等同現金"), true);
  assert.equal(evidence.flow.netUnits, 20);
  assert.equal(evidence.flow.fundScale, null);
  assert.equal(evidence.constituents.items[0].weightPct, 12.5);
  const html = renderTaiwanEtfFundEvidence(evidence);
  assert.match(html, /NAV \/ 預估淨值/);
  assert.match(html, /同日收盤與 NAV/);
  assert.match(html, /官方 feed 折溢價/);
  assert.match(html, /單位變動不是現金淨流入/);
  assert.match(html, /12\.5%/);
});

test("ETF evidence stays partial/unknown when NAV date differs and supports not-applicable", () => {
  const mismatch = normalizeTaiwanEtfFundEvidence({
    quote: { status: "AVAILABLE", dataTimestamp: "2026-10-07", data: { close: 105 } },
    nav: { status: "AVAILABLE", dataTimestamp: "2026-10-06 13:30:00", data: { nav: 100 } },
    flow: { status: "NOT_APPLICABLE" }, constituents: { status: "UNAVAILABLE" },
  });
  assert.equal(mismatch.nav.premiumDiscountPct, null);
  assert.equal(mismatch.status, "PARTIAL");
  const none = normalizeTaiwanEtfFundEvidence({ nav: { status: "NOT_APPLICABLE" }, flow: { status: "NOT_APPLICABLE" }, constituents: { status: "NOT_APPLICABLE" } });
  assert.equal(none.status, "NOT_APPLICABLE");
  assert.match(renderTaiwanEtfFundEvidence(null), /不以市價、指數或零值代替/);
});
