import { describe, expect, test } from "bun:test";
import type { HeadlessPaneContext, HeadlessPaneLoadArgs } from "../../../types/plugin";
import { cdsHeadless, createCdsHeadless } from "./headless";
import type { CdsActivity } from "./client";

const activity: CdsActivity = {
  source: "DTCC",
  asOf: "2026-09-04T12:00:00Z",
  issuer: "Oracle Corporation",
  trades: [{
    id: "1", issuer: "Oracle Corporation", issuerKey: "oracle", eventAt: 100,
    maturity: "2031-06-20", notional: 5_000_000, notionalCapped: false,
    currency: "USD", couponBp: 100, spreadBp: 45, reportedSpread: 45, spreadNotation: "4", upfront: null, upfrontCurrency: null,
  }],
};

function args(argument: string | null): HeadlessPaneLoadArgs {
  return { rawArgument: argument ?? "", argument, symbols: argument ? [argument] : [], options: {} };
}

describe("CDS headless model", () => {
  test("switches from issuer summaries to trade rows for a ticker argument", async () => {
    const headless = createCdsHeadless({ load: async () => activity });
    const market = await headless.load(args(null), {} as HeadlessPaneContext);
    const ticker = await headless.load(args("ORCL"), {} as HeadlessPaneContext);

    expect(market.rows).toEqual([expect.objectContaining({ issuer: "Oracle Corporation", trades: 1 })]);
    expect(ticker.rows).toEqual([expect.objectContaining({ id: "1", spreadBp: 45 })]);
  });

  test("loads source notation through the default adapter without inventing monetary rates", async () => {
    const trades = ["4", "1", "Other"].map((spreadNotation, index) => ({
      disseminationId: String(index), originalDisseminationId: null, actionType: "NEWT",
      executionTimestamp: "2026-09-11T14:00:00Z", eventTimestamp: "2026-09-11T15:00:00Z",
      effectiveDate: null, expirationDate: null, maturityDate: "2031-06-20",
      issuerName: "Oracle Corporation", underlierId: null, underlierIdSource: null,
      upi: null, upiFisn: null, upiUnderlierName: null, notionalAmount: 5_000_000,
      notionalCapped: true, notionalCurrency: "USD", fixedRate: 0.01,
      reportedSpread: 250, spreadNotation, upfrontAmount: 0, upfrontCurrency: "USD",
    }));
    const result = await cdsHeadless.load(args("Oracle Corporation"), {
      apiClient: { getCloudCds: async () => ({ source: "DTCC", asOf: null, trades }) },
    } as unknown as HeadlessPaneContext);
    expect(result.rows.map((row) => [row.spreadNotation, row.reportedSpread, row.spreadBp]))
      .toEqual([["4", 250, 250], ["1", 250, null], ["Other", 250, null]]);
    expect(result.rows.map((row) => [row.couponBp, row.upfront])).toEqual([[100, 0], [100, 0], [100, 0]]);
  });
});
