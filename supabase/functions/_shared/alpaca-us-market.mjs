const API_ROOT = "https://data.alpaca.markets/v2/stocks";
const QUOTE_FRESH_MS = 15 * 60 * 1000;
const HISTORY_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function freshness(value, now, threshold) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60 * 1000) return "unknown";
  return now - parsed <= threshold ? "fresh" : "stale";
}

function error(code) {
  return Object.assign(new Error(code), { code });
}

function safeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw error("US_SYMBOL_INVALID");
  return symbol;
}

function oneYearStart(now) {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start.toISOString().slice(0, 10);
}

/** Server-only, read-only market adapter. It never exposes keys or creates trade routes. */
export function createAlpacaUsMarketProvider({ apiKey, apiSecret, fetcher = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
  const key = String(apiKey || "").trim();
  const secret = String(apiSecret || "").trim();

  async function requestJson(url) {
    if (!key || !secret) throw error("EXTERNAL_SECRET_REQUIRED");
    if (typeof fetcher !== "function") throw error("US_PROVIDER_UNAVAILABLE");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
        },
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw error(response?.status === 401 || response?.status === 403 ? "ALPACA_AUTH_REJECTED"
          : response?.status === 429 ? "ALPACA_RATE_LIMITED"
            : `ALPACA_HTTP_${Number(response?.status) || 0}`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw error("ALPACA_RESPONSE_INVALID");
      return payload;
    } catch (cause) {
      if (cause?.code) throw cause;
      if (cause?.name === "AbortError") throw error("ALPACA_TIMEOUT");
      throw error("ALPACA_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }

  async function getQuote(input) {
    const symbol = safeSymbol(input);
    const url = `${API_ROOT}/${encodeURIComponent(symbol)}/snapshot?feed=iex`;
    const payload = await requestJson(url);
    const trade = payload.latestTrade || payload.latest_trade || {};
    const daily = payload.dailyBar || payload.daily_bar || {};
    const previousDaily = payload.prevDailyBar || payload.prev_daily_bar || {};
    const tradePrice = finite(trade.p ?? trade.price);
    const dailyPrice = finite(daily.c ?? daily.close);
    const previousPrice = finite(previousDaily.c ?? previousDaily.close);
    const price = tradePrice ?? dailyPrice ?? previousPrice;
    const asOf = timestamp(trade.t ?? trade.timestamp ?? daily.t ?? daily.timestamp ?? previousDaily.t ?? previousDaily.timestamp);
    if (price === null || price <= 0) throw error("ALPACA_QUOTE_UNAVAILABLE");
    const nowMs = Number(now());
    const currentFreshness = freshness(asOf, nowMs, QUOTE_FRESH_MS);
    return Object.freeze({
      contract: "zhuge-investment-quote-v1",
      symbol,
      market: "US",
      currency: "USD",
      price,
      priceKind: tradePrice !== null ? "latest IEX trade" : dailyPrice !== null ? "latest IEX daily bar close" : "previous IEX daily bar close",
      provider: "alpaca-iex",
      source: "Alpaca Market Data · IEX single-exchange feed",
      sourceUrl: url,
      asOf,
      receivedAt: new Date(nowMs).toISOString(),
      freshness: currentFreshness,
      stale: currentFreshness === "stale",
      delayed: false,
      coverage: "IEX single exchange; not consolidated US market coverage",
      available: true,
      error: null,
    });
  }

  async function getHistory(input, options = {}) {
    const symbol = safeSymbol(input);
    const nowMs = Number(now());
    const end = new Date(nowMs).toISOString().slice(0, 10);
    const start = String(options.start || oneYearStart(nowMs));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw error("US_HISTORY_RANGE_INVALID");
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe: "1Day",
      start,
      end,
      limit: "1000",
      adjustment: "raw",
      feed: "iex",
      sort: "asc",
    });
    const url = `${API_ROOT}/bars?${params}`;
    const payload = await requestJson(url);
    const rawBars = Array.isArray(payload.bars) ? payload.bars : Array.isArray(payload.bars?.[symbol]) ? payload.bars[symbol] : [];
    const bars = rawBars.map(bar => {
      const asOf = timestamp(bar?.t ?? bar?.timestamp);
      const close = finite(bar?.c ?? bar?.close);
      return asOf && close !== null ? {
        asOf,
        date: asOf.slice(0, 10),
        open: finite(bar?.o ?? bar?.open),
        high: finite(bar?.h ?? bar?.high),
        low: finite(bar?.l ?? bar?.low),
        close,
        volume: finite(bar?.v ?? bar?.volume),
      } : null;
    }).filter(Boolean).sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
    if (!bars.length) throw error("ALPACA_HISTORY_UNAVAILABLE");
    const asOf = bars.at(-1).asOf;
    const historyFreshness = freshness(asOf, nowMs, HISTORY_FRESH_MS);
    return Object.freeze({
      contract: "zhuge-investment-history-v1",
      symbol,
      market: "US",
      currency: "USD",
      provider: "alpaca-iex-daily",
      source: "Alpaca Market Data · IEX daily bars",
      sourceUrl: url,
      asOf,
      freshness: historyFreshness,
      stale: historyFreshness === "stale",
      delayed: false,
      coverage: "IEX single exchange; daily bars are not consolidated US market volume",
      available: true,
      bars: Object.freeze(bars),
    });
  }

  return Object.freeze({
    provider: "alpaca-iex",
    readOnly: true,
    getQuote,
    getHistory,
  });
}

export const ALPACA_MARKET_DATA_DOCS = Object.freeze({
  snapshots: "https://docs.alpaca.markets/us/reference/stocksnapshotsingle",
  historicalBars: "https://docs.alpaca.markets/us/reference/stockbars",
  marketDataPlans: "https://docs.alpaca.markets/us/docs/about-market-data-api",
});
