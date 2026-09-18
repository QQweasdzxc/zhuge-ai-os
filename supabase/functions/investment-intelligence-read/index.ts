/*
 * Zhuge AI OS Investment Intelligence Read Adapter.
 *
 * This is the server-side, authenticated read-only boundary for Market / FX /
 * News providers. It deliberately has no Supabase client, service-role key,
 * Product Data table access, Storage access, or mutating provider operation.
 * The browser reaches this function only through the existing Shared Data
 * Gateway, which owns the current authenticated session headers.
 */

type JsonObject = Record<string, unknown>;
type Market = "TW" | "US";
type RequestSpec = { symbol: string; market: Market; name: string; query: string };

const CONTRACT = "zhuge-investment-intelligence-edge-v1";
const CONTEXT_CONTRACT = "zhuge-investment-context-pack-v1";
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const MAX_SYMBOLS = 12;
const MAX_NEWS_SYMBOLS = 5;
const MAX_NEWS_PER_SYMBOL = 8;
const FRESH_QUOTE_MS = 15 * 60 * 1000;
const FRESH_FX_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

const ENDPOINTS = Object.freeze({
  yahooChart: "https://query2.finance.yahoo.com/v8/finance/chart",
  twseQuote: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
  exchangeRate: "https://open.er-api.com/v6/latest/USD",
  frankfurter: "https://api.frankfurter.app/latest?from=USD&to=TWD",
  googleNews: "https://news.google.com/rss/search",
  bingNews: "https://www.bing.com/news/search"
});

class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function marketOf(value: unknown, symbol = ""): Market {
  const market = text(value, 10).toUpperCase();
  if (market === "US") return "US";
  if (market === "TW") return "TW";
  return /^\d{4,6}$/.test(symbol) ? "TW" : "US";
}

function normalizeRequest(value: unknown): RequestSpec | null {
  const input = typeof value === "string" ? { symbol: value } : value && typeof value === "object" ? value as JsonObject : {};
  const symbol = text(input.symbol, 20).toUpperCase().replace(/\.(TW|TWO)$/i, "");
  if (!symbol || !/^[A-Z0-9._-]{1,20}$/.test(symbol)) return null;
  return {
    symbol,
    market: marketOf(input.market, symbol),
    name: text(input.name, 120),
    query: text(input.query, 180)
  };
}

function uniqueRequests(value: unknown) {
  const seen = new Set<string>();
  const result: RequestSpec[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = normalizeRequest(item);
    if (!normalized) continue;
    const key = `${normalized.market}:${normalized.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_SYMBOLS) break;
  }
  return result;
}

function allowedOrigins() {
  const configured = String(Deno.env.get("INVESTMENT_INTELLIGENCE_ALLOWED_ORIGIN") || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return new Set([DEFAULT_ORIGIN, ...configured]);
}

function originFor(request: Request) {
  const origin = text(request.headers.get("origin"), 240);
  if (!origin) return "";
  if (!allowedOrigins().has(origin)) throw new HttpError("Origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  return origin;
}

function responseHeaders(origin = "") {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, apikey, x-client-info, content-type");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("vary", "Origin");
  }
  return headers;
}

function json(body: JsonObject, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function bearer(request: Request) {
  const value = text(request.headers.get("authorization"), 4096);
  return /^Bearer\s+\S+$/i.test(value) ? value : "";
}

async function requireAuthenticatedSession(request: Request) {
  const authorization = bearer(request);
  if (!authorization) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");

  // The Supabase Edge gateway validates the JWT before invoking this function.
  // This second user lookup prevents a permissive function configuration from
  // turning a syntactically valid token into an application authorization.
  const supabaseUrl = text(Deno.env.get("SUPABASE_URL"), 240).replace(/\/$/, "");
  const anonKey = text(Deno.env.get("SUPABASE_ANON_KEY"), 512);
  if (!supabaseUrl || !anonKey) throw new HttpError("Supabase Auth validation is not configured.", 503, "AUTH_VALIDATION_UNAVAILABLE");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: anonKey, authorization: authorization }
  });
  if (!response.ok) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  const user = await response.json().catch(() => ({})) as JsonObject;
  if (!text(user.id, 120)) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
}

function safeProviderCode(error: unknown) {
  const code = text(error && typeof error === "object" ? (error as JsonObject).code : "", 80).toUpperCase();
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : "PROVIDER_FAILED";
}

async function providerRequest(url: string, parser: "json" | "text") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: parser === "text" ? "application/rss+xml,text/xml,text/plain" : "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Provider HTTP ${response.status}`) as Error & { code?: string };
      error.code = `HTTP_${response.status}`;
      throw error;
    }
    return parser === "text" ? await response.text() : await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeout = new Error("Provider timeout") as Error & { code?: string };
      timeout.code = "TIMEOUT";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function freshness(asOf: string, now: number, freshWithinMs: number) {
  const timestamp = Date.parse(asOf || "");
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = now - timestamp;
  if (age < -5 * 60 * 1000) return "unknown";
  return age <= freshWithinMs ? "fresh" : "stale";
}

