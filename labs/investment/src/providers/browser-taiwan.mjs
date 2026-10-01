import { makeEvidence, unavailableEvidence } from "../lib/contract.mjs";
import { fetchCached } from "../lib/http-cache.mjs";
import { normalizeDate, number, staleByCalendarDays } from "../lib/normalize.mjs";
import { supportedSymbol } from "./official-taiwan.mjs";

export const TWSE_BROWSER_QUOTES = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data";
export const TPEX_QUOTE_REFERENCE = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function proxyRequired(item) {
  return makeEvidence({
    status: "NOT_CONNECTED",
    dataTruth: "NOT_CONNECTED",
    provider: item.venue,
    source: [TPEX_QUOTE_REFERENCE],
    delayed: true,
    note: "TPEx 公開端點目前未允許此瀏覽器來源讀取。Lab 保留報價入口，但不繞過 CORS；需要 Zhuge 受控 server-side proxy 才能接通。",
    errorCode: "SERVER_PROXY_REQUIRED",
  });
}

export function mapTwseCsvQuote(csv, value, { fetchedAt = new Date().toISOString(), fallback = false } = {}) {
  const item = supportedSymbol(value);
  if (!item || item.venue !== "TWSE") return unavailableEvidence("TWSE", [TWSE_BROWSER_QUOTES], "SYMBOL_NOT_FOUND", "此 TWSE 日收來源不支援該代碼。");
  const records = parseCsv(String(csv));
  const headers = (records.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  const index = (name) => headers.indexOf(name);
  const codeColumn = index("證券代號");
  if (codeColumn < 0 || index("收盤價") < 0 || index("日期") < 0) {
    return makeEvidence({ status: "UNAVAILABLE", dataTruth: "UNAVAILABLE", provider: "TWSE", source: [TWSE_BROWSER_QUOTES], fetchedAt, delayed: true, note: "TWSE 回應缺少必要欄位；不補入估算值。", errorCode: "SOURCE_SCHEMA_CHANGED" });
  }
  const row = records.find((candidate) => candidate[codeColumn] === item.code);
  if (!row) {
    return makeEvidence({ status: "UNAVAILABLE", dataTruth: "UNAVAILABLE", provider: "TWSE", source: [TWSE_BROWSER_QUOTES], fetchedAt, delayed: true, note: "TWSE 官方日收資料目前未包含此代碼；不以其他來源補值。", errorCode: "EMPTY_RESPONSE" });
  }
  const valueAt = (name) => row[index(name)] ?? null;
  const date = normalizeDate(valueAt("日期"));
  const close = number(valueAt("收盤價"));
  const change = number(valueAt("漲跌價差"));
  if (!date || close == null) {
    return makeEvidence({ status: "UNAVAILABLE", dataTruth: "UNAVAILABLE", provider: "TWSE", source: [TWSE_BROWSER_QUOTES], fetchedAt, delayed: true, note: "TWSE 回應缺少有效日期或收盤價欄位；不補入估算值。", errorCode: "SOURCE_SCHEMA_CHANGED" });
  }
  const previousClose = change == null ? null : close - change;
  return makeEvidence({
    status: previousClose == null || previousClose === 0 ? "PARTIAL" : "AVAILABLE",
    dataTruth: "OFFICIAL", provider: "TWSE", source: [TWSE_BROWSER_QUOTES], dataTimestamp: date,
    fetchedAt, stale: staleByCalendarDays(date, 5), delayed: true, fallback,
    attribution: "臺灣證券交易所公開資訊", license: "依 TWSE 該資料集使用條款；Lab 僅呈現來源與日期。",
    note: "TWSE 官方日收 CSV；不是盤中即時報價。漲跌幅依同列收盤與官方漲跌價差計算。",
    data: {
      date, name: valueAt("證券名稱") || item.displayName, close, change,
      changePercent: previousClose == null || previousClose === 0 ? null : change / previousClose * 100,
      volume: number(valueAt("成交股數")), open: number(valueAt("開盤價")),
      high: number(valueAt("最高價")), low: number(valueAt("最低價")), instrumentType: item.instrumentType,
    },
  });
}

export async function loadBrowserQuote(value) {
  const item = supportedSymbol(value);
  if (!item) return unavailableEvidence("TWSE / TPEx", [], "SYMBOL_NOT_FOUND", "此研究池不支援該代碼。");
  if (item.venue !== "TWSE") return proxyRequired(item);

  try {
    const result = await fetchCached(TWSE_BROWSER_QUOTES, { kind: "text", ttlMs: 30_000, timeoutMs: 15_000 });
    return mapTwseCsvQuote(result.value, item.symbol, { fetchedAt: result.fetchedAt, fallback: result.fallback });
  } catch (error) {
    return unavailableEvidence("TWSE", [TWSE_BROWSER_QUOTES], error?.code ?? "PROVIDER_READ_FAILED", "TWSE 官方日收目前無法讀取；不以快取 fixture 或模擬值填補。");
  }
}
