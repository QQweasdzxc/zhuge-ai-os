import assert from "node:assert/strict";
import test from "node:test";
import { clearProviderCache } from "../src/lib/http-cache.mjs";
import { loadMarketPulse } from "../src/providers/official-taiwan.mjs";

const tradeDate = "2026/10/06";
const tpexInstitutions = [
  { Date: tradeDate, SecuritiesCompanyCode: "7456", "ForeignInvestorsIncludeMainlandAreaInvestors-Difference": "100", "SecuritiesInvestmentTrustCompanies-Difference": "20", "Dealers-Difference": "-5" },
  { Date: tradeDate, SecuritiesCompanyCode: "6488", "ForeignInvestorsIncludeMainlandAreaInvestors-Difference": "-30", "SecuritiesInvestmentTrustCompanies-Difference": "10", "Dealers-Difference": "5" },
  { Date: "2026/10/05", SecuritiesCompanyCode: "7456", "ForeignInvestorsIncludeMainlandAreaInvestors-Difference": "900", "SecuritiesInvestmentTrustCompanies-Difference": "900", "Dealers-Difference": "900" },
];

function fixturePayload(url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/FMTQIK")) return { data: [[tradeDate, "100", "200", "300", "22000", "20"]] };
  if (parsed.pathname.endsWith("/STOCK_DAY_ALL")) return [{ Code: "2330", Date: tradeDate, Change: "2" }];
  if (parsed.pathname.endsWith("/tpex_mainboard_daily_close_quotes")) return [{ SecuritiesCompanyCode: "7456", Date: tradeDate, Change: "-1" }];
  if (parsed.pathname.endsWith("/fund/T86")) return {
    date: tradeDate,
    fields: ["證券代號", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
    data: [["2330", "1000", "200", "-50", "1150"]],
  };
  if (parsed.pathname.endsWith("/tpex_3insti_daily_trading")) return tpexInstitutions.map(row => ({ ...row }));
  if (parsed.pathname.endsWith("/exchangeReport/MI_MARGN")) return {
    date: tradeDate,
    fields: ["股票代號", "融資今日餘額", "融券今日餘額", "日期"],
    data: [["2330", "1,000", "200", tradeDate], ["2317", "3,000", "400", tradeDate]],
  };
  if (parsed.pathname.endsWith("/tpex_mainboard_margin_balance")) return [
    { SecuritiesCompanyCode: "7456", Date: tradeDate, MarginPurchaseBalance: "500", ShortSaleBalance: "60" },
    { SecuritiesCompanyCode: "6488", Date: tradeDate, MarginPurchaseBalance: "700", ShortSaleBalance: "90" },
  ];
  throw new Error(`Unexpected provider URL: ${url}`);
}

async function withProviderFixture(run, { duplicateInstitution = false, partialMargin = false } = {}) {
  const previous = globalThis.fetch;
  clearProviderCache();
  globalThis.fetch = async input => {
    const url = String(input);
    const value = fixturePayload(url);
    if (duplicateInstitution && new URL(url).pathname.endsWith("/tpex_3insti_daily_trading")) value.push({ ...value[0] });
    if (partialMargin && new URL(url).pathname.endsWith("/tpex_mainboard_margin_balance")) value[1].MarginPurchaseBalance = "";
    return Response.json(value);
  };
  try { return await run(); }
  finally { globalThis.fetch = previous; clearProviderCache(); }
}

test("Taiwan market overview surfaces dated TWSE/TPEx institutional and margin totals", async () => {
  await withProviderFixture(async () => {
    const result = await loadMarketPulse();
    assert.equal(result.institutions.status, "AVAILABLE");
    assert.equal(result.institutions.data.allThreeNetShares, 1150);
    assert.equal(result.tpexInstitutions.status, "AVAILABLE");
    assert.equal(result.tpexInstitutions.dataTimestamp, "2026-10-06");
    assert.equal(result.tpexInstitutions.data.foreignNetShares, 70);
    assert.equal(result.tpexInstitutions.data.trustNetShares, 30);
    assert.equal(result.tpexInstitutions.data.dealerNetShares, 0);
    assert.equal(result.tpexInstitutions.data.allThreeNetShares, 100);
    assert.equal(result.margin.status, "AVAILABLE");
    assert.equal(result.margin.data.TWSE.data.marginBalance, 4000);
    assert.equal(result.margin.data.TWSE.data.shortBalance, 600);
    assert.equal(result.margin.data.TPEx.data.marginBalance, 1200);
    assert.equal(result.margin.data.TPEx.data.shortBalance, 150);
    assert.match(result.margin.note, /不提供跨市場合計/);
  });
});

test("duplicate TPEx institutional rows and incomplete margin fields do not become totals", async () => {
  await withProviderFixture(async () => {
    const result = await loadMarketPulse();
    assert.equal(result.tpexInstitutions.status, "PARTIAL");
    assert.equal(result.tpexInstitutions.data.duplicateRows, 1);
    assert.equal(result.tpexInstitutions.data.allThreeNetShares, null);
    assert.equal(result.margin.status, "PARTIAL");
    assert.equal(result.margin.data.TPEx.status, "PARTIAL");
    assert.equal(result.margin.data.TPEx.data.marginBalance, null);
    assert.equal(result.margin.data.TPEx.data.shortBalance, 150);
  }, { duplicateInstitution: true, partialMargin: true });
});
