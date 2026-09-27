"use strict";

/* Deterministic developer vectors only. These are not product data and are
 * never loaded by the Investment runtime. They exercise the real
 * Context Pack -> Analysis -> Scanner -> Homework path without a provider or
 * an external AI score. */
module.exports = Object.freeze([
  Object.freeze({
    id: "2330.TW",
    context: Object.freeze({
      contract: "zhuge-investment-context-pack-v1",
      symbol: "2330",
      market: "TW",
      marketPhase: Object.freeze({ phase: "CLOSED", source: "TWSE", asOf: "2026-09-26T06:30:00.000Z" }),
      strategyIds: Object.freeze(["ma_golden_cross", "growth_quality"]),
      evidence: Object.freeze([
        Object.freeze({ type: "market_quote", source: "TWSE", observedAt: "2026-09-26T06:30:00.000Z", facts: ["price=1200"] }),
        Object.freeze({ type: "ohlc", source: "TWSE", observedAt: "2026-09-25T06:30:00.000Z", facts: ["sma20=1180"] }),
        Object.freeze({ type: "fundamental", source: "TWSE", observedAt: "2026-09-18", facts: ["revenue_growth=12%"] }),
        Object.freeze({ type: "industry", source: "TWSE", observedAt: "2026-09-18", facts: ["industry=semiconductor"] })
      ])
    }),
    expected: Object.freeze({ technical: "AVAILABLE", fundamental: "AVAILABLE", scanner: "READY", selected: 2 })
  }),
  Object.freeze({
    id: "0050.TW",
    context: Object.freeze({
      contract: "zhuge-investment-context-pack-v1",
      symbol: "0050",
      market: "TW",
      marketPhase: Object.freeze({ phase: "CLOSED", source: "TWSE", asOf: "2026-09-26T06:30:00.000Z" }),
      strategyIds: Object.freeze(["ma_golden_cross", "growth_quality"]),
      missing: Object.freeze(["fundamental_evidence"]),
      evidence: Object.freeze([
        Object.freeze({ type: "market_quote", source: "TWSE", observedAt: "2026-09-26T06:30:00.000Z", facts: ["price=180"] }),
        Object.freeze({ type: "ohlc", source: "TWSE", observedAt: "2026-09-25T06:30:00.000Z", facts: ["sma20=178"] }),
        Object.freeze({ type: "etf_component", source: "Yuanta PCF", observedAt: "2026-09-18", facts: ["component_count=51", "component=2330"] }),
        Object.freeze({ type: "industry_exposure", source: "TWSE", observedAt: "2026-09-18", facts: ["industry=semiconductor"] }),
        Object.freeze({ type: "related_symbol", source: "Yuanta PCF", observedAt: "2026-09-18", facts: ["related_symbol=2330"] })
      ])
    }),
    expected: Object.freeze({ technical: "AVAILABLE", fundamental: "INSUFFICIENT_EVIDENCE", relationships: "AVAILABLE", scanner: "PARTIAL", selected: 2 })
  }),
  Object.freeze({
    id: "AAPL.US",
    context: Object.freeze({
      contract: "zhuge-investment-context-pack-v1",
      symbol: "AAPL",
      market: "US",
      marketPhase: Object.freeze({ phase: "CLOSED", source: "US exchange calendar", asOf: "2026-09-26T06:30:00.000Z" }),
      strategyIds: Object.freeze(["growth_quality", "expectation_repricing"]),
      evidence: Object.freeze([
        Object.freeze({ type: "market_quote", source: "Yahoo Finance Chart", observedAt: "2026-09-26T06:30:00.000Z", facts: ["price=220"] }),
        Object.freeze({ type: "ohlc", source: "Yahoo Finance Chart", observedAt: "2026-09-25T06:30:00.000Z", facts: ["sma20=218"] }),
        Object.freeze({ type: "fundamental", source: "SEC EDGAR", observedAt: "2026-09-17", facts: ["revenue_growth=8%"] }),
        Object.freeze({ type: "company_profile", source: "SEC EDGAR", observedAt: "2026-09-17", facts: ["industry=technology"] })
      ])
    }),
    expected: Object.freeze({ technical: "AVAILABLE", fundamental: "AVAILABLE", scanner: "READY", selected: 2 })
  })
]);
