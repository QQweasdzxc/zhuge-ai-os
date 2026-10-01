import { expect, test } from "bun:test";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { createDefaultConfig } from "../types/config";
import { createTestDataProvider } from "../test-support/data-provider";
import { loadChartPaneModel } from "../plugins/builtin/chart-composer/headless";
import fixture from "./fixtures/q4-reported-per-share.json";
import { deriveQuarterlyStatements, extractFundamentalSeries } from "./fundamentals";
import type { ChartSpec, SecuritySeriesSource } from "./types";

function source(fieldId: string, period: SecuritySeriesSource["period"]): SecuritySeriesSource {
  return { kind: "security", instrument: { symbol: "JPM" }, fieldId, period, timestampMode: "period-end" };
}

function snapshot(quarterlyStatements: FinancialStatement[], annualStatements: FinancialStatement[]): TickerFinancials {
  return {
    quarterlyStatements, annualStatements, financialCurrency: "USD",
    priceHistory: [{ date: new Date("2025-12-31T00:00:00Z"), close: 100 }],
    quote: { symbol: "JPM", currency: "USD", price: 100, change: 0, changePercent: 0,
      lastUpdated: Date.parse("2026-03-10T12:00:00Z") },
  };
}

test("missing JPM Q4 EPS and share averages are not reconstructed from annual and three quarter amounts", () => {
  // Issuer FY2025 supplement p11 (PDF p12). The arithmetic disagrees even
  // within the same report: EPS 4.64/basic 2,735.5m/diluted 2,740.4m vs the
  // reported Q4 EPS 4.63/basic 2,735.3m/diluted 2,740.5m. Fixture retains source/hash.
  const { annual, quarterly } = fixture.JPM;
  const firstThree = quarterly.slice(0, 3);
  const rows = deriveQuarterlyStatements(firstThree, [annual]);
  const q4 = rows.find(row => row.date === annual.date)!;
  expect(q4.netIncome).toBe(13_025_000_000); // This additive parent flow reconciles.
  expect(q4.eps).toBeUndefined();
  expect(q4.basicShares).toBeUndefined();
  expect(q4.dilutedShares).toBeUndefined();
  expect(q4.fieldAvailability?.eps).toBeUndefined();
  const points = extractFundamentalSeries(snapshot(firstThree, [annual]), source("fundamental.eps", "quarterly"));
  expect(points.at(-1)).toMatchObject({ observedAt: new Date("2025-12-31"), value: null });
});

test("direct JPM and PLD Q4 per-share amounts survive sparse annual enrichment unchanged", () => {
  for (const { annual, quarterly } of [fixture.JPM, fixture.PLD]) {
    const q4 = deriveQuarterlyStatements(quarterly, [annual]).find(row => row.date === annual.date)!;
    const reported = quarterly[3]!;
    expect(q4.eps).toBe(reported.eps);
    expect(q4.basicShares).toBe("basicShares" in reported ? reported.basicShares : undefined);
    expect(q4.dilutedShares).toBe("dilutedShares" in reported ? reported.dilutedShares : undefined);
    const point = extractFundamentalSeries(snapshot(quarterly, [annual]), source("fundamental.eps", "quarterly")).at(-1)!;
    expect(point.value).toBe(reported.eps);
    expect(point.provenance?.quality).toBe("reported");
  }
});

test("annual loss anti-dilution cannot manufacture a quarterly diluted denominator or EPS", () => {
  // Constant 100 basic shares; 20 potential shares dilute profitable quarters
  // but are anti-dilutive for loss periods. Annual net loss excludes them too.
  const quarters: FinancialStatement[] = [
    { date: "2025-03-31", netIncome: 100, eps: 0.83, basicShares: 100, dilutedShares: 120 },
    { date: "2025-06-30", netIncome: -100, eps: -1, basicShares: 100, dilutedShares: 100 },
    { date: "2025-09-30", netIncome: 100, eps: 0.83, basicShares: 100, dilutedShares: 120 },
  ];
  const annual = { date: "2025-12-31", netIncome: -20, eps: -0.2, basicShares: 100, dilutedShares: 100 };
  const missing = deriveQuarterlyStatements(quarters, [annual]).at(-1)!;
  expect(missing).toMatchObject({ date: annual.date, netIncome: -120 });
  expect(missing.eps).toBeUndefined(); // Old formula gives -0.86 instead of -1.20.
  expect(missing.dilutedShares).toBeUndefined(); // Old formula gives 60 instead of 100.
  const reported = { date: annual.date, eps: -1.2, basicShares: 100, dilutedShares: 100 };
  expect(deriveQuarterlyStatements([...quarters, reported], [annual]).at(-1)).toMatchObject(reported);
});

test("unequal quarter durations do not turn a weighted annual count into an equal-weight quarter estimate", () => {
  const annualAverage = (100 * 90 + 100 * 91 + 100 * 92 + 50 * 92) / 365;
  const quarters = ["2025-03-31", "2025-06-30", "2025-09-30"].map(date => ({ date, basicShares: 100, totalRevenue: 10 }));
  const annual = { date: "2025-12-31", basicShares: annualAverage, totalRevenue: 40, ordinarySharesNumber: 50 };
  const q4 = deriveQuarterlyStatements(quarters, [annual]).at(-1)!;
  expect(q4.basicShares).toBeUndefined();
  expect(q4).toMatchObject({ totalRevenue: 10, ordinarySharesNumber: 50 });
});

