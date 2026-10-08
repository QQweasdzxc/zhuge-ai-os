import { fetchCached } from "../../../labs/investment/src/lib/http-cache.mjs";

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const MAX_AGE_DAYS = 7;
const SERIES = Object.freeze([
  Object.freeze({ id: "SP500", label: "S&P 500", unit: "index points", category: "market" }),
  Object.freeze({ id: "NASDAQCOM", label: "Nasdaq Composite", unit: "index points", category: "market" }),
  Object.freeze({ id: "VIXCLS", label: "CBOE VIX", unit: "index points", category: "market" }),
  Object.freeze({ id: "NIKKEI225", label: "Nikkei 225", unit: "index points", category: "market" }),
  Object.freeze({ id: "DEXUSEU", label: "EUR / USD", unit: "USD per EUR" }),
  Object.freeze({ id: "DEXJPUS", label: "USD / JPY", unit: "JPY per USD" }),
  Object.freeze({ id: "DEXUSUK", label: "GBP / USD", unit: "USD per GBP" }),
  Object.freeze({ id: "DEXCHUS", label: "USD / CNY", unit: "CNY per USD" }),
  Object.freeze({ id: "DEXKOUS", label: "USD / KRW", unit: "KRW per USD" }),
]);

function dateOnly(value) {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : "";
}

function parseValue(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate === ".") return null;
  const number = Number(candidate);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseFredDailyObservation(csv, { now = Date.now() } = {}) {
  return parseFredDailyObservations(csv, { now })[0] ?? null;
}

export function parseFredDailyObservations(csv, { now = Date.now() } = {}) {
  const today = new Date(Number(now)).toISOString().slice(0, 10);
  const rows = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).slice(1);
  const observations = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const [rawDate, rawValue] = rows[index].split(",");
    const date = dateOnly(rawDate);
    const value = parseValue(rawValue);
    if (date && date <= today && value !== null && !observations.some(item => item.date === date)) {
      observations.push(Object.freeze({ date, value }));
      if (observations.length === 2) break;
    }
  }
  return Object.freeze(observations);
}

function unavailable(series, url, fetchedAt, errorCode) {
  return Object.freeze({
    status: "UNAVAILABLE",
    available: false,
    provider: "FRED",
    seriesId: series.id,
    label: series.label,
    unit: series.unit,
    source: [url],
    attribution: `Federal Reserve Bank of St. Louis, FRED; ${series.category === "market" ? "market-index series" : "H.10 reference exchange-rate series"}`,
    category: series.category || "fx",
    data: null,
    dataTimestamp: null,
    fetchedAt,
    freshness: "unavailable",
    stale: null,
    delayed: true,
    fallback: false,
    errorCode,
    note: "沒有可驗證的來源列；未以其他市場數值代填。",
  });
}

async function loadSeries(series, { fetchImpl, now, timeoutMs }) {
  const url = new URL(FRED_CSV);
  url.searchParams.set("id", series.id);
  const instant = Number(now());
  const lookback = new Date(instant);
  lookback.setUTCDate(lookback.getUTCDate() - 45);
  url.searchParams.set("cosd", lookback.toISOString().slice(0, 10));
  const retrievedAt = new Date(instant).toISOString();
  try {
    const result = await fetchCached(url.href, {
      kind: "text",
      ttlMs: 60 * 60 * 1000,
      timeoutMs: Math.max(1000, Math.min(15000, Number(timeoutMs) || 8000)),
      fetchImpl,
      now: instant,
    });
    const observations = parseFredDailyObservations(result.value, { now: instant });
    const observation = observations[0];
    if (!observation) return unavailable(series, url.href, result.fetchedAt, "FRED_OBSERVATION_UNAVAILABLE");
    const previous = observations[1] ?? null;
    const change = previous ? observation.value - previous.value : null;
    const changePct = previous && previous.value !== 0 ? change / previous.value * 100 : null;
    const ageDays = Math.max(0, (Date.parse(new Date(instant).toISOString().slice(0, 10)) - Date.parse(`${observation.date}T00:00:00.000Z`)) / 86400000);
    const stale = ageDays > MAX_AGE_DAYS;
    return Object.freeze({
      status: stale ? "PARTIAL" : "AVAILABLE",
      available: true,
      provider: "FRED",
      seriesId: series.id,
      label: series.label,
      unit: series.unit,
      source: [url.href],
      attribution: `Federal Reserve Bank of St. Louis, FRED; ${series.category === "market" ? "market-index series" : "H.10 reference exchange-rate series"}`,
      category: series.category || "fx",
      data: Object.freeze({ value: observation.value, change, changePct, previousDate: previous?.date ?? null }),
      dataTimestamp: observation.date,
      fetchedAt: result.fetchedAt || retrievedAt,
      freshness: stale ? "stale" : "fresh",
      stale,
      delayed: true,
      fallback: result.fallback === true,
      errorCode: null,
      note: series.category === "market"
        ? "日頻市場指數背景；不是即時報價或交易訊號。"
        : "每日參考匯率；僅作宏觀背景，不是即時報價或交易訊號。",
    });
  } catch (error) {
    return unavailable(series, url.href, retrievedAt, error?.code === "TIMEOUT" ? "FRED_TIMEOUT" : "FRED_FETCH_FAILED");
  }
}

/** Fixed-source, read-only global context. It is not a user-controlled URL proxy. */
export async function loadFredGlobalFxContext({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== "function") {
    return Object.freeze(SERIES.map(series => unavailable(series, `${FRED_CSV}?id=${series.id}`, new Date(Number(now())).toISOString(), "FRED_FETCH_UNAVAILABLE")));
  }
  return Object.freeze(await Promise.all(SERIES.map(series => loadSeries(series, { fetchImpl, now, timeoutMs }))));
}

export const fredGlobalFxSeries = SERIES;
export const fredGlobalMarketSeries = Object.freeze(SERIES.filter(series => series.category === "market"));
