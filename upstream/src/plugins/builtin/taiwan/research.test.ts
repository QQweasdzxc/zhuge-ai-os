import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ageStale, dateText, evidence, LAB_SYMBOLS, missingMopsFields, normalizeRevenue, normalizeStatement, numeric, resolveLabSymbol, revenuePeriod, statementPeriod, type TaiwanResearchReport } from "./research";
import { projectResearch, RESEARCH_VIEWS } from "./model";
import { assessIndustryImpact, type IndustrySignal, type StockExposure } from "./impact";
import { readMonthlyWorkbook, readMonthlyResponse, loadPriceRadar } from "./radar";
import { createProxyResponse, toResponseEnvelope } from "../../../utils/http-proxy-response";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { TaiwanApi } from "../../../sources/taiwan-provider";
import { taiwanResearchHeadless } from "./headless";

const lab = resolve(import.meta.dir, "../../../../..");
const actualRows = await Bun.file(resolve(lab, "evidence/fixtures/official-rows.json")).json() as Array<{ source: string; rows: Record<string, unknown>[] }>;
const actualReport = await Bun.file(resolve(lab, "evidence/2330.TW-runtime.json")).json() as TaiwanResearchReport;

describe("Phase 1 bounded Taiwan research", () => {
  test("allows only the three PM targets, with canonical suffixes", () => {
    expect(LAB_SYMBOLS).toEqual(["2330.TW", "0050.TW", "6488.TWO"]);
    expect(resolveLabSymbol("2330")).toBe("2330.TW");
    expect(resolveLabSymbol("0050")).toBe("0050.TW");
    expect(resolveLabSymbol("6488")).toBe("6488.TWO");
    for (const s of ["AAPL", "2330.TWO", "6488.TW", "2331.TW", "", "TXF"]) expect(() => resolveLabSymbol(s)).toThrow("LAB_SCOPE_ONLY");
  });
  test("missing market numbers are never coerced to zero", () => {
    for (const missing of [null, undefined, "", "-", "--", "N/A", "abc"]) expect(numeric(missing)).toBeNull();
    expect(numeric("0")).toBe(0);
    expect(numeric("1,000")).toBe(1000);
  });
  test("ROC and Gregorian dates are valid; no retrieval date substitution", () => {
    expect(dateText("1150930")).toBe("2026-09-30");
    expect(dateText("20260930")).toBe("2026-09-30");
    expect(dateText("115/09/30")).toBe("2026-09-30");
    for (const value of ["2026-02-31", "2026-13-01", "--", "", "2026", null]) expect(dateText(value)).toBeNull();
  });
  test("unknown freshness remains unknown; explicit age budget marks stale", () => {
    expect(ageStale(null, 5)).toBeNull();
    expect(ageStale("2026-09-30", 5, Date.parse("2026-10-01T00:00:00Z"))).toBe(false);
    expect(ageStale("2026-01-01", 5, Date.parse("2026-10-01T00:00:00Z"))).toBe(true);
  });
  test("missing quarter or invalid revenue month cannot invent a period", () => {
    expect(statementPeriod("115", "2")).toBe("2026-06-30");
    expect(statementPeriod("115", null)).toBeNull();
    expect(statementPeriod("115", "5")).toBeNull();
    expect(revenuePeriod("11508")).toBe("2026-08-31");
    expect(revenuePeriod("202608")).toBe("2026-08-31");
    expect(revenuePeriod("11513")).toBeNull();
    expect(revenuePeriod(null)).toBeNull();
  });
  test("schema loss stays missing instead of green with empty financial values", () => {
    const row = { ...actualRows.find((t) => t.source.includes("ap06"))!.rows[0]! };
    delete row["基本每股盈餘（元）"];
    const data = normalizeStatement(row, "income");
    expect(data.eps).toBeNull();
    expect(missingMopsFields("income", data)).toContain("eps");
    expect(missingMopsFields("balance", { assets: 0, liabilities: 0, equity: 0 })).toEqual([]);
  });
  test("undated usable evidence is PARTIAL, not fresh PASS", () => {
    const data = evidence("TWSE", [], actualReport.quote.data, null, "date absent", 5);
    expect(data.status).toBe("PARTIAL"); expect(data.stale).toBeNull(); expect(data.dataTimestamp).toBeNull();
  });
  test("unavailable evidence retains a code and null instead of fabricated data", () => {
    const data = evidence("MOPS", [], null, null, "讀取失敗", 100);
    expect(data.status).toBe("UNAVAILABLE"); expect(data.errorCode).toBeTruthy(); expect(data.data).toBeNull();
  });
  for (const table of actualRows) {
    const kind = table.source.includes("ap05") ? "revenue" : table.source.includes("ap06") ? "income" : "balance";
    test(`actual recorded official row normalization: ${table.source}`, () => {
      expect(table.rows.length).toBeGreaterThan(0);
      const row = table.rows[0]!;
      const normalized = kind === "revenue" ? normalizeRevenue(row) : normalizeStatement(row, kind);
      expect(normalized.period).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(normalized.unit).toContain("千元");
      if (kind === "revenue") { expect(normalized.amount).toBe(Number(row["營業收入-當月營收"])); expect(normalized.momPercent).toBe(Number(row["營業收入-上月比較增減(%)"])); }
      else if (kind === "income") { expect(normalized.eps).toBe(Number(row["基本每股盈餘（元）"])); expect(normalized.scope).toContain("累計"); }
      else { expect(normalized.assets).toBe(Number(row["資產總計"])); expect(normalized.liabilities).toBe(Number(row["負債總計"])); }
    });
  }
  test("headless TW uses the original bundle and ticker contracts", () => {
    expect(taiwanResearchHeadless.shape).toBe("bundle"); expect(taiwanResearchHeadless.argument.kind).toBe("ticker");
    expect(taiwanResearchHeadless.options[0]?.pluginState?.pluginId).toBe("taiwan-official");
  });
  test("UI and CLI projections expose source, data date, missing and fallback", () => {
    const result = projectResearch(actualReport, "all");
    const text = JSON.stringify(result.sections);
    for (const value of ["Source", "Provider", "資料時間", "讀取時間", "Fallback", "delayed", "NOT_CONNECTED", "PROVIDER_REVIEW_REQUIRED", "千元", "非單季"]) expect(text).toContain(value);
    expect(result.complete).toBe(false); // options/gaps intentionally remain partial
    for (const { value } of RESEARCH_VIEWS) expect(projectResearch(actualReport, value).sections.length).toBeGreaterThan(0);
  });
  test("ETF company financials are not fabricated", async () => {
    const etf = await Bun.file(resolve(lab, "evidence/0050.TW-runtime.json")).json() as TaiwanResearchReport;
    expect(etf.profile.status).toBe("PARTIAL");
    expect(etf.profile.data?.constituents).toBeNull();
    for (const data of [etf.revenue, etf.income, etf.balance]) { expect(data.status).toBe("NOT_CONNECTED"); expect(data.data).toBeNull(); expect(data.note).toContain("不適用"); }
  });
  test("OTC gaps remain explicit while quote and financial data can coexist", async () => {
    const otc = await Bun.file(resolve(lab, "evidence/6488.TWO-runtime.json")).json() as TaiwanResearchReport;
    expect(otc.history.status).toBe("NOT_CONNECTED"); expect(otc.history.data).toBeNull();
    expect(otc.quote.provider).toBe("TPEx"); expect(otc.profile.data?.name).toContain("環球晶");
  });
});

