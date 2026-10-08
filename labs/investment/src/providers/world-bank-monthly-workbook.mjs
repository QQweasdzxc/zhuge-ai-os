import { ProviderError } from "../lib/http-cache.mjs";

export const WORLD_BANK_MONTHLY_SOURCE = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
export const WORLD_BANK_LICENSE = "https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections";

const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const content = value => typeof value === "object" && value ? String(value["#text"] ?? "") : String(value ?? "");
const fail = code => { throw new ProviderError(code); };

function columnIndex(reference) {
  const letters = String(reference).replace(/\d/g, "");
  if (!letters || !/^[A-Z]+$/i.test(letters)) fail("WORKBOOK_CELL_REFERENCE_INVALID");
  return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xmlFile(files, path, parser) {
  const bytes = files[path];
  if (!bytes) fail("WORKBOOK_SCHEMA_CHANGED");
  try { return parser.parse(new TextDecoder().decode(bytes)); }
  catch { fail("WORKBOOK_XML_INVALID"); }
}

/** Parse the published workbook using runtime-provided ZIP and XML libraries. */
export function parseWorldBankMonthlyWorkbook(bytes, { unzipSync, XMLParser, now = Date.now() } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) fail("WORKBOOK_INVALID");
  if (bytes.byteLength > 16 * 1024 * 1024) fail("WORKBOOK_TOO_LARGE");
  if (typeof unzipSync !== "function" || typeof XMLParser !== "function") fail("WORKBOOK_PARSER_UNAVAILABLE");
  let files;
  try {
    files = unzipSync(bytes, { filter: file => file.originalSize < 32 * 1024 * 1024 && /^(xl\/sharedStrings\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+\.xml)$/.test(file.name) });
  } catch { fail("WORKBOOK_ZIP_INVALID"); }
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
  const stringsFile = xmlFile(files, "xl/sharedStrings.xml", parser);
  const strings = list(stringsFile.sst?.si).map(item => item.t != null ? content(item.t) : list(item.r).map(run => content(run.t)).join(""));
  const workbook = xmlFile(files, "xl/workbook.xml", parser);
  const sheet = list(workbook.workbook?.sheets?.sheet).find(item => String(item["@_name"] ?? "").trim().toLowerCase() === "monthly prices");
  if (!sheet) fail("WORKBOOK_SHEET_MISSING");
  const relation = list(xmlFile(files, "xl/_rels/workbook.xml.rels", parser).Relationships?.Relationship).find(item => item["@_Id"] === sheet["@_r:id"]);
  const target = String(relation?.["@_Target"] ?? "").replace(/^\//, "");
  const path = target.startsWith("xl/") ? target : `xl/${target}`;
  if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) fail("WORKBOOK_SHEET_PATH_INVALID");
  const rows = list(xmlFile(files, path, parser).worksheet?.sheetData?.row).map(row => {
    const cells = [];
    for (const cell of list(row.c)) {
      const index = columnIndex(cell["@_r"]);
      if (cell["@_t"] === "s") cells[index] = strings[Number(cell.v)] ?? "";
      else if (cell["@_t"] === "inlineStr") cells[index] = content(cell.is?.t);
      else cells[index] = content(cell.v);
    }
    return cells;
  });
  const header = rows.find(row => row.some(value => /crude oil,?\s*brent/i.test(value ?? "")) && row.some(value => /^copper$/i.test(value ?? "")));
  if (!header) fail("WORKBOOK_HEADER_MISSING");
  const currentMonth = new Date(Number(now)).toISOString().slice(0, 7);

  const definitions = [
    { pattern: /^crude oil,?\s*brent$/i, indicator: "Brent", group: "油價", unit: "USD / barrel" },
    { pattern: /^crude oil,?\s*wti$/i, indicator: "WTI", group: "油價", unit: "USD / barrel" },
    { pattern: /^copper$/i, indicator: "Copper", group: "銅價", unit: "USD / metric ton" },
  ];
  const observations = [];
  for (const definition of definitions) {
    const column = header.findIndex(value => definition.pattern.test(value ?? ""));
    if (column < 0) fail("WORKBOOK_COMMODITY_COLUMN_MISSING");
    const points = rows.flatMap(row => {
      const date = /^(\d{4})M(\d{2})$/i.exec(String(row[0] ?? "").trim());
      const raw = String(row[column] ?? "").trim();
      const value = raw && raw !== ".." ? Number(raw) : NaN;
      if (!date || Number(date[2]) < 1 || Number(date[2]) > 12) return [];
      const month = `${date[1]}-${date[2]}`;
      return month <= currentMonth && Number.isFinite(value) && value > 0 ? [{ month, value }] : [];
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
