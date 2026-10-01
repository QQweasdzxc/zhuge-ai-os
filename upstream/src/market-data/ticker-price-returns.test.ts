import { expect, test } from "bun:test";
import type { TickerFinancials } from "../types/financials";
import { computeTickerPriceReturns } from "./ticker-price-returns";

test("dated return projection cannot recover undated summaries when history is absent", () => {
  const financials: TickerFinancials = {
    annualStatements: [], quarterlyStatements: [], priceHistory: [],
    fundamentals: { return1Y: .12, return3Y: .4 },
  };
  expect(computeTickerPriceReturns(financials)).toEqual({ return1Y: undefined, return3Y: undefined });
  expect(computeTickerPriceReturns(null)).toEqual({ return1Y: undefined, return3Y: undefined });
});

test("return projection preserves the bond history guard and independent compatible equity quotes", () => {
  const financials: TickerFinancials = {
    annualStatements: [], quarterlyStatements: [],
    priceHistory: [{ date: new Date("2025-09-10"), close: 100 }, { date: new Date("2026-09-10"), close: 100 }],
    quote: { symbol: "CONTROL", currency: "USD", price: 105, change: 5, changePercent: 5, lastUpdated: Date.parse("2026-09-11"), instrumentType: "BOND", priceBasis: "per-unit" },
  };
  expect(computeTickerPriceReturns(financials).return1Y).toBe(0);
  financials.quote!.instrumentType = "ETF";
  expect(computeTickerPriceReturns(financials).return1Y).toBe(.05);
  expect(computeTickerPriceReturns(financials, "BOND").return1Y).toBe(0);
  financials.quote = undefined;
  expect(computeTickerPriceReturns(financials).return1Y).toBe(0);
});