function asOfFromTwse(row: JsonObject) {
  const millis = finiteNumber(row.tlong);
  if (millis) return new Date(millis).toISOString();
  const date = text(row.d, 20);
  const time = text(row.t || row.ot, 20);
  if (!date || !time) return "";
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time}+08:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function yahooSymbol(request: RequestSpec) {
  return request.market === "TW" ? `${request.symbol}.TW` : request.symbol;
}

function twseSymbol(request: RequestSpec) {
  return `tse_${request.symbol}.tw`;
}

function quoteFromYahoo(request: RequestSpec, payload: unknown, now: number, sourceUrl: string) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const result = (root.chart && typeof root.chart === "object" ? root.chart as JsonObject : {}).result;
  const row = Array.isArray(result) ? result[0] as JsonObject : {};
  const meta = row?.meta && typeof row.meta === "object" ? row.meta as JsonObject : {};
  const quote = row?.indicators && typeof row.indicators === "object" ? row.indicators as JsonObject : {};
  const quoteRows = Array.isArray(quote.quote) ? quote.quote[0] as JsonObject : {};
  const closes = Array.isArray(quoteRows?.close) ? quoteRows.close : [];
  const fallbackPrice = closes.slice().reverse().map(finiteNumber).find(value => value !== null);
  const price = finiteNumber(meta.regularMarketPrice) ?? fallbackPrice;
  if (price === null) throw Object.assign(new Error("Quote unavailable"), { code: "QUOTE_UNAVAILABLE" });
  const regularMarketTime = finiteNumber(meta.regularMarketTime);
  const asOf = regularMarketTime ? new Date(regularMarketTime * 1000).toISOString() : "";
  return {
    contract: "zhuge-investment-quote-v1",
    symbol: request.symbol,
    market: request.market,
    currency: text(meta.currency, 10) || (request.market === "TW" ? "TWD" : "USD"),
    price,
    provider: "yahoo-chart",
    source: "Yahoo Finance Chart",
    sourceUrl,
    asOf,
    receivedAt: new Date(now).toISOString(),
    freshness: freshness(asOf, now, FRESH_QUOTE_MS),
    stale: freshness(asOf, now, FRESH_QUOTE_MS) === "stale",
    available: true,
    error: null
  };
}

function quoteFromTwse(request: RequestSpec, payload: unknown, now: number, sourceUrl: string) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const rows = Array.isArray(root.msgArray) ? root.msgArray : [];
  const row = rows.find(item => item && typeof item === "object" && text((item as JsonObject).c, 20) === request.symbol) as JsonObject | undefined;
  const price = finiteNumber(row?.z) ?? finiteNumber(row?.pz) ?? finiteNumber(row?.o);
  if (!row || price === null) throw Object.assign(new Error("Quote unavailable"), { code: "QUOTE_UNAVAILABLE" });
  const asOf = asOfFromTwse(row);
  return {
    contract: "zhuge-investment-quote-v1",
    symbol: request.symbol,
    market: "TW",
    currency: "TWD",
    price,
    provider: "twse-open",
    source: "TWSE Open Market Quote",
    sourceUrl,
    asOf,
    receivedAt: new Date(now).toISOString(),
    freshness: freshness(asOf, now, FRESH_QUOTE_MS),
    stale: freshness(asOf, now, FRESH_QUOTE_MS) === "stale",
    available: true,
    error: null
  };
}

