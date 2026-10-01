import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { httpFetch, isHttpFetchStreaming } from "../../../utils/http-transport";
import type { EvidenceStatus } from "./research";

export const WORLD_BANK_MONTHLY_SOURCE = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
export const WORLD_BANK_LICENSE = "https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections";
export interface CommodityObservation { indicator: string; unit: string; month: string; value: number; previousMonth: string | null; previousValue: number | null; changePercent: number | null }
export interface RadarItem {
  id: "dram-nand" | "sox" | "oil" | "copper" | "scfi";
  label: string; status: EvidenceStatus; source: string; provider: string;
  fetchedAt: string | null; dataTimestamp: string | null; stale: boolean | null;
  delayed: boolean; fallback: boolean; attribution: string; license: string;
  note: string; errorCode: string | null; observations: CommodityObservation[];
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const list = (value: unknown): any[] => Array.isArray(value) ? value : value == null ? [] : [value];
const content = (value: any): string => typeof value === "object" && value ? String(value["#text"] ?? "") : String(value ?? "");
function columnIndex(ref: string): number { return [...ref.replace(/\d/g, "")].reduce((v, ch) => v * 26 + ch.charCodeAt(0) - 64, 0) - 1; }

/** Reads the official workbook, not a mirrored API; schema mismatches fail closed. */
export function readMonthlyWorkbook(bytes: Uint8Array): CommodityObservation[] {
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("WORKBOOK_TOO_LARGE");
  const files = unzipSync(bytes, { filter: (file) => file.originalSize < 32 * 1024 * 1024 && /^(xl\/sharedStrings.xml|xl\/workbook.xml|xl\/_rels\/workbook.xml.rels|xl\/worksheets\/sheet\d+.xml)$/.test(file.name) });
  const decode = (path: string) => { const value = files[path]; if (!value) throw new Error("WORKBOOK_SCHEMA_CHANGED"); return xml.parse(new TextDecoder().decode(value)); };
  const strings = list(decode("xl/sharedStrings.xml").sst.si).map((si) => si.t != null ? content(si.t) : list(si.r).map((r) => content(r.t)).join(""));
  const workbook = decode("xl/workbook.xml");
  const sheet = list(workbook.workbook.sheets.sheet).find((s) => /^monthly prices$/i.test(String(s["@_name"]).trim()));
  if (!sheet) throw new Error("MONTHLY_PRICE_SHEET_MISSING");
  const rel = list(decode("xl/_rels/workbook.xml.rels").Relationships.Relationship).find((r) => r["@_Id"] === sheet["@_r:id"]);
  const target = String(rel?.["@_Target"] ?? "").replace(/^\//, "");
  const path = target.startsWith("xl/") ? target : `xl/${target}`;
  if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) throw new Error("WORKBOOK_SHEET_PATH_INVALID");
  const rows: string[][] = list(decode(path).worksheet.sheetData.row).map((row) => {
    const cells: string[] = [];
    for (const c of list(row.c)) cells[columnIndex(String(c["@_r"]))] = c["@_t"] === "s" ? strings[Number(c.v)] ?? "" : c["@_t"] === "inlineStr" ? content(c.is?.t) : content(c.v);
    return cells;
  });
  const header = rows.find((row) => row.some((cell) => /crude oil,?\s*wti/i.test(cell)) && row.some((cell) => /^copper$/i.test(cell)));
  if (!header) throw new Error("COMMODITY_COLUMNS_MISSING");
  return [
    { pattern: /crude oil,?\s*brent/i, indicator: "Brent", unit: "USD / barrel" },
    { pattern: /crude oil,?\s*wti/i, indicator: "WTI", unit: "USD / barrel" },
    { pattern: /^copper$/i, indicator: "Copper", unit: "USD / metric ton" },
  ].map(({ pattern, indicator, unit }) => {
    const index = header.findIndex((cell) => pattern.test(cell));
    if (index < 0) throw new Error("COMMODITY_COLUMN_MISSING");
    const points = rows.flatMap((row) => {
      const date = /^(\d{4})M(\d{2})$/i.exec(row[0] ?? "");
      const raw = row[index]?.trim();
      const value = raw && raw !== ".." ? Number(raw) : NaN;
      return date && Number.isFinite(value) && value > 0 ? [{ month: `${date[1]}-${date[2]}`, value }] : [];
    }).sort((a, b) => a.month.localeCompare(b.month));
    const last = points.at(-1), previous = points.at(-2);
    if (!last) throw new Error("COMMODITY_OBSERVATION_MISSING");
    return { indicator, unit, ...last, previousMonth: previous?.month ?? null, previousValue: previous?.value ?? null,
      changePercent: previous?.value ? (last.value / previous.value - 1) * 100 : null };
  });
}

function reference(id: RadarItem["id"], label: string, provider: string, source: string, note: string): RadarItem {
  return { id, label, provider, source, status: "PROVIDER_REVIEW_REQUIRED", fetchedAt: null, dataTimestamp: null,
    stale: null, delayed: true, fallback: false, attribution: provider, license: "未確認自動化／再散布授權；REFERENCE_ONLY",
    note, errorCode: "SOURCE_AUDIT_REQUIRES_REVIEW", observations: [] };
}

/** The upstream Desktop HTTP envelope is text-only; never parse its damaged
 * XLSX bytes or substitute the recorded QA workbook as live market data. */
export async function readMonthlyResponse(response: Response): Promise<CommodityObservation[]> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 16 * 1024 * 1024) throw new Error("WORKBOOK_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (length > 0 && !response.headers.has("content-encoding") && length !== bytes.byteLength) {
    throw new Error("BINARY_HTTP_TRANSPORT_UNAVAILABLE");
  }
  return readMonthlyWorkbook(bytes);
}
let cached: { expiresAt: number; data: RadarItem[] } | null = null;
let pending: Promise<RadarItem[]> | null = null;

