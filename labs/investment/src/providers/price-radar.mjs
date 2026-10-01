import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { makeEvidence, unavailableEvidence } from "../lib/contract.mjs";
import { fetchCached, ProviderError } from "../lib/http-cache.mjs";

export const WORLD_BANK_MONTHLY_SOURCE = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
export const WORLD_BANK_LICENSE = "https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const content = (value) => typeof value === "object" && value ? String(value["#text"] ?? "") : String(value ?? "");

function fail(code) { throw new ProviderError(code); }

function columnIndex(reference) {
  const letters = String(reference).replace(/\d/g, "");
  if (!letters || !/^[A-Z]+$/i.test(letters)) fail("WORKBOOK_CELL_REFERENCE_INVALID");
  return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xmlFile(files, path) {
  const bytes = files[path];
  if (!bytes) fail("WORKBOOK_SCHEMA_CHANGED");
  try { return parser.parse(new TextDecoder().decode(bytes)); }
  catch { fail("WORKBOOK_XML_INVALID"); }
}

/** Parse the published World Bank workbook in memory; no copy is saved to disk. */
export function parseWorldBankMonthlyWorkbook(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) fail("WORKBOOK_INVALID");
  if (bytes.byteLength > 16 * 1024 * 1024) fail("WORKBOOK_TOO_LARGE");
  let files;
  try {
    files = unzipSync(bytes, { filter: (file) => file.originalSize < 32 * 1024 * 1024 && /^(xl\/sharedStrings\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+\.xml)$/.test(file.name) });
  } catch { fail("WORKBOOK_ZIP_INVALID"); }

  const stringsFile = xmlFile(files, "xl/sharedStrings.xml");
  const strings = list(stringsFile.sst?.si).map((item) => item.t != null
    ? content(item.t)
    : list(item.r).map((run) => content(run.t)).join(""));
  const workbook = xmlFile(files, "xl/workbook.xml");
  const sheet = list(workbook.workbook?.sheets?.sheet).find((item) => String(item["@_name"] ?? "").trim().toLowerCase() === "monthly prices");
  if (!sheet) fail("WORKBOOK_SHEET_MISSING");
  const relation = list(xmlFile(files, "xl/_rels/workbook.xml.rels").Relationships?.Relationship)
    .find((item) => item["@_Id"] === sheet["@_r:id"]);
  const target = String(relation?.["@_Target"] ?? "").replace(/^\//, "");
  const path = target.startsWith("xl/") ? target : `xl/${target}`;
  if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) fail("WORKBOOK_SHEET_PATH_INVALID");
  const rows = list(xmlFile(files, path).worksheet?.sheetData?.row).map((row) => {
    const cells = [];
    for (const cell of list(row.c)) {
      const index = columnIndex(cell["@_r"]);
      if (cell["@_t"] === "s") cells[index] = strings[Number(cell.v)] ?? "";
      else if (cell["@_t"] === "inlineStr") cells[index] = content(cell.is?.t);
      else cells[index] = content(cell.v);
    }
    return cells;
  });
  const header = rows.find((row) => row.some((value) => /crude oil,?\s*brent/i.test(value ?? ""))
    && row.some((value) => /^copper$/i.test(value ?? "")));
  if (!header) fail("WORKBOOK_HEADER_MISSING");

  const definitions = [
    { pattern: /^crude oil,?\s*brent$/i, indicator: "Brent", group: "油價", unit: "USD / barrel" },
    { pattern: /^crude oil,?\s*wti$/i, indicator: "WTI", group: "油價", unit: "USD / barrel" },
    { pattern: /^copper$/i, indicator: "Copper", group: "銅價", unit: "USD / metric ton" },
  ];
  const observations = [];
  for (const definition of definitions) {
    const column = header.findIndex((value) => definition.pattern.test(value ?? ""));
    if (column < 0) fail("WORKBOOK_COMMODITY_COLUMN_MISSING");
    const points = rows.flatMap((row) => {
      const date = /^(\d{4})M(\d{2})$/i.exec(String(row[0] ?? "").trim());
      const raw = String(row[column] ?? "").trim();
      const value = raw && raw !== ".." ? Number(raw) : NaN;
      return date && Number.isFinite(value) && value > 0 ? [{ month: `${date[1]}-${date[2]}`, value }] : [];
    }).sort((a, b) => a.month.localeCompare(b.month));
    const current = points.at(-1);
    const previous = points.at(-2);
    if (!current) fail("WORKBOOK_OBSERVATION_MISSING");
    observations.push({
      ...definition,
      month: current.month,
      value: current.value,
      previousMonth: previous?.month ?? null,
      previousValue: previous?.value ?? null,
      changePercent: previous?.value ? (current.value / previous.value - 1) * 100 : null,
    });
  }
  return observations;
}