function fxFromExchangeRate(payload: unknown, now: number, sourceUrl: string) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const rates = root.rates && typeof root.rates === "object" ? root.rates as JsonObject : {};
  const rate = finiteNumber(rates.TWD);
  if (rate === null || rate <= 0) throw Object.assign(new Error("FX unavailable"), { code: "FX_UNAVAILABLE" });
  const rawDate = text(root.time_last_update_utc, 120);
  const asOf = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : "";
  return {
    contract: "zhuge-investment-fx-v1",
    base: "USD",
    quote: "TWD",
    rate,
    provider: "open-er-api",
    source: "ExchangeRate-API Open Rates",
    sourceUrl,
    asOf,
    receivedAt: new Date(now).toISOString(),
    freshness: freshness(asOf, now, FRESH_FX_MS),
    stale: freshness(asOf, now, FRESH_FX_MS) === "stale",
    available: true,
    error: null
  };
}

function fxFromFrankfurter(payload: unknown, now: number, sourceUrl: string) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const rates = root.rates && typeof root.rates === "object" ? root.rates as JsonObject : {};
  const rate = finiteNumber(rates.TWD);
  if (rate === null || rate <= 0) throw Object.assign(new Error("FX unavailable"), { code: "FX_UNAVAILABLE" });
  const date = text(root.date, 20);
  const asOf = date ? `${date}T00:00:00.000Z` : "";
  return {
    contract: "zhuge-investment-fx-v1",
    base: "USD",
    quote: "TWD",
    rate,
    provider: "frankfurter",
    source: "Frankfurter ECB Rates",
    sourceUrl,
    asOf,
    receivedAt: new Date(now).toISOString(),
    freshness: freshness(asOf, now, FRESH_FX_MS),
    stale: freshness(asOf, now, FRESH_FX_MS) === "stale",
    available: true,
    error: null
  };
}

function decodeXml(value: unknown) {
  return text(value, 1000)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function xmlTag(block: string, tag: string) {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  return decodeXml(block.match(expression)?.[1] || "");
}

function parseRss(xml: string, request: RequestSpec, provider: string, now: number) {
  const items: JsonObject[] = [];
  const blocks = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, MAX_NEWS_PER_SYMBOL)) {
    const title = xmlTag(block, "title");
    const source = xmlTag(block, "source") || provider;
    const sourceUrl = xmlTag(block, "link");
    const summary = decodeXml(xmlTag(block, "description"));
    const publishedAt = xmlTag(block, "pubDate");
    const observedAt = publishedAt && !Number.isNaN(new Date(publishedAt).getTime())
      ? new Date(publishedAt).toISOString()
      : "";
    if (!title || !sourceUrl) continue;
    items.push({
      type: "news",
      symbol: request.symbol,
      market: request.market,
      title,
      summary: summary || "RSS provider did not return a summary.",
      source,
      sourceUrl,
      observedAt,
      quality: "provider",
      freshness: freshness(observedAt, now, 24 * 60 * 60 * 1000),
      stale: freshness(observedAt, now, 24 * 60 * 60 * 1000) === "stale",
      facts: [],
      limitations: ["Provider RSS 摘要；尚未取得原文全文驗證。"]
    });
  }
  return items;
}

async function withFallback<T>(candidates: Array<{ provider: string; run: () => Promise<T> }>) {
  const attempts: JsonObject[] = [];
  for (const candidate of candidates) {
    try {
      const value = await candidate.run();
      if (value !== null && (!Array.isArray(value) || value.length > 0)) {
        return { ok: true, provider: candidate.provider, value, attempts };
      }
      attempts.push({ provider: candidate.provider, ok: false, reason: "EMPTY" });
    } catch (error) {
      attempts.push({ provider: candidate.provider, ok: false, reason: safeProviderCode(error) });
    }
  }
  return { ok: false, provider: null, value: null, attempts };
}