test("incomplete TTM weighted shares cannot silently switch an earnings denominator to a year-end snapshot", () => {
  const quarters = ["2025-03-31", "2025-06-30", "2025-09-30"].map((date, index) => ({
    date, currency: "USD", netIncomeCommonStockholders: 10, totalRevenue: 100, dilutedShares: [100, 90, 80][index],
  }));
  const annual = { date: "2025-12-31", currency: "USD", netIncomeCommonStockholders: 40, totalRevenue: 400,
    dilutedShares: 85, ordinarySharesNumber: 70 };
  const data = snapshot(quarters, [annual]);
  for (const period of ["ttm", "auto"] as const) {
    expect(extractFundamentalSeries(data, source("valuation.trailingPE", period))).toEqual([]);
  }
  // Period-end capitalization can still use its actual snapshot.
  expect(extractFundamentalSeries(data, source("valuation.priceSales", "ttm")).at(-1)?.value).toBe(17.5);
  expect(extractFundamentalSeries(data, source("fundamental.totalRevenue", "ttm")).at(-1)?.value).toBe(400);
});

test("reported quarterly EPS and complete weighted-share TTM approximations retain their existing behavior", () => {
  const data = snapshot(fixture.JPM.quarterly, [fixture.JPM.annual]);
  // Reported quarter EPS sums to 20.01, while the separately reported annual EPS
  // is 20.02. Keep the existing TTM definition; do not force agreement with FY.
  expect(extractFundamentalSeries(data, source("fundamental.eps", "ttm"))[0]?.value).toBeCloseTo(20.01, 10);
  expect(extractFundamentalSeries(data, source("valuation.trailingPE", "ttm")).at(-1)?.value).toBeCloseTo(100 / 20.01, 10);
  const averageOnly = snapshot(fixture.JPM.quarterly.map(({ eps: _eps, ...row }) => row), []);
  const averageShares = fixture.JPM.quarterly.reduce((sum, row) => sum + row.dilutedShares, 0) / 4;
  expect(extractFundamentalSeries(averageOnly, source("valuation.trailingPE", "ttm")).at(-1)?.value)
    .toBeCloseTo(100 * averageShares / fixture.JPM.annual.netIncome, 10);
});

test("TTM earnings ratios use a complete positive share average when the other basis contains an invalid quarter", () => {
  for (const invalid of [0, -1, NaN, Infinity, undefined]) {
    const quarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((date, index) => ({
      date, currency: "USD", netIncomeCommonStockholders: 25, basicShares: 10,
      dilutedShares: index === 3 ? invalid : 12,
    }));
    expect(extractFundamentalSeries(snapshot(quarters, []), source("valuation.trailingPE", "ttm")).at(-1)?.value).toBe(10);
    // The inverse case retains a complete diluted basis, rather than averaging
    // an invalid basic quarter into a denominator.
    const inverse = quarters.map(row => ({ ...row, basicShares: row.dilutedShares, dilutedShares: 10 }));
    expect(extractFundamentalSeries(snapshot(inverse, []), source("valuation.trailingPE", "ttm")).at(-1)?.value).toBe(10);
  }
});

test("an annual EPS share-basis failure is not relabeled as evidence about a different quarter", () => {
  const annual: FinancialStatement = { ...fixture.JPM.annual,
    epsBasis: { status: "unresolved", source: "sec", originalValue: 20.02, basisDate: "2026-02-13", evidence: [] } };
  const q4 = deriveQuarterlyStatements(fixture.JPM.quarterly.slice(0, 3), [annual]).at(-1)!;
  expect(q4.epsBasis).toBeUndefined();
  expect(q4.eps).toBeUndefined();
  const reported = deriveQuarterlyStatements(fixture.JPM.quarterly, [annual]).at(-1)!;
  expect(reported.eps).toBe(4.63);
});

test("chart export preserves a missing Q4 EPS point until the actual reported quarter arrives", async () => {
  const data = snapshot(fixture.JPM.quarterly.slice(0, 3), [fixture.JPM.annual]);
  const spec: ChartSpec = { version: 1, viewport: { range: "5Y", resolution: "1d" }, panels: [{ id: "main" }], studies: [],
    series: [{ id: "eps", source: source("fundamental.eps", "quarterly"), style: "line", transform: "raw",
      axis: "left", panelId: "main", interpolation: "none" }] };
  const context = { marketData: createTestDataProvider({ getTickerFinancials: async () => data,
    getQuote: async () => data.quote!, getPriceHistoryForResolution: async () => data.priceHistory }),
    apiClient: {} as any, config: createDefaultConfig("/tmp/q4-per-share-test"), signal: new AbortController().signal };
  const missing = await loadChartPaneModel(spec, context);
  expect(missing.series[0]?.points.map(point => point.value)).toEqual([5.07, 5.24, 5.07, null]);
  expect(missing.snapshot.financials[0]?.[1].quarterlyStatements).toHaveLength(3);
  data.quarterlyStatements = fixture.JPM.quarterly;
  const recovered = await loadChartPaneModel(spec, context);
  expect(recovered.series[0]?.points.at(-1)?.value).toBe(4.63);
});
