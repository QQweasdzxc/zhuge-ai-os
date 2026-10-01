import { expect, test } from "bun:test";
import { parseCompanyFactsFinancialStatements } from "./sec-edgar";
import { mergeFinancialStatementRows } from "../utils/financial-statements";
import { deriveQuarterlyStatements, extractFundamentalSeries } from "../time-series/fundamentals";
import { computeTTM } from "../plugins/builtin/ticker-detail/financials/aggregation";
import { financialStatementsHeadless } from "../plugins/builtin/ticker-detail/headless";
import { createTestDataProvider } from "../test-support/data-provider";

const annual = { start: "2025-01-01", end: "2025-12-31", form: "10-K", fp: "FY", filed: "2026-02-01", accn: "0000000001-26-000001" };
const quarter = { ...annual, start: "2025-10-01", frame: "CY2025Q4" };
const fact = (rows: object[]) => ({ units: { USD: rows } });
function statements() { return parseCompanyFactsFinancialStatements({ facts: { "us-gaap": {
  NetIncomeLoss: fact([{ ...annual, val: 100 }]),
  ProfitLoss: fact([{ ...annual, val: 120 }, { ...quarter, val: 40 }]),
  NetIncomeLossAvailableToCommonStockholdersBasic: fact([{ ...annual, val: 90 }, { ...quarter, val: 30 }]),
} } }); }

test("SEC income bases retain separate facts and parent coverage gaps through either merge order and JSON", async () => {
  const parsed = statements();
  expect(parsed.annualStatements[0]).toMatchObject({ netIncome: 100, netIncomeIncludingNoncontrollingInterests: 120, netIncomeCommonStockholders: 90 });
  const latest = parsed.quarterlyStatements[0]!;
  expect(latest.netIncome).toBeUndefined();
  expect(latest.unavailableFields).toEqual(["netIncome"]);
  expect(latest.fieldSources?.netIncomeIncludingNoncontrollingInterests).toMatchObject({ source: "sec", concept: "ProfitLoss", basis: "consolidated", accessionNumber: quarter.accn, startDate: quarter.start, endDate: quarter.end, unit: "USD" });
  for (const primary of [true, false]) {
    const vendor = { date: latest.date, currency: "USD", netIncome: 40, netIncomeCommonStockholders: 999, totalRevenue: 200 };
    const rows = mergeFinancialStatementRows(primary ? [latest] : [vendor], primary ? [vendor] : [latest]);
    const [merged] = JSON.parse(JSON.stringify(rows));
    expect(merged.netIncome).toBeUndefined(); expect(merged.netIncomeCommonStockholders).toBe(30); expect(merged.totalRevenue).toBe(200);
    expect(merged.fieldSources.netIncomeCommonStockholders.concept).toBe("NetIncomeLossAvailableToCommonStockholdersBasic");
    const report = await financialStatementsHeadless.load({ symbols: ["CONTROL"], options: { period: "quarterly", statement: "income" } } as any, { marketData: createTestDataProvider({ getTickerFinancials: async () => ({ ...parsed, quarterlyStatements: [merged], priceHistory: [] }) }) } as any);
    expect(report.rows.find(row => row.id === "income:net")?.cells).toMatchObject([{ value: null }]);
    expect(report.rows.find(row => row.id === "netIncomeIncludingNoncontrollingInterests:1")?.cells).toMatchObject([{ value: 40 }]);
    expect((report.metadata?.columns as any[])[0].unavailableFields).toEqual(["netIncome"]);
  }
});

test("explicit income gaps block Q4 reconstruction and incomplete TTM while preserving consolidated and common totals", () => {
  const parsed = statements();
  const quarters = ["2025-03-31", "2025-06-30", "2025-09-30"].map(date => ({ date, currency: "USD", netIncome: 20, netIncomeIncludingNoncontrollingInterests: 25, netIncomeCommonStockholders: 18 }));
  quarters.push(parsed.quarterlyStatements[0]! as any);
  const derived = deriveQuarterlyStatements(quarters, parsed.annualStatements);
  expect(derived.at(-1)?.netIncome).toBeUndefined();
  expect(derived.at(-1)?.unavailableFields).toContain("netIncome");
  expect(derived.at(-1)?.netIncomeIncludingNoncontrollingInterests).toBe(40);
  const ttm = computeTTM(derived)!;
  expect(ttm.netIncome).toBeUndefined(); expect(ttm.netIncomeIncludingNoncontrollingInterests).toBe(115); expect(ttm.netIncomeCommonStockholders).toBe(84);
  expect(ttm.aggregation?.sourcePeriods.at(-1)?.fieldSources?.netIncomeIncludingNoncontrollingInterests?.basis).toBe("consolidated");
});