function normalizeNews(items: JsonObject[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${text(item.sourceUrl, 500)}|${text(item.title, 240)}`.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadQuote(request: RequestSpec, now: number) {
  const yahooUrl = `${ENDPOINTS.yahooChart}/${encodeURIComponent(yahooSymbol(request))}?range=1d&interval=1m&includePrePost=false`;
  const twseUrl = `${ENDPOINTS.twseQuote}?ex_ch=${encodeURIComponent(twseSymbol(request))}&json=1&delay=0`;
  const result = await withFallback([
    { provider: "yahoo-chart", run: async () => quoteFromYahoo(request, await providerRequest(yahooUrl, "json"), now, yahooUrl) },
    ...(request.market === "TW" ? [{ provider: "twse-open", run: async () => quoteFromTwse(request, await providerRequest(twseUrl, "json"), now, twseUrl) }] : [])
  ]);
  if (result.ok) return { ...(result.value as JsonObject), provider: result.provider, attempts: result.attempts };
  return {
    contract: "zhuge-investment-quote-v1",
    symbol: request.symbol,
    market: request.market,
    currency: request.market === "TW" ? "TWD" : "USD",
    price: null,
    provider: "",
    source: "",
    sourceUrl: "",
    asOf: "",
    receivedAt: new Date(now).toISOString(),
    freshness: "unavailable",
    stale: false,
    available: false,
    error: (result.attempts.at(-1)?.reason as string) || "UNAVAILABLE",
    attempts: result.attempts
  };
}

async function loadFx(now: number) {
  const result = await withFallback([
    { provider: "open-er-api", run: async () => fxFromExchangeRate(await providerRequest(ENDPOINTS.exchangeRate, "json"), now, ENDPOINTS.exchangeRate) },
    { provider: "frankfurter", run: async () => fxFromFrankfurter(await providerRequest(ENDPOINTS.frankfurter, "json"), now, ENDPOINTS.frankfurter) }
  ]);
  if (result.ok) return { ...(result.value as JsonObject), provider: result.provider, attempts: result.attempts };
  return {
    contract: "zhuge-investment-fx-v1",
    base: "USD",
    quote: "TWD",
    rate: null,
    provider: "",
    source: "",
    sourceUrl: "",
    asOf: "",
    receivedAt: new Date(now).toISOString(),
    freshness: "unavailable",
    stale: false,
    available: false,
    error: (result.attempts.at(-1)?.reason as string) || "UNAVAILABLE",
    attempts: result.attempts
  };
}

async function loadNews(requests: RequestSpec[], now: number) {
  const results: JsonObject[] = [];
  const trace: JsonObject[] = [];
  for (const request of requests.slice(0, MAX_NEWS_SYMBOLS)) {
    const query = request.query || `${request.symbol}${request.market === "TW" ? " 台股" : ""}`;
    const googleUrl = `${ENDPOINTS.googleNews}?q=${encodeURIComponent(query)}&hl=${request.market === "TW" ? "zh-TW" : "en-US"}&gl=${request.market === "TW" ? "TW" : "US"}&ceid=${request.market === "TW" ? "TW:zh-Hant" : "US:en"}`;
    const bingUrl = `${ENDPOINTS.bingNews}?q=${encodeURIComponent(query)}&format=rss`;
    const result = await withFallback([
      { provider: "google-news-rss", run: async () => parseRss(await providerRequest(googleUrl, "text"), request, "Google News RSS", now) },
      { provider: "bing-news-rss", run: async () => parseRss(await providerRequest(bingUrl, "text"), request, "Bing News RSS", now) }
    ]);
    trace.push({ symbol: request.symbol, provider: result.provider, attempts: result.attempts });
    if (result.ok) results.push(...(result.value as JsonObject[]));
  }
  return { items: normalizeNews(results), trace };
}

function quoteEvidence(quote: JsonObject) {
  if (quote.available !== true) return null;
  return {
    type: "market_quote",
    symbol: quote.symbol,
    market: quote.market,
    title: `${quote.symbol} 最新可用行情`,
    summary: `${quote.price} ${quote.currency}；來源 ${quote.source}；時間 ${quote.asOf || "未知"}。`,
    source: quote.source,
    sourceUrl: quote.sourceUrl,
    observedAt: quote.asOf,
    quality: quote.freshness === "fresh" ? "fresh" : "stale",
    freshness: quote.freshness,
    stale: quote.stale === true,
    facts: [`price=${quote.price}`, `currency=${quote.currency}`, `provider=${quote.provider}`],
    limitations: quote.stale === true ? ["行情已超過 freshness window，僅作最新可用資料。"] : []
  };
}

function fxEvidence(fx: JsonObject) {
  if (fx.available !== true) return null;
  return {
    type: "fx_benchmark",
    title: "USD/TWD 基準匯率",
    summary: `1 USD ≈ ${fx.rate} TWD；來源 ${fx.source}；時間 ${fx.asOf || "未知"}。`,
    source: fx.source,
    sourceUrl: fx.sourceUrl,
    observedAt: fx.asOf,
    quality: fx.freshness === "fresh" ? "fresh" : "stale",
    freshness: fx.freshness,
    stale: fx.stale === true,
    facts: [`rate=${fx.rate}`, "base=USD", "quote=TWD"],
    limitations: fx.stale === true ? ["匯率已超過 freshness window，僅作閱讀換算。"] : []
  };
}

function buildContext(request: RequestSpec, quote: JsonObject, fx: JsonObject, news: JsonObject[], input: JsonObject, now: number) {
  const relatedNews = news.filter(item => item.symbol === request.symbol);
  const evidence = [
    quoteEvidence(quote),
    request.market === "US" ? fxEvidence(fx) : null,
    ...relatedNews
  ].filter(Boolean);
  const missing: string[] = [];
  if (quote.available !== true) missing.push("latest_quote");
  if (request.market === "US" && fx.available !== true) missing.push("usd_twd_benchmark");
  if (!relatedNews.length) missing.push("news_search");
  return {
    contract: CONTEXT_CONTRACT,
    symbol: request.symbol,
    market: request.market,
    generatedAt: new Date(now).toISOString(),
    portfolioContext: input.portfolio_context && typeof input.portfolio_context === "object"
      ? { current_position_count: finiteNumber((input.portfolio_context as JsonObject).current_position_count) || 0 }
      : {},
    marketPhase: {},
    dataQuality: {
      quote: quote.freshness || "unavailable",
      fx: request.market === "US" ? (fx.freshness || "unavailable") : "not_applicable",
      news: relatedNews.length ? "provider" : "unavailable"
    },
    evidence,
    missing,
    strategyIds: Array.isArray(input.strategy_ids) ? input.strategy_ids.map(value => text(value, 80)).filter(Boolean).slice(0, 20) : []
  };
}

function validateInput(value: unknown) {
  if (!value || typeof value !== "object") throw new HttpError("Investment Intelligence request is invalid.", 400, "INVALID_REQUEST");
  const input = value as JsonObject;
  const requests = uniqueRequests(input.symbols);
  if (!requests.length) throw new HttpError("At least one symbol is required.", 400, "SYMBOLS_REQUIRED");
  const newsLimit = Math.min(MAX_NEWS_SYMBOLS, Math.max(1, Math.floor(Number(input.news_limit || 3))));
  const strategyIds = Array.isArray(input.strategy_ids)
    ? input.strategy_ids.map(item => text(item, 80)).filter(Boolean).slice(0, 20)
    : [];
  return { symbols: requests, news_limit: newsLimit, strategy_ids: strategyIds, portfolio_context: input.portfolio_context };
}

Deno.serve(async request => {
  let origin = "";
  try {
    origin = originFor(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
    if (request.method !== "POST") throw new HttpError("POST is required.", 405, "METHOD_NOT_ALLOWED");
    await requireAuthenticatedSession(request);
    const input = validateInput(await request.json().catch(() => ({})));
    const now = Date.now();
    const [quotes, fx, newsResult] = await Promise.all([
      Promise.all(input.symbols.map(requestValue => loadQuote(requestValue, now))),
      loadFx(now),
      loadNews(input.symbols, now)
    ]);
    const contexts = input.symbols.map(requestValue => {
      const quote = quotes.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market) || {};
      return buildContext(requestValue, quote, fx, newsResult.items, input, now);
    });
    return json({
      contract: CONTRACT,
      read_only: true,
      generated_at: new Date(now).toISOString(),
      quotes,
      fx,
      news: newsResult.items,
      contexts,
      quality: {
        market: {
          total: quotes.length,
          available: quotes.filter(item => item.available === true).length,
          stale: quotes.filter(item => item.stale === true).length
        },
        fx: { available: fx.available === true, freshness: fx.freshness || "unavailable" },
        news: { count: newsResult.items.length, available: newsResult.items.length > 0 }
      },
      provider_trace: {
        market: quotes.map(item => ({ symbol: item.symbol, provider: item.provider || null, attempts: item.attempts || [] })),
        fx: { provider: fx.provider || null, attempts: fx.attempts || [] },
        news: newsResult.trace
      },
      stream_subscriptions: 0,
      mutating_operations_invoked: false
    }, 200, origin);
  } catch (error) {
    if (error instanceof HttpError) return json({ code: error.code, message: error.message }, error.status, origin);
    return json({ code: "INVESTMENT_INTELLIGENCE_READ_FAILED", message: "Investment Intelligence read adapter failed." }, 500, origin);
  }
});