describe("official transport boundary", () => {
  test("coalesces concurrent dataset reads and preserves retrieval receipt", async () => {
    let calls = 0;
    const api = new TaiwanApi(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return Response.json([]); });
    const url = "https://openapi.twse.com.tw/v1/empty-test";
    await Promise.all([api.json(url), api.json(url), api.json(url)]);
    expect(calls).toBe(1); expect(api.receipt(url)?.httpStatus).toBe(200);
    await api.json(url); expect(calls).toBe(1);
    api.invalidate(); await api.json(url); expect(calls).toBe(2);
  });
  test("HTTP failure is rejected and preserved, never converted into empty financial data", async () => {
    const api = new TaiwanApi(async () => new Response("Unavailable", { status: 503 }));
    await expect(api.json("https://openapi.twse.com.tw/failure-test")).rejects.toThrow("HTTP_503");
    expect(api.receipt("https://openapi.twse.com.tw/failure-test")?.errorCode).toBe("HTTP_503");
  });
  test("malformed JSON fails closed", async () => {
    const api = new TaiwanApi(async () => new Response("<html>Provider error</html>"));
    await expect(api.json("https://openapi.twse.com.tw/malformed-test")).rejects.toThrow("NON_JSON_RESPONSE");
  });
});

describe("five-source radar and explainable impact", () => {
  test("parses the captured actual World Bank workbook with declared monthly units", async () => {
    const bytes = new Uint8Array(await Bun.file(resolve(lab, "evidence/fixtures/world-bank-monthly.xlsx")).arrayBuffer());
    const result = readMonthlyWorkbook(bytes);
    expect(result.map((r) => r.indicator)).toEqual(["Brent", "WTI", "Copper"]);
    for (const row of result) { expect(row.month).toMatch(/^\d{4}-\d{2}$/); expect(row.value).toBeGreaterThan(0); expect(row.changePercent).toBeCloseTo((row.value / row.previousValue! - 1) * 100); }
    expect(result[0]?.unit).toBe("USD / barrel"); expect(result[2]?.unit).toBe("USD / metric ton");
  });
  test("empty or malformed workbook is not accepted", () => { expect(() => readMonthlyWorkbook(new Uint8Array())).toThrow(); });
  test("native binary response preserves actual official observations", async () => {
    const bytes = await Bun.file(resolve(lab, "evidence/fixtures/world-bank-monthly.xlsx")).arrayBuffer();
    const response = new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } });
    expect((await readMonthlyResponse(response)).map((r) => r.indicator)).toEqual(["Brent", "WTI", "Copper"]);
  });
  test("upstream text-only proxy is an explicit transport gap, not a green radar", async () => {
    const bytes = await Bun.file(resolve(lab, "evidence/fixtures/world-bank-monthly.xlsx")).arrayBuffer();
    const response = new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } });
    const proxied = createProxyResponse(await toResponseEnvelope(response));
    await expect(readMonthlyResponse(proxied)).rejects.toThrow("BINARY_HTTP_TRANSPORT_UNAVAILABLE");
  });
  test("known text-only bridge makes no XLSX request and has no invented fetchedAt", async () => {
    let calls = 0;
    setHttpFetchTransport(async () => { calls++; return new Response(); });
    try {
      const items = await loadPriceRadar(true);
      for (const item of items.filter((r) => r.id === "oil" || r.id === "copper")) {
        expect(item.status).toBe("UNAVAILABLE"); expect(item.errorCode).toBe("BINARY_HTTP_TRANSPORT_UNAVAILABLE");
        expect(item.observations).toEqual([]); expect(item.fetchedAt).toBeNull();
      }
      expect(calls).toBe(0);
    } finally { setHttpFetchTransport(null); }
  });
  test("radar is exactly five groups and review-only providers never have values", () => {
    expect(actualReport.radar.map((r) => r.id)).toEqual(["dram-nand", "sox", "oil", "copper", "scfi"]);
    for (const item of actualReport.radar.filter((r) => r.status === "PROVIDER_REVIEW_REQUIRED")) {
      expect(item.observations).toEqual([]); expect(item.fetchedAt).toBeNull(); expect(item.license).toContain("REFERENCE_ONLY");
    }
  });
  // These are model rule vectors, not stock-price or financial simulations.
  const signal: IndustrySignal = { id: "rule-vector", direction: "up", source: "documented-rule-vector", dataTimestamp: "2026-08", stale: false, status: "PASS" };
  const exposure: StockExposure = { symbol: "MODEL_RULE_ONLY", kind: "direct-cost", source: "documented-rule-vector", verified: true, explanation: "cost exposure rule" };
  test("price up is a cost headwind, not blanket good news", () => { const result = assessIndustryImpact(signal, exposure); expect(result.ImpactType).toBe("Cost Headwind"); expect(result.Direction).toBe("Negative"); });
  test("down can be a revenue headwind", () => { const result = assessIndustryImpact({ ...signal, direction: "down" }, { ...exposure, kind: "direct-revenue" }); expect(result.ImpactType).toBe("Revenue Headwind"); });
  test("unknown, unverified, stale or unavailable exposure produces no directional claim", () => {
    for (const [s, e] of [[signal, { ...exposure, verified: false }], [{ ...signal, stale: true }, exposure], [{ ...signal, status: "UNAVAILABLE" }, exposure],
      [{ ...signal, source: "" }, exposure], [{ ...signal, dataTimestamp: null }, exposure], [signal, { ...exposure, kind: "unknown" }]] as Array<[IndustrySignal, StockExposure]>) {
      const result = assessIndustryImpact(s, e); expect(result.Direction).toBe("Unknown"); expect(result.Confidence.level).toBe("未評估");
    }
  });
  test("proxy directions remain Mixed and confidence is not a probability", () => {
    for (const kind of ["demand-proxy", "cycle-proxy", "macro-proxy", "mixed"] as const) {
      const result = assessIndustryImpact(signal, { ...exposure, kind }); expect(result.Direction).toBe("Mixed"); expect(result.Confidence.meaning).toContain("not return probability");
    }
  });
});
