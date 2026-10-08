const TPEX_HISTORY_ENDPOINT = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock";

function numeric(value) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw || /^(?:--?|X|N\/A)$/i.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSourceDate(value) {
  const raw = String(value ?? "").trim();
  const roc = raw.match(/^(\d{2,3})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (roc) {
    const year = Number(roc[1]) + 1911;
    return calendarDate(year, Number(roc[2]), Number(roc[3]));
  }
  const gregorian = raw.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (gregorian) return calendarDate(Number(gregorian[1]), Number(gregorian[2]), Number(gregorian[3]));
  const compactRoc = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (compactRoc) return calendarDate(Number(compactRoc[1]) + 1911, Number(compactRoc[2]), Number(compactRoc[3]));
  return "";
}

function calendarDate(year, month, day) {
  if (year < 1912 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : "";
}

function firstDataTable(payload) {
  const tables = payload && typeof payload === "object" && Array.isArray(payload.tables) ? payload.tables : [];
  return tables.find(table => table && typeof table === "object" && Array.isArray(table.data)) || null;
}

/** Parse one official TPEx website month response. Source volume is in lots. */
export function parseTpexHistoryPayload(payload, { now = Date.now() } = {}) {
  const table = firstDataTable(payload);
  const rows = Array.isArray(table?.data) ? table.data : [];
  const today = new Date(Number(now)).toISOString().slice(0, 10);
  return Object.freeze(rows.map(row => {
    if (!Array.isArray(row) || row.length < 9) return null;
    const date = normalizeSourceDate(row[0]);
    if (!date || date > today) return null;
    const open = numeric(row[3]);
    const high = numeric(row[4]);
    const low = numeric(row[5]);
    const close = numeric(row[6]);
    if ([open, high, low, close].some(value => value === null)
      || high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
    const volumeLots = numeric(row[1]);
    return Object.freeze({
      date,
      open,
      high,
      low,
      close,
      volume: volumeLots === null ? null : volumeLots * 1000,
      volumeLots,
      volumeUnit: "shares",
      sourceVolumeUnit: "lots",
      transactionValueThousands: numeric(row[2]),
      change: numeric(row[7]),
      transactions: numeric(row[8]),
    });
  }).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date)));
}

export function tpexHistoryRequestUrl(symbol, month) {
  const code = String(symbol || "").trim().toUpperCase();
  const compactMonth = String(month || "").trim();
  if (!/^[A-Z0-9.-]{1,16}$/.test(code) || !/^\d{6}01$/.test(compactMonth)) {
    throw Object.assign(new Error("TPEx history request identity is invalid."), { code: "TPEX_HISTORY_REQUEST_INVALID" });
  }
  const date = `${compactMonth.slice(0, 4)}/${compactMonth.slice(4, 6)}/01`;
  const url = new URL(TPEX_HISTORY_ENDPOINT);
  url.searchParams.set("code", code);
  url.searchParams.set("date", date);
  url.searchParams.set("response", "json");
  return url.href;
}

export const tpexHistoryContract = Object.freeze({
  source: TPEX_HISTORY_ENDPOINT,
  readOnly: true,
  volumeConversion: "TPEx history volume is reported in lots and normalized to shares at 1 lot = 1000 shares.",
  limitations: Object.freeze(["Historic TPEx endpoint excludes fixed-price trades.", "Prices are not adjusted for corporate actions."]),
});