test("a recovered parent zero clears stale coverage gaps without deriving it from consolidated income", () => {
  const old = statements().quarterlyStatements[0]!;
  const recovered = parseCompanyFactsFinancialStatements({ facts: { "us-gaap": { NetIncomeLoss: fact([{ ...quarter, val: 0 }]), ProfitLoss: fact([{ ...quarter, val: 40 }]) } } }).quarterlyStatements[0]!;
  const merged = mergeFinancialStatementRows([recovered], [old])[0]!;
  expect(merged.netIncome).toBe(0); expect(merged.unavailableFields).not.toContain("netIncome");
  expect(merged.fieldSources?.netIncome?.basis).toBe("parent");
});

const source = (filed: string, endDate = "2025-06-30") => ({ source: "sec" as const, concept: "NetIncomeLoss", basis: "parent" as const, unit: "USD", endDate, filed });
test("income overrides require the same period and income revisions use their own dates", () => {
  const vendor = { date: "2025-06-27", currency: "USD", netIncome: 100 };
  const sec = { date: "2025-06-30", currency: "USD", netIncome: 200, fieldSources: { netIncome: source("2025-08-01") } };
  const merged = mergeFinancialStatementRows([vendor], [sec])[0]!;
  expect(merged.netIncome).toBe(100); expect(merged.fieldSources?.netIncome).toBeUndefined();
  const old = { ...sec, netIncome: 70, totalAssets: 100, fieldAvailability: { netIncome: "2025-08-01", totalAssets: "2026-08-01" } };
  const revision = { ...sec, netIncome: 80, fieldSources: { netIncome: source("2026-05-01") }, fieldAvailability: { netIncome: "2026-05-01" } };
  expect(deriveQuarterlyStatements([old, revision], [])[0]?.netIncome).toBe(80);
  expect(mergeFinancialStatementRows([old], [revision])[0]?.netIncome).toBe(80);
  const contradictory = { ...revision, fieldAvailability: { netIncome: "2025-08-01" } };
  expect(mergeFinancialStatementRows([old], [contradictory])[0]?.fieldAvailability?.netIncome).toBe("2026-05-01");
  const sparse = JSON.parse(JSON.stringify({ ...statements().quarterlyStatements[0], date: "2025-06-30" }));
  const sparseMerge = mergeFinancialStatementRows([{ date: "2025-06-27", totalRevenue: 500 }], [sparse])[0]!;
  expect(sparseMerge.unavailableFields).toBeUndefined();
  expect(sparseMerge.fieldSources).toBeUndefined();
  const chartMerge = deriveQuarterlyStatements([
    { date: "2025-06-27", currency: "USD", totalAssets: 500, fieldAvailability: { totalAssets: "2026-08-01" } }, sec,
  ], []);
  expect(chartMerge[0]?.date).toBe("2025-06-27");
  expect(chartMerge[0]?.netIncome).toBeUndefined();
});

test("explicit common-income gaps block parent-based EPS fallback while reported EPS remains usable", () => {
  const financials = { ...statements(), priceHistory: [] };
  const row = { ...financials.annualStatements[0]!, netIncomeCommonStockholders: undefined, dilutedShares: 10, unavailableFields: ["netIncomeCommonStockholders" as const] };
  delete row.fieldSources?.netIncomeCommonStockholders;
  financials.annualStatements = [row]; financials.quarterlyStatements = [];
  const priceHistory = [{date: new Date("2026-03-01"),close:20}];
  const input = { ...financials, priceHistory, quote: { symbol: "CONTROL", price:20, currency:"USD", change:0, changePercent:0,lastUpdated:Date.parse("2026-03-01") } };
  const spec = { kind: "security", symbol: "CONTROL", fieldId: "valuation.trailingPE", period: "annual" } as any;
  expect(extractFundamentalSeries(input,spec).some(point => point.value === 2)).toBe(false);
  row.eps = 2; row.fieldAvailability = { ...row.fieldAvailability, eps: "2026-02-01" };
  expect(extractFundamentalSeries(input,spec).some(point => point.value === 10)).toBe(true);
});