function freshness(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month ?? ""))) return null;
  const end = new Date(`${month}-01T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return Date.now() - end.getTime() > 45 * 86_400_000;
}

function reviewedItem({ id, label, provider, source, note, errorCode = "SOURCE_AUDIT_REQUIRES_REVIEW" }) {
  return makeEvidence({
    status: "PROVIDER_REVIEW_REQUIRED", dataTruth: "NOT_CONNECTED", provider, source,
    delayed: true, stale: null, fetchedAt: null, dataTimestamp: null, fallback: false,
    attribution: provider, license: "自動化／再使用授權尚待確認；僅保留來源參考。",
    note, errorCode, data: { id, label, observations: [] },
  });
}

export async function loadPriceRadar() {
  const references = [
    reviewedItem({ id: "dram-nand", label: "DRAM / NAND", provider: "TrendForce / DRAMeXchange", source: "https://www.dramexchange.com/", note: "公開報價不代表可自動擷取或再散布；未經授權審查，不呼叫來源、不顯示猜測值。" }),
    reviewedItem({ id: "sox", label: "半導體指數 / SOX", provider: "Nasdaq", source: "https://indexes.nasdaqomx.com/Index/Overview/SOX", note: "指數資料自動化與呈現授權未確認；不以 ETF 或產業印象代替 SOX。" }),
    reviewedItem({ id: "scfi", label: "SCFI", provider: "Shanghai Shipping Exchange", source: "https://en.sse.net.cn/indices/scfinew.jsp", note: "官方週指數頁；自動化／資料再散布授權未確認，不與 SCFIS 混用。" }),
  ];
  let result;
  try {
    result = await fetchCached(WORLD_BANK_MONTHLY_SOURCE, { kind: "bytes", ttlMs: 6 * 60 * 60_000, timeoutMs: 25_000, failureCooldownMs: 60_000 });
    const observations = parseWorldBankMonthlyWorkbook(result.value);
    const groups = [
      { id: "oil", label: "WTI / Brent 原油", values: observations.filter((item) => item.group === "油價") },
      { id: "copper", label: "銅", values: observations.filter((item) => item.group === "銅價") },
    ];
    const monthly = groups.map(({ id, label, values }) => {
      const month = values.map((item) => item.month).sort().at(-1) ?? null;
      return makeEvidence({
        status: values.length ? "AVAILABLE" : "UNAVAILABLE",
        dataTruth: result.fallback ? "FALLBACK" : "OFFICIAL",
        provider: "World Bank Pink Sheet", source: [WORLD_BANK_MONTHLY_SOURCE], dataTimestamp: month,
        fetchedAt: result.fetchedAt, stale: freshness(month), delayed: true, fallback: result.fallback,
        attribution: "World Bank, Commodity Price Data (Pink Sheet); Zhuge 彙整官方月資料並計算月變化；不代表 World Bank 背書。",
        license: `CC BY 4.0；${WORLD_BANK_LICENSE}`,
        note: "官方月均參考價，不是今日行情、期貨報價或個股曝險結論。月變化只供研究，不形成投資建議。",
        errorCode: result.errorCode ?? null,
        data: { id, label, observations: values },
      });
    });
    return [monthly[0], monthly[1], ...references];
  } catch (error) {
    const reason = error?.code ?? "PROVIDER_READ_FAILED";
    const unavailable = ["oil", "copper"].map((id) => unavailableEvidence("World Bank Pink Sheet", [WORLD_BANK_MONTHLY_SOURCE], reason, "World Bank 官方月報暫時無法讀取；沒有用記錄資料或其他來源補值。"));
    return [
      makeEvidence({ ...unavailable[0], data: { id: "oil", label: "WTI / Brent 原油", observations: [] }, attribution: "World Bank, Commodity Price Data (Pink Sheet)", license: `CC BY 4.0；${WORLD_BANK_LICENSE}`, delayed: true }),
      makeEvidence({ ...unavailable[1], data: { id: "copper", label: "銅", observations: [] }, attribution: "World Bank, Commodity Price Data (Pink Sheet)", license: `CC BY 4.0；${WORLD_BANK_LICENSE}`, delayed: true }),
      ...references,
    ];
  }
}
