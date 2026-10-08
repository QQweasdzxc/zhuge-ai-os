const DATE = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/;
const SOURCE = "TDCC open-data shareholder distribution dataset 11452";
const clean = value => String(value ?? "").replace(/^\uFEFF/, "").trim();

function parseRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(value => clean(value))) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some(value => clean(value))) rows.push(row); }
  return rows;
}

function validDate(value) {
  const match = DATE.exec(clean(value));
  if (!match) return "";
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = Date.parse(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === candidate ? candidate : "";
}

function percent(value) {
  const raw = clean(value).replace(/[%％,\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function level(value) {
  const raw = clean(value);
  const match = /(?:第\s*)?(\d{1,2})\s*級/.exec(raw) || /^(\d{1,2})$/.exec(raw);
  if (!match || /差異|合計/.test(raw)) return null;
  const valueNumber = Number(match[1]);
  return valueNumber >= 1 && valueNumber <= 15 ? valueNumber : null;
}

/** Parse official/open-government TDCC CSV while retaining only aggregate public tier rows. */
export function parseTdccWeeklyCsv(csv, { symbol = "", sourceUrl = "https://data.gov.tw/dataset/11452", fetchedAt = new Date().toISOString() } = {}) {
  const rows = parseRows(csv);
  if (rows.length < 2) return Object.freeze({ contract: "zhuge-tdcc-series-v1", status: "UNAVAILABLE", provider: SOURCE, sourceUrl, symbol: clean(symbol).toUpperCase(), fetchedAt, observations: Object.freeze([]), error: "CSV_EMPTY" });
  const header = rows[0].map(clean);
  const column = aliases => header.findIndex(value => aliases.includes(value));
  const dateIndex = column(["資料日期", "資料日"]);
  const symbolIndex = column(["證券代號", "股票代號"]);
  const levelIndex = column(["持股分級", "持股級距"]);
  const percentIndex = column(["占集保庫存數比例%", "占集保庫存數比例％", "占集保庫存數比例", "持股比例"]);
  if ([dateIndex, symbolIndex, levelIndex, percentIndex].some(index => index < 0)) {
    return Object.freeze({ contract: "zhuge-tdcc-series-v1", status: "UNAVAILABLE", provider: SOURCE, sourceUrl, symbol: clean(symbol).toUpperCase(), fetchedAt, observations: Object.freeze([]), error: "CSV_SCHEMA_UNRECOGNIZED" });
  }

  const requestedSymbol = clean(symbol).toUpperCase();
  const grouped = new Map();
  for (const values of rows.slice(1)) {
    const rowSymbol = clean(values[symbolIndex]).toUpperCase();
    const date = validDate(values[dateIndex]);
    const band = level(values[levelIndex]);
    const sharePercent = percent(values[percentIndex]);
    if (!date || !rowSymbol || (requestedSymbol && rowSymbol !== requestedSymbol) || band === null || sharePercent === null) continue;
    const key = `${rowSymbol}|${date}`;
    const item = grouped.get(key) || { symbol: rowSymbol, date, levels: Object.create(null) };
    if (Object.hasOwn(item.levels, String(band))) continue;
    item.levels[String(band)] = sharePercent;
    grouped.set(key, item);
  }

  const observations = [...grouped.values()].map(item => {
    const selected = [13, 14, 15].map(number => item.levels[String(number)] ?? null);
    const complete = selected.every(value => value !== null);
    return Object.freeze({
      symbol: item.symbol,
      date: item.date,
      source: SOURCE,
      sourceUrl,
      levels: Object.freeze({ 13: selected[0], 14: selected[1], 15: selected[2] }),
      topThreeSourceLevelsPct: complete ? selected.reduce((sum, value) => sum + value, 0) : null,
      status: complete ? "AVAILABLE" : "PARTIAL",
    });
  }).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));
  const completeCount = observations.filter(item => item.status === "AVAILABLE").length;
  const priorBySymbol = new Map();
  const deltas = observations.map(item => {
    const previous = priorBySymbol.get(item.symbol);
    const changePercentagePoints = previous != null && item.topThreeSourceLevelsPct !== null
      ? item.topThreeSourceLevelsPct - previous : null;
    if (item.topThreeSourceLevelsPct !== null) priorBySymbol.set(item.symbol, item.topThreeSourceLevelsPct);
    return Object.freeze({ ...item, changePercentagePoints });
  });
  return Object.freeze({
    contract: "zhuge-tdcc-series-v1",
    status: completeCount >= 2 ? "AVAILABLE" : observations.length ? "INSUFFICIENT_HISTORY" : "EMPTY",
    provider: SOURCE,
    sourceUrl,
    fetchedAt: Number.isFinite(Date.parse(fetchedAt)) ? new Date(fetchedAt).toISOString() : null,
    symbol: requestedSymbol || null,
    observations: Object.freeze(deltas),
    sourceCount: observations.length,
    completeCount,
    note: "級距 13–15 合計僅代表來源級距占比觀察，不代表可識別的大戶或買賣方向；只有實際來源日期才納入。",
  });
}

/** Merge one official source snapshot into the source-dated publication history. */
export function mergeTdccPublishedHistory(currentCsv, previous = null, {
  fetchedAt = new Date().toISOString(),
  sourceUrl = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5",
  maxDatesPerSymbol = 104,
  sourceSha256 = null,
} = {}) {
  const current = parseTdccWeeklyCsv(currentCsv, { sourceUrl: "https://data.gov.tw/dataset/11452", fetchedAt });
  if (current.error) throw Object.assign(new Error("Official TDCC source CSV did not match the expected public dataset schema."), { code: current.error });
  const priorItems = previous?.contract === "zhuge-tdcc-static-history-v1" && Array.isArray(previous.observations)
    ? previous.observations
    : [];
  const byKey = new Map();
  for (const item of [...priorItems, ...current.observations]) {
    const symbolValue = clean(item?.symbol).toUpperCase();
    const date = validDate(item?.date);
    if (!symbolValue || !date || !/^[A-Z0-9.-]{1,16}$/.test(symbolValue)) continue;
    const levels = Object.fromEntries([13, 14, 15].map(key => {
      const value = percent(item?.levels?.[String(key)] ?? item?.levels?.[key]);
      return [String(key), value];
    }));
    const complete = Object.values(levels).every(value => value !== null);
    const topThreeSourceLevelsPct = complete ? Object.values(levels).reduce((sum, value) => sum + value, 0) : null;
    byKey.set(`${symbolValue}|${date}`, Object.freeze({
      symbol: symbolValue,
      date,
      levels: Object.freeze(levels),
      topThreeSourceLevelsPct,
      status: complete ? "AVAILABLE" : "PARTIAL",
      source: SOURCE,
    }));
  }
  const all = [...byKey.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));
  const datesBySymbol = new Map();
  for (const item of all) {
    const dates = datesBySymbol.get(item.symbol) || [];
    dates.push(item);
    datesBySymbol.set(item.symbol, dates);
  }
  const capped = [...datesBySymbol.values()].flatMap(items => items.slice(-Math.max(2, Math.min(520, Math.floor(Number(maxDatesPerSymbol) || 104)))));
  const priorBySymbol = new Map();
  const observations = capped.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date)).map(item => {
    const previousValue = priorBySymbol.get(item.symbol);
    const changePercentagePoints = previousValue != null && item.topThreeSourceLevelsPct !== null
      ? item.topThreeSourceLevelsPct - previousValue : null;
    if (item.topThreeSourceLevelsPct !== null) priorBySymbol.set(item.symbol, item.topThreeSourceLevelsPct);
    return Object.freeze({ ...item, changePercentagePoints });
  });
  const symbolCounts = new Map();
  for (const item of observations) {
    const count = symbolCounts.get(item.symbol) || { dates: new Set(), complete: 0 };
    count.dates.add(item.date);
    if (item.status === "AVAILABLE") count.complete += 1;
    symbolCounts.set(item.symbol, count);
  }
  const hasHistory = [...symbolCounts.values()].some(value => value.dates.size >= 2 && value.complete >= 2);
  return Object.freeze({
    contract: "zhuge-tdcc-static-history-v1",
    status: hasHistory ? "AVAILABLE" : observations.length ? "INSUFFICIENT_HISTORY" : "EMPTY",
    provider: SOURCE,
    sourceUrl: "https://data.gov.tw/dataset/11452",
    downloadUrl: sourceUrl,
    license: "政府資料開放授權條款第 1 版",
    fetchedAt: Number.isFinite(Date.parse(fetchedAt)) ? new Date(fetchedAt).toISOString() : null,
    sourceSha256: /^[a-f0-9]{64}$/i.test(String(sourceSha256 || "")) ? String(sourceSha256).toLowerCase() : null,
    sourceDates: Object.freeze([...new Set(observations.map(item => item.date))].sort()),
    observations: Object.freeze(observations),
    note: "只保留官方 CSV 實際出現的日期及第 13–15 級公開彙總比例；排程累積不回填不存在的歷史日期。",
  });
}

export const tdccHistoricalSeriesContract = Object.freeze({ provider: SOURCE, sourceUrl: "https://data.gov.tw/dataset/11452", license: "政府資料開放授權條款第 1 版" });
