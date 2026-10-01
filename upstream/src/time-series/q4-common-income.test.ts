import { expect, test } from "bun:test";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { parseCompanyFactsFinancialStatements } from "../sources/sec-edgar";
import { computeTTM } from "../plugins/builtin/ticker-detail/financials/aggregation";
import { deriveQuarterlyStatements, extractFundamentalSeries } from "./fundamentals";
import type { SecuritySeriesSource } from "./types";
import fixture from "./fixtures/q4-reported-common-income.json";

const q4 = (rows: FinancialStatement[]) => rows.find(row => row.date === "2025-12-31")!;
const source = (period: SecuritySeriesSource["period"]): SecuritySeriesSource => ({ kind: "security",
  instrument: { symbol: "JPM", exchange: "NYSE" }, fieldId: "valuation.trailingPE", period, timestampMode: "period-end" });
function snapshot(quarterlyStatements: FinancialStatement[]): TickerFinancials {
  return { quarterlyStatements, annualStatements: [fixture.annual], financialCurrency: "USD",
    priceHistory: [{ date: new Date("2025-12-31"), close: 100 }],
    quote: { symbol: "JPM", currency: "USD", price: 100, change: 0, changePercent: 0, lastUpdated: Date.parse("2026-03-10T12:00:00Z") },
  };
}

test("captured JPM SEC history cannot infer a Q4 common allocation from independent annual and quarterly amounts", () => {
  // Same issuer supplement: FY common 55,681m minus Q1–Q3 gives 12,691m,
  // but reported Q4 is 12,689m. The SEC Q4 balance-only row has no explicit
  // common-income coverage gap, so an unavailableFields guard is insufficient.
  const parsed = parseCompanyFactsFinancialStatements(fixture.companyfacts);
  expect(q4(parsed.quarterlyStatements).unavailableFields).toBeUndefined();
  const original = structuredClone(parsed);
  const derived = q4(deriveQuarterlyStatements(parsed.quarterlyStatements, parsed.annualStatements));
  expect(derived.netIncomeCommonStockholders).toBeUndefined();
  expect(derived.fieldAvailability?.netIncomeCommonStockholders).toBeUndefined();
  expect(derived.fieldSources?.netIncomeCommonStockholders).toBeUndefined();
  expect(derived.netIncome).toBe(fixture.quarterly[3]!.netIncome);
  expect(parsed).toEqual(original);
});

test("missing common allocations do not suppress additive parent income or revenue completion", () => {
  const derived = q4(deriveQuarterlyStatements(fixture.quarterly.slice(0, 3), [fixture.annual]));
  expect(derived.netIncomeCommonStockholders).toBeUndefined();
  expect(derived.netIncome).toBe(13_025_000_000);
  expect(derived.totalRevenue).toBe(45_798_000_000);
});

test("direct common allocations retain their reported TTM sum and income-per-share denominator", () => {
  const quarters = fixture.quarterly.map(({ eps: _eps, ...row }) => row);
  const derived = deriveQuarterlyStatements(quarters, [fixture.annual]);
  expect(q4(derived).netIncomeCommonStockholders).toBe(12_689_000_000);
  expect(computeTTM(derived)?.netIncomeCommonStockholders).toBe(55_679_000_000);
  const shares = quarters.reduce((sum, row) => sum + row.dilutedShares, 0) / 4;
  expect(extractFundamentalSeries(snapshot(quarters), source("ttm")).at(-1)?.value).toBeCloseTo(100 * shares / 55_679_000_000, 10);
  for (const common of [0, -1_000_000]) {
    const direct = quarters.map(row => row.date === fixture.annual.date ? { ...row, netIncomeCommonStockholders: common } : row);
    expect(q4(deriveQuarterlyStatements(direct, [fixture.annual])).netIncomeCommonStockholders).toBe(common);
  }
});

test("missing Q4 common income leaves the TTM earnings fallback unavailable until reported data arrives", () => {
  const quarters = fixture.quarterly.map(({ eps: _eps, ...row }, index) => ({ ...row,
    ...(index === 3 ? { netIncomeCommonStockholders: undefined } : {}),
  }));
  const data = snapshot(quarters);
  for (const period of ["ttm", "auto"] as const) expect(extractFundamentalSeries(data, source(period))).toEqual([]);
  // Complete reported EPS retains precedence despite an incomplete allocation.
  data.quarterlyStatements = quarters.map((row, index) => ({ ...row, eps: fixture.quarterly[index]!.eps }));
  expect(extractFundamentalSeries(data, source("ttm")).at(-1)?.value).toBeCloseTo(100 / 20.01, 10);
});
