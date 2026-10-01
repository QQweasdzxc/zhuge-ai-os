import { expect, test } from "bun:test";
import { appendLiveQuotePoint } from "./chart-data";
import { resolveChartSpecData } from "./resolve";
import { chartQuoteOverrideKeyForSource } from "./live-quotes";
import { createTestDataProvider } from "../test-support/data-provider";
import { CHART_SPEC_VERSION, type ChartSpec } from "./types";
import type { Quote } from "../types/financials";

const now = Date.parse("2026-09-10T18:00:00Z");
const history = [
  { date: new Date("2026-09-09T16:00:00Z"), open: .86, high: .86, low: .86, close: .86, volume: 1000 },
  { date: new Date("2026-09-10T16:00:00Z"), open: .87, high: .87, low: .87, close: .87, volume: 1000 },
];
const quote = (patch: Partial<Quote> = {}): Quote => ({ symbol: "BONDTEST", instrumentType: "BOND", currency: "USD", priceBasis: "percent-of-par", price: .9, change: -86.1, changePercent: -86.1/87*100, lastUpdated: now, marketState: "REGULAR", sessionConfidence: "explicit", listingExchangeName: "NYSE", ...patch });
const spec: ChartSpec = { version: CHART_SPEC_VERSION, viewport: { range: "1M", resolution: "1d" }, panels: [{ id: "main" }], studies: [], series: [{ id: "bond", source: { kind: "security", instrument: { symbol: "BONDTEST", exchange: "NYSE" }, fieldId: "market.close" }, style: "line", transform: "raw", axis: "left", panelId: "main", interpolation: "none" }] };

test("a bond quote cannot declare the independent history's price basis", () => {
  for (const priceBasis of [undefined, "per-unit", "percent-of-par"] as const) {
    const result = appendLiveQuotePoint(history, quote({ priceBasis }), { now, mode: "ohlc", resolution: "1d", exchange: "NYSE" });
    expect(result).toEqual(history);
  }
  expect(appendLiveQuotePoint(history, quote({ instrumentType: undefined, priceBasis: undefined }), { now, assetCategory: "BOND" })).toEqual(history);
  // Existing per-unit non-bond bars retain their live tail.
  expect(appendLiveQuotePoint(history, quote({ instrumentType: "ETF", priceBasis: undefined, price: .88 }), { now, mode: "ohlc", resolution: "1d", exchange: "NYSE" }).at(-1)?.close).toBe(.88);
});

test("bond chart history retains raw observations and cannot acquire currency units or a par quote tail", async () => {
  for (const classification of ["quote", "metadata", "metadata-conflicting-contract"] as const) {
  for (const transform of ["raw", "index100"] as const) {
    const chart: ChartSpec = { ...spec, series: spec.series.map((series) => ({ ...series, transform,
      source: series.source.kind === "security" && classification === "metadata-conflicting-contract"
        ? { ...series.source, instrument: { ...series.source.instrument, instrument: { brokerId: "fixture", symbol: "BONDTEST", secType: "STK" } } }
        : series.source,
    })) };
    const source = chart.series[0]!.source;
    if (source.kind !== "security") throw new Error("fixture");
    const live = classification === "quote" ? quote() : quote({ instrumentType: undefined, priceBasis: undefined });
    const result = await resolveChartSpecData(chart, { now: new Date(now),
      dataProvider: createTestDataProvider({ getQuote: async () => live,
        getQuoteMetadata: async () => ({ symbol: "BONDTEST", listingExchangeName: "NYSE", currency: "USD", instrumentType: "BOND" }),
        getPriceHistory: async () => history, getPriceHistoryForResolution: async () => history }),
      quoteOverrides: new Map([[chartQuoteOverrideKeyForSource(source), live]]),
    });
    const series = result.series[0]!;
    expect(series.points.map((point) => point.rawValue ?? point.value)).toEqual([.86, .87]);
    expect(transform === "raw" ? series.unit : series.rawUnit).toBe("unknown");
    expect(series.volumeUnit).toBeUndefined();
    expect(series.priceAssetCategory).toBeUndefined();
    expect(series.latestChangePercent).toBeUndefined();
  }
  }
});