export async function loadPriceRadar(force = false): Promise<RadarItem[]> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;
  if (pending) return pending;
  pending = (async () => {
    const references = [
      reference("dram-nand", "DRAM / NAND", "TrendForce / DRAMeXchange", "https://www.dramexchange.com/", "公開報價不等於可自動抓取與再散布；本輪不呼叫、不模擬。"),
      reference("sox", "Semiconductor / SOX", "Nasdaq", "https://indexes.nasdaqomx.com/Index/Overview/SOX", "指數授權與機器介面待確認；不拿 ETF 或費半概念分數代替 SOX。"),
      reference("scfi", "SCFI", "Shanghai Shipping Exchange", "https://en.sse.net.cn/indices/scfinew.jsp", "官方週指數公開頁；自動化／資料再散布授權待確認，不與 SCFIS 混用。"),
    ];
    const fetchedAt = new Date().toISOString();
    let observations: CommodityObservation[] = [], errorCode: string | null = null;
    try {
      // In this frozen upstream the installed buffered HTTP transport carries
      // response.body as a string. Native Bun fetch is binary-safe. Do not
      // request XLSX through a known text-only bridge and mislabel corruption.
      if (!isHttpFetchStreaming()) throw new Error("BINARY_HTTP_TRANSPORT_UNAVAILABLE");
      const response = await httpFetch(WORLD_BANK_MONTHLY_SOURCE, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      observations = await readMonthlyResponse(response);
    } catch (error) { errorCode = error instanceof Error ? error.message : "WORKBOOK_REQUEST_FAILED"; }
    const monthly = (["oil", "copper"] as const).map((id): RadarItem => {
      const points = observations.filter((o) => id === "oil" ? o.indicator !== "Copper" : o.indicator === "Copper");
      const month = points[0]?.month ?? null;
      const end = month ? new Date(`${month}-01T00:00:00Z`) : null;
      if (end) end.setUTCMonth(end.getUTCMonth() + 1);
      return { id, label: id === "oil" ? "WTI / Brent Oil" : "Copper", provider: "World Bank Pink Sheet", source: WORLD_BANK_MONTHLY_SOURCE,
        status: points.length ? "PASS" : "UNAVAILABLE", fetchedAt: errorCode === "BINARY_HTTP_TRANSPORT_UNAVAILABLE" ? null : fetchedAt, dataTimestamp: month,
        stale: end ? Date.now() - end.getTime() > 45 * 86_400_000 : null,
        delayed: true, fallback: false, attribution: "World Bank, Commodity Price Data (Pink Sheet); Zhuge 計算月對月變化；非 World Bank 背書。",
        license: `CC BY 4.0；資料集授權：${WORLD_BANK_LICENSE}`, errorCode,
        note: errorCode === "BINARY_HTTP_TRANSPORT_UNAVAILABLE"
          ? "原始 Desktop HTTP bridge 只傳文字，無法保留 XLSX 二進位內容。請在本 Lab 的 Bun 終端研究窗查看月均價；未改 Shared transport、未拿 QA fixture 補資料。"
          : "官方月均價，次月第 2 個工作日發布；不是今日行情。下載檔固定 audit revision，失效時回報 unavailable，不改抓未審核來源。",
        observations: points };
    });
    const data = [references[0]!, references[1]!, monthly[0]!, monthly[1]!, references[2]!];
    cached = { data, expiresAt: Date.now() + (errorCode ? 60_000 : 6 * 60 * 60_000) };
    return data;
  })();
  try { return await pending; } finally { pending = null; }
}
