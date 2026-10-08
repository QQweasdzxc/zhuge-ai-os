const CHART_ROOT = "https://query1.finance.yahoo.com/v8/finance/chart";
const QUOTE_RANGE = "5d";
const HISTORY_RANGE = "1y";
const QUOTE_FRESH_MS = 24 * 60 * 60 * 1000;
const HISTORY_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_AGE_MS = 2 * 60 * 1000;
const cache = new Map();

function error(code) {
  return Object.assign(new Error(code), { code });
}

function safeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^(?:\^[A-Z0-9][A-Z0-9._-]{0,14}|[A-Z][A-Z0-9.-]{0,14})$/.test(symbol)) throw error("US_SYMBOL_INVALID");
  return symbol;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000).toISOString() : "";
}

function freshness(asOf, now, threshold) {
  const at = Date.parse(asOf || "");
  if (!Number.isFinite(at) || at > now + 5 * 60_000) return "unknown";
  return now - at <= threshold ? "fresh" : "stale";
}

function chartUrl(symbol, range) {
  const url = new URL(`${CHART_ROOT}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "false");
  return url.href;
}

function normalizedChart(payload, symbol, now) {
  const root = payload?.chart?.result?.[0];
  if (!root || payload?.chart?.error) throw error("YAHOO_CHART_UNAVAILABLE");
  const timestamps = Array.isArray(root.timestamp) ? root.timestamp : [];
  const quote = root.indicators?.quote?.[0] || {};
  const bars = timestamps.map((timestamp, index) => {
    const close = finite(quote.close?.[index]);
    if (close === null || close <= 0) return null;
    const asOf = iso(timestamp);
    if (!asOf) return null;
    return {
      asOf,
      date: asOf.slice(0, 10),
      open: finite(quote.open?.[index]),
      high: finite(quote.high?.[index]),
      low: finite(quote.low?.[index]),
      close,
      volume: finite(quote.volume?.[index]),
    };
  }).filter(Boolean).sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
  if (!bars.length) throw error("YAHOO_CHART_EMPTY");
  const meta = root.meta || {};
  const currency = String(meta.currency || "USD").toUpperCase();
  const latest = bars.at(-1);
  const regularMarketTime = iso(meta.regularMarketTime);
  return { bars, latest, meta, currency, regularMarketTime, now };
}

async function fetchChart(url, { fetcher, now, timeoutMs }) {
  const instant = Number(now());
  const cached = cache.get(url);
  if (cached && instant - cached.at < MAX_RESPONSE_AGE_MS) return { payload: cached.payload, fetchedAt: cached.fetchedAt, fallback: true };
  if (typeof fetcher !== "function") throw error("YAHOO_FETCH_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "Zhuge AI OS Investment read-only provider" },
      signal: controller.signal,
    });
    if (!response?.ok) throw error(response?.status === 429 ? "YAHOO_RATE_LIMITED" : `YAHOO_HTTP_${Number(response?.status) || 0}`);
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw error("YAHOO_RESPONSE_INVALID");
    const fetchedAt = new Date(instant).toISOString();
    cache.set(url, { payload, at: instant, fetchedAt });
    return { payload, fetchedAt, fallback: false };
  } catch (cause) {
    if (cause?.code) throw cause;
    if (cause?.name === "AbortError") throw error("YAHOO_TIMEOUT");
    throw error("YAHOO_NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

/** Server-side read-only Yahoo-compatible chart adapter; caller URLs are never accepted. */
export function createYahooUsMarketProvider({ fetcher = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
  async function load(symbol, range) {
    const url = chartUrl(symbol, range);
    const response = await fetchChart(url, { fetcher, now, timeoutMs });
    return { ...normalizedChart(response.payload, symbol, Number(now())), sourceUrl: url, fetchedAt: response.fetchedAt, fallback: response.fallback };
  }

  async function getQuote(input) {
    const symbol = safeSymbol(input);
    const chart = await load(symbol, QUOTE_RANGE);
    const marketPrice = finite(chart.meta.regularMarketPrice);
    const price = marketPrice !== null && marketPrice > 0 ? marketPrice : chart.latest.close;
    const asOf = chart.regularMarketTime || chart.latest.asOf;
    const currentFreshness = freshness(asOf, Number(now()), QUOTE_FRESH_MS);
    return Object.freeze({
      contract: "zhuge-investment-quote-v1",
      symbol,
      market: "US",
      currency: chart.currency,
      price,
      priceKind: marketPrice !== null ? "provider-reported regular-market reference; vendor delay is not independently verified" : "latest available daily close",
      provider: "zhuge-yahoo-chart",
      source: "Zhuge-owned Yahoo-compatible US chart proxy",
      sourceUrl: chart.sourceUrl,
      asOf,
      receivedAt: chart.fetchedAt,
      freshness: currentFreshness,
      stale: currentFreshness === "stale",
      delayed: true,
      fallback: chart.fallback,
      coverage: "provider-reported data; timing and exchange consolidation are not independently verified",
      available: true,
      error: null,
    });
  }

  async function getHistory(input) {
    const symbol = safeSymbol(input);
    const chart = await load(symbol, HISTORY_RANGE);
    const historyFreshness = freshness(chart.latest.asOf, Number(now()), HISTORY_FRESH_MS);
    return Object.freeze({
      contract: "zhuge-investment-history-v1",
      symbol,
      market: "US",
      currency: chart.currency,
      provider: "zhuge-yahoo-chart-daily",
      source: "Zhuge-owned Yahoo-compatible US daily chart proxy",
      sourceUrl: chart.sourceUrl,
      asOf: chart.latest.asOf,
      fetchedAt: chart.fetchedAt,
      freshness: historyFreshness,
      stale: historyFreshness === "stale",
      delayed: true,
      fallback: chart.fallback,
      coverage: "provider-reported daily bars; exchange consolidation and corporate-action adjustment are not independently verified",
      available: true,
      bars: Object.freeze(chart.bars),
    });
  }

  return Object.freeze({ provider: "zhuge-yahoo-chart", readOnly: true, getQuote, getHistory });
}

const GLOBAL_CONTEXT_SYMBOLS = Object.freeze([
  Object.freeze({ symbol: "^SOX", label: "PHLX Semiconductor Sector Index", category: "market" }),
  Object.freeze({ symbol: "TSM", label: "Taiwan Semiconductor ADR", category: "adr" }),
  Object.freeze({ symbol: "^KS11", label: "KOSPI Composite Index", category: "market" }),
]);

export async function loadYahooGlobalMarketContext({ provider = createYahooUsMarketProvider(), now = () => Date.now() } = {}) {
  return Object.freeze(await Promise.all(GLOBAL_CONTEXT_SYMBOLS.map(async entry => {
    const fetchedAt = new Date(Number(now())).toISOString();
    try {
      const quote = await provider.getQuote(entry.symbol);
      if (!quote.available || !Number.isFinite(Number(quote.price)) || !quote.asOf) throw error("GLOBAL_CONTEXT_EMPTY");
      return Object.freeze({
        status: quote.stale ? "PARTIAL" : "AVAILABLE",
        available: true,
        provider: quote.provider,
        seriesId: entry.symbol,
        label: entry.label,
        category: entry.category,
        unit: entry.category === "adr" ? `${quote.currency || "USD"} per share` : "index points",
        source: [quote.sourceUrl],
        attribution: "Yahoo Finance chart response via Zhuge-owned read-only proxy; market-data rights/coverage subject to provider terms.",
        data: Object.freeze({ value: quote.price, change: null, changePct: null, previousDate: null }),
        dataTimestamp: quote.asOf,
        fetchedAt: quote.receivedAt || fetchedAt,
        freshness: quote.freshness,
        stale: quote.stale,
        delayed: true,
        fallback: quote.fallback === true,
        note: "市場背景參考；供應商延遲與行情彙整範圍未獨立驗證，不是即時買賣訊號。",
      });
    } catch (cause) {
      return Object.freeze({
        status: "UNAVAILABLE", available: false, provider: "zhuge-yahoo-chart", seriesId: entry.symbol,
        label: entry.label, category: entry.category, unit: entry.category === "adr" ? "USD per share" : "index points",
        source: [chartUrl(entry.symbol, QUOTE_RANGE)], data: null, dataTimestamp: null, fetchedAt,
        freshness: "unavailable", stale: null, delayed: true, fallback: false,
        errorCode: cause?.code || "GLOBAL_CONTEXT_UNAVAILABLE", note: "沒有可驗證來源列；未用替代標的或估值填補。",
      });
    }
  })));
}

export const yahooGlobalContextSymbols = GLOBAL_CONTEXT_SYMBOLS;
export const yahooChartSource = CHART_ROOT;
