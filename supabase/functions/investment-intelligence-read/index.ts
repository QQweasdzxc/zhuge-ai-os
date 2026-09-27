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
const HISTORY_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const FUNDAMENTAL_FRESH_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const SEC_USER_AGENT = "Zhuge AI OS Investment Intelligence/1.0 (contact: qq.1025@gmail.com)";

const ENDPOINTS = Object.freeze({
  yahooChart: "https://query2.finance.yahoo.com/v8/finance/chart",
  yahooHistory: "https://query1.finance.yahoo.com/v8/finance/chart",
  twseQuote: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
  twseDaily: "https://www.twse.com.tw/rwd/en/afterTrading/STOCK_DAY",
  twseHoliday: "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
  twseFinancial: "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci",
  twseCompany: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  yuantaEtfBridge: "https://etfapi.yuantaetfs.com/ectranslation/api/bridge",
  exchangeRate: "https://open.er-api.com/v6/latest/USD",
  frankfurter: "https://api.frankfurter.app/latest?from=USD&to=TWD",
  secTickers: "https://www.sec.gov/files/company_tickers.json",
  secFacts: "https://data.sec.gov/api/xbrl/companyfacts",
  secSubmissions: "https://data.sec.gov/submissions",
  googleNews: "https://news.google.com/rss/search",
  bingNews: "https://www.bing.com/news/search"
});

const providerCache = new Map<string, Promise<unknown>>();

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
  const cacheKey = `${parser}:${url}`;
  if (providerCache.has(cacheKey)) return providerCache.get(cacheKey);
  const pending = providerRequestUncached(url, parser);
  providerCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    providerCache.clear();
    throw error;
  }
}

async function providerRequestUncached(url: string, parser: "json" | "text") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: parser === "text" ? "application/rss+xml,text/xml,text/plain" : "application/json",
        ...( /https:\/\/(?:www\.)?(?:sec\.gov|data\.sec\.gov)\//i.test(url) ? { "user-agent": SEC_USER_AGENT } : {})
      },
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

function parseTaipeiDate(value: unknown) {
  const raw = text(value, 40);
  const rocCompact = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (rocCompact) {
    const parsed = new Date(`${Number(rocCompact[1]) + 1911}-${rocCompact[2]}-${rocCompact[3]}T00:00:00+08:00`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  const normalized = raw.replace(/[.\-]/g, "/");
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return Number.isNaN(new Date(raw).getTime()) ? "" : new Date(raw).toISOString();
  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseCompactTaipeiDate(value: unknown) {
  const raw = text(value, 40);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? parseTaipeiDate(`${match[1]}/${match[2]}/${match[3]}`) : parseTaipeiDate(raw);
}

function temporalStatus(asOf: string, now: number, windowMs: number) {
  const timestamp = Date.parse(asOf || "");
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = now - timestamp;
  if (age < -5 * 60 * 1000) return "unknown";
  return age <= windowMs ? "fresh" : "stale";
}

function monthStarts(now: number, count = 6) {
  const cursor = new Date(now);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}01`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return result;
}

function fieldIndex(fields: unknown[], names: string[]) {
  const normalized = (Array.isArray(fields) ? fields : []).map(item => text(item, 80).toLowerCase());
  return names.reduce((found, name) => {
    if (found >= 0) return found;
    const target = name.toLowerCase();
    return normalized.findIndex(field => field === target || field.includes(target));
  }, -1);
}

function parseTwseDailyPayload(request: RequestSpec, payload: unknown, provider: string, sourceUrl: string, now: number) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const rows = Array.isArray(root.data) ? root.data : [];
  const fields = Array.isArray(root.fields) ? root.fields : [];
  const dateIndex = fieldIndex(fields, ["date", "日期"]);
  const openIndex = fieldIndex(fields, ["openingprice", "開盤價"]);
  const highIndex = fieldIndex(fields, ["highestprice", "最高價"]);
  const lowIndex = fieldIndex(fields, ["lowestprice", "最低價"]);
  const closeIndex = fieldIndex(fields, ["closingprice", "收盤價"]);
  const volumeIndex = fieldIndex(fields, ["tradevolume", "成交股數"]);
  const bars = rows.map(row => {
    const values = Array.isArray(row) ? row : [];
    const asOf = parseTaipeiDate(values[dateIndex >= 0 ? dateIndex : 0]);
    const close = finiteNumber(values[closeIndex >= 0 ? closeIndex : 6]);
    if (!asOf || close === null) return null;
    return {
      asOf,
      open: finiteNumber(values[openIndex >= 0 ? openIndex : 3]),
      high: finiteNumber(values[highIndex >= 0 ? highIndex : 4]),
      low: finiteNumber(values[lowIndex >= 0 ? lowIndex : 5]),
      close,
      volume: finiteNumber(values[volumeIndex >= 0 ? volumeIndex : 1])
    };
  }).filter(Boolean).sort((left, right) => Date.parse(left!.asOf) - Date.parse(right!.asOf));
  if (!bars.length) throw Object.assign(new Error("TWSE history unavailable"), { code: "HISTORY_UNAVAILABLE" });
  const asOf = bars.at(-1)!.asOf;
  return {
    contract: "zhuge-investment-history-v1",
    symbol: request.symbol,
    market: request.market,
    currency: "TWD",
    provider,
    source: "TWSE Daily Trading Open Data",
    sourceUrl,
    asOf,
    freshness: temporalStatus(asOf, now, HISTORY_FRESH_MS),
    stale: temporalStatus(asOf, now, HISTORY_FRESH_MS) === "stale",
    available: true,
    bars
  };
}

function parseYahooHistory(request: RequestSpec, payload: unknown, provider: string, sourceUrl: string, now: number) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const chart = root.chart && typeof root.chart === "object" ? root.chart as JsonObject : {};
  const result = Array.isArray(chart.result) ? chart.result[0] as JsonObject : {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = result.indicators && typeof result.indicators === "object" ? result.indicators as JsonObject : {};
  const quote = Array.isArray(indicators.quote) ? indicators.quote[0] as JsonObject : {};
  const bars = timestamps.map((timestamp, index) => {
    const close = finiteNumber(quote.close?.[index]);
    if (close === null) return null;
    return {
      asOf: new Date(Number(timestamp) * 1000).toISOString(),
      open: finiteNumber(quote.open?.[index]),
      high: finiteNumber(quote.high?.[index]),
      low: finiteNumber(quote.low?.[index]),
      close,
      volume: finiteNumber(quote.volume?.[index])
    };
  }).filter(Boolean);
  if (!bars.length) throw Object.assign(new Error("Yahoo history unavailable"), { code: "HISTORY_UNAVAILABLE" });
  const meta = result.meta && typeof result.meta === "object" ? result.meta as JsonObject : {};
  const asOf = bars.at(-1)!.asOf;
  return {
    contract: "zhuge-investment-history-v1",
    symbol: request.symbol,
    market: request.market,
    currency: text(meta.currency, 10) || (request.market === "TW" ? "TWD" : "USD"),
    provider,
    source: "Yahoo Finance Chart Compatibility Provider",
    sourceUrl,
    asOf,
    freshness: temporalStatus(asOf, now, HISTORY_FRESH_MS),
    stale: temporalStatus(asOf, now, HISTORY_FRESH_MS) === "stale",
    available: true,
    bars
  };
}

function technicalEvidence(history: JsonObject) {
  if (history.available !== true || !Array.isArray(history.bars) || history.bars.length < 20) return null;
  const closes = history.bars.map(item => finiteNumber((item as JsonObject).close)).filter(value => value !== null) as number[];
  if (closes.length < 20) return null;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const facts = [`bars=${closes.length}`, `last_close=${closes.at(-1)}`, `sma20=${average(closes.slice(-20)).toFixed(4)}`];
  if (closes.length >= 50) facts.push(`sma50=${average(closes.slice(-50)).toFixed(4)}`);
  if (closes.length >= 15) {
    const recent = closes.slice(-15);
    const changes = recent.slice(1).map((value, index) => value - recent[index]);
    const averageGain = changes.filter(value => value > 0).reduce((sum, value) => sum + value, 0) / 14;
    const averageLoss = changes.filter(value => value < 0).map(value => Math.abs(value)).reduce((sum, value) => sum + value, 0) / 14;
    const rsi = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
    facts.push(`rsi14=${rsi.toFixed(4)}`);
  }
  return {
    type: "technical",
    symbol: history.symbol,
    market: history.market,
    title: `${history.symbol} OHLC / 技術觀察`,
    summary: `使用 ${closes.length} 筆可驗證歷史收盤資料計算 SMA20${closes.length >= 50 ? "、SMA50" : ""} 與 RSI14。`,
    source: history.source,
    sourceUrl: history.sourceUrl,
    observedAt: history.asOf,
    quality: history.freshness === "fresh" ? "fresh" : "stale",
    freshness: history.freshness,
    stale: history.stale === true,
    facts,
    limitations: ["本 Evidence 只提供可驗證的技術觀察，不產生買賣建議。", ...(history.stale === true ? ["歷史序列最新資料已超過 freshness window。"] : [])]
  };
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

function secFactSeries(facts: JsonObject, names: string[]) {
  const namespaces = [facts["us-gaap"], facts.dei].filter(item => item && typeof item === "object") as JsonObject[];
  const candidates: Array<Array<{ name: string; unit: string; value: number | null; end: string; filed: string; form: string }>> = [];
  for (const name of names) {
    for (const namespace of namespaces) {
      const entry = namespace[name] && typeof namespace[name] === "object" ? namespace[name] as JsonObject : {};
      const units = entry.units && typeof entry.units === "object" ? entry.units as JsonObject : {};
      const rows = Object.entries(units).flatMap(([unit, values]) => (Array.isArray(values) ? values : []).map(item => ({
        name,
        unit,
        value: finiteNumber((item as JsonObject)?.val),
        end: text((item as JsonObject)?.end || (item as JsonObject)?.filed, 40),
        filed: text((item as JsonObject)?.filed, 40),
        form: text((item as JsonObject)?.form, 20)
      }))).filter(item => item.value !== null)
        .sort((left, right) => String(right.end || right.filed).localeCompare(String(left.end || left.filed)));
      const seen = new Set<string>();
      const unique = rows.filter(item => {
        const key = `${item.end}|${item.value}|${item.unit}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (unique.length) candidates.push(unique);
    }
  }
  return candidates.sort((left, right) => {
    const leftDate = Date.parse(left[0]?.end || left[0]?.filed || "") || 0;
    const rightDate = Date.parse(right[0]?.end || right[0]?.filed || "") || 0;
    return rightDate - leftDate || right.length - left.length;
  })[0] || [];
}

async function secTickerCik(symbol: string) {
  const payload = await providerRequest(ENDPOINTS.secTickers, "json") as JsonObject;
  const rows = Object.values(payload || {});
  const ticker = rows.find(item => text((item as JsonObject)?.ticker, 20).toUpperCase() === symbol);
  const cik = text((ticker as JsonObject)?.cik_str, 20).padStart(10, "0");
  if (!cik) throw Object.assign(new Error("SEC CIK unavailable"), { code: "IDENTITY_UNAVAILABLE" });
  return cik;
}

function numericRowMetric(row: JsonObject, pattern: RegExp) {
  for (const [key, value] of Object.entries(row)) {
    if (!pattern.test(key)) continue;
    const parsed = finiteNumber(value);
    if (parsed !== null) return { key, value: parsed };
  }
  return null;
}

function twseFinancialEvidence(request: RequestSpec, payload: unknown, sourceUrl: string, now: number) {
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as JsonObject).data) ? (payload as JsonObject).data : [];
  const row = rows.find(item => text((item as JsonObject)?.公司代號 || (item as JsonObject)?.Code, 20) === request.symbol) as JsonObject | undefined;
  if (!row) throw Object.assign(new Error("TWSE financial unavailable"), { code: "FUNDAMENTAL_UNAVAILABLE" });
  const metrics = [
    ["revenue", numericRowMetric(row, /營業收入|revenue/i)],
    ["gross_profit", numericRowMetric(row, /營業毛利|gross.?profit/i)],
    ["operating_income", numericRowMetric(row, /營業利益|operating.?income/i)],
    ["net_income", numericRowMetric(row, /本期淨利|淨利.*母公司|net.?income/i)],
    ["eps", numericRowMetric(row, /每股盈餘|eps/i)],
    ["revenue_growth_pct", numericRowMetric(row, /營收.*(成長|年增)|revenue.*growth|growth.*revenue/i)]
  ] as Array<[string, { key: string; value: number } | null]>;
  const facts = metrics.filter(([, value]) => value).map(([label, value]) => `${label}=${value!.value} @${value!.key}`);
  const revenue = metrics.find(([label]) => label === "revenue")?.[1];
  const netIncome = metrics.find(([label]) => label === "net_income")?.[1];
  if (revenue && netIncome && revenue.value !== 0) facts.push(`net_margin_pct=${((netIncome.value / revenue.value) * 100).toFixed(2)}`);
  if (!facts.length) throw Object.assign(new Error("TWSE financial facts unavailable"), { code: "FUNDAMENTAL_UNAVAILABLE" });
  const missing = [];
  if (!metrics.find(([label]) => label === "revenue_growth_pct")?.[1]) missing.push("revenue_growth");
  if (!metrics.find(([label]) => label === "eps")?.[1]) missing.push("eps");
  const observedAt = parseTaipeiDate(row.出表日期 || row.資料日期 || row.資料年月);
  const freshnessValue = temporalStatus(observedAt, now, FUNDAMENTAL_FRESH_MS);
  return {
    type: "fundamental",
    symbol: request.symbol,
    market: request.market,
    title: `${request.symbol} TWSE 公開財報資料`,
    summary: `TWSE 官方公開資料提供 ${facts.length} 項可驗證基本面欄位。`,
    source: "TWSE Financial Open Data",
    sourceUrl,
    observedAt,
    quality: "official_open_data",
    freshness: freshnessValue,
    stale: freshnessValue === "stale",
    facts,
    limitations: [
      ...missing.map(label => `${label}=INSUFFICIENT_EVIDENCE`),
      "valuation=INSUFFICIENT_EVIDENCE",
      "TWSE 公開財報資料不直接提供完整估值或投資建議。"
    ]
  };
}

async function loadFundamental(request: RequestSpec, now: number) {
  if (request.market === "TW") {
    const url = ENDPOINTS.twseFinancial;
    return { provider: "twse-financial", evidence: twseFinancialEvidence(request, await providerRequest(url, "json"), url, now) };
  }
  const cik = await secTickerCik(request.symbol);
  const url = `${ENDPOINTS.secFacts}/CIK${cik}.json`;
  const payload = await providerRequest(url, "json") as JsonObject;
  const facts = payload.facts && typeof payload.facts === "object" ? payload.facts as JsonObject : payload;
  const selections = [
    ["revenue", ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "Revenues"]],
    ["assets", ["Assets"]],
    ["net_income", ["NetIncomeLoss"]],
    ["eps_diluted", ["EarningsPerShareDiluted"]],
    ["shares_outstanding", ["EntityCommonStockSharesOutstanding"]]
  ].map(([label, names]) => [label, secFactSeries(facts, names as string[])]).filter(([, series]) => Array.isArray(series) && series.length) as Array<[string, Array<{ value: number | null; unit: string; end: string; filed: string; form: string }>] >;
  if (!selections.length) throw Object.assign(new Error("SEC Company Facts unavailable"), { code: "FUNDAMENTAL_UNAVAILABLE" });
  const factsList = selections.map(([label, series]) => {
    const latest = series[0];
    return `${label}=${latest.value}${latest.unit ? ` ${latest.unit}` : ""}${latest.end ? ` @${latest.end}` : ""}`;
  });
  const revenueSeries = selections.find(([label]) => label === "revenue")?.[1] || [];
  const netIncome = selections.find(([label]) => label === "net_income")?.[1]?.[0];
  const revenue = revenueSeries[0];
  if (revenueSeries.length > 1 && revenueSeries[1].value !== null && revenueSeries[1].value !== 0 && revenue.value !== null) {
    factsList.push(`revenue_growth_pct_versus_previous_reported_period=${(((revenue.value - revenueSeries[1].value) / Math.abs(revenueSeries[1].value)) * 100).toFixed(2)}`);
  }
  if (revenue?.value !== null && netIncome?.value !== null && revenue.value !== 0) {
    factsList.push(`net_margin_pct=${((netIncome.value / revenue.value) * 100).toFixed(2)}`);
  }
  const missing = [];
  if (revenueSeries.length < 2) missing.push("revenue_growth");
  if (!selections.some(([label]) => label === "eps_diluted")) missing.push("eps_diluted");
  if (!selections.some(([label]) => label === "net_income") || !revenue) missing.push("profitability_margin");
  const observedAt = selections.flatMap(([, series]) => series.map(value => value.end)).filter(Boolean).sort().at(-1) || "";
  const freshnessValue = temporalStatus(observedAt, now, FUNDAMENTAL_FRESH_MS);
  return {
    provider: "sec-company-facts",
    evidence: {
      type: "fundamental",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} SEC Company Facts`,
      summary: `SEC Company Facts 提供 ${factsList.length} 項可驗證基本面欄位。`,
      source: "SEC EDGAR Company Facts",
      sourceUrl: url,
      observedAt,
      quality: "official_open_data",
      freshness: freshnessValue,
      stale: freshnessValue === "stale",
      facts: factsList,
      limitations: [
        ...missing.map(label => `${label}=INSUFFICIENT_EVIDENCE`),
        "valuation=INSUFFICIENT_EVIDENCE",
        "SEC Company Facts 不直接提供完整估值、ETF 成分或投資建議。"
      ]
    }
  };
}

function yuantaEtfUrl(symbol: string) {
  const params = new URLSearchParams({
    APIType: "ETFAPI",
    AppName: "ETF",
    CompanyName: "YUANTAFUNDS",
    PageName: "/investment",
    DeviceId: "zhuge-ai-os-investment",
    FuncId: "PCF/Daily",
    Device: "3",
    Platform: "ETF",
    ticker: symbol
  });
  return `${ENDPOINTS.yuantaEtfBridge}?${params.toString()}`;
}

function yuantaComponentRows(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const weights = root.FundWeights && typeof root.FundWeights === "object" ? (root.FundWeights as JsonObject).StockWeights : null;
  return Array.isArray(weights) ? weights : [];
}

function yuantaComponent(row: unknown) {
  const item = row && typeof row === "object" ? row as JsonObject : {};
  const symbol = text(item.code || item.stkcd, 20).toUpperCase();
  const name = text(item.name, 120);
  const weight = finiteNumber(item.weights);
  return symbol ? { symbol, name, weight } : null;
}

async function loadYuantaEtfRelationships(request: RequestSpec, now: number) {
  if (request.market !== "TW") throw Object.assign(new Error("ETF relationship unavailable"), { code: "RELATIONSHIP_UNAVAILABLE" });
  const sourceUrl = yuantaEtfUrl(request.symbol);
  const payload = await providerRequest(sourceUrl, "json") as JsonObject;
  const rows = yuantaComponentRows(payload).map(yuantaComponent).filter(Boolean) as Array<{ symbol: string; name: string; weight: number | null }>;
  const pcf = payload.PCF && typeof payload.PCF === "object" ? payload.PCF as JsonObject : {};
  if (!rows.length || !text(pcf.markcd, 20)) throw Object.assign(new Error("ETF components unavailable"), { code: "RELATIONSHIP_UNAVAILABLE" });
  const observedAt = parseCompactTaipeiDate(pcf.trandate || pcf.upddate);
  const freshnessValue = temporalStatus(observedAt, now, 7 * 24 * 60 * 60 * 1000);
  const componentFacts = [
    `fund=${text(pcf.fundname, 120) || request.symbol}`,
    `component_count=${rows.length}`,
    ...rows.slice(0, 20).map(item => `component=${item.symbol}${item.name ? `:${item.name}` : ""}${item.weight !== null ? `;weight_pct=${item.weight}` : ""}`)
  ];
  const componentEvidence: JsonObject = {
    type: "etf_component",
    symbol: request.symbol,
    market: request.market,
    title: `${request.symbol} ETF 成分股與權重`,
    summary: `元大投信公開 PCF/Daily 提供 ${rows.length} 筆 ${text(pcf.fundname, 120) || request.symbol} 成分資料。`,
    source: "Yuanta ETF PCF/Daily",
    sourceUrl,
    observedAt,
    quality: "official_issuer_open_data",
    freshness: freshnessValue,
    stale: freshnessValue === "stale",
    facts: componentFacts,
    limitations: ["成分資料是觀察與研究 Evidence，不直接產生投資建議。", ...(rows.length > 20 ? ["僅在 facts 展示前 20 筆，完整筆數由 component_count 保留。"] : [])]
  };
  const evidence: JsonObject[] = [componentEvidence];
  let companyPayload: unknown = [];
  let companyUnavailable = false;
  try {
    companyPayload = await providerRequest(ENDPOINTS.twseCompany, "json");
  } catch {
    companyUnavailable = true;
  }
  const companyRows = Array.isArray(companyPayload) ? companyPayload : companyPayload && typeof companyPayload === "object" && Array.isArray((companyPayload as JsonObject).data) ? (companyPayload as JsonObject).data : [];
  const industryBySymbol = new Map<string, string>();
  for (const row of companyRows) {
    const item = row as JsonObject;
    const symbol = text(item.公司代號 || item.Code, 20).toUpperCase();
    const industry = text(item.產業別 || item.Industry, 120);
    if (symbol && industry) industryBySymbol.set(symbol, industry);
  }
  const exposures = new Map<string, { weight: number; count: number; symbols: string[] }>();
  for (const item of rows) {
    const industry = industryBySymbol.get(item.symbol);
    if (!industry) continue;
    const current = exposures.get(industry) || { weight: 0, count: 0, symbols: [] };
    current.weight += item.weight || 0;
    current.count += 1;
    current.symbols.push(item.symbol);
    exposures.set(industry, current);
  }
  if (exposures.size) {
    evidence.push({
      type: "industry_exposure",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} ETF 產業曝險`,
      summary: `依 ETF 成分與 TWSE 官方產業分類整理 ${exposures.size} 個產業群組。`,
      source: "Yuanta ETF PCF/Daily + TWSE Company Basic Open Data",
      sourceUrl: ENDPOINTS.twseCompany,
      observedAt: "",
      quality: "official_open_data",
      freshness: "unknown",
      stale: false,
      facts: Array.from(exposures.entries()).sort((left, right) => right[1].weight - left[1].weight).slice(0, 20).map(([industry, value]) => `industry=${industry};component_count=${value.count};weight_pct=${value.weight.toFixed(2)};symbols=${value.symbols.slice(0, 12).join(",")}`),
      limitations: ["產業曝險依公開成分與公司分類彙總；未包含未能對應分類的成分。"]
    });
  } else {
    (componentEvidence.limitations as string[]).push(`industry_exposure=INSUFFICIENT_EVIDENCE${companyUnavailable ? ": TWSE company classification unavailable" : ": no component classification matched"}`);
  }
  const related = rows.filter(item => item.symbol !== request.symbol).slice(0, 10);
  if (related.length) {
    evidence.push({
      type: "related_symbol",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} 相關成分標的`,
      summary: `以官方 ETF 成分權重排序，提供可進一步研究的相關標的。`,
      source: "Yuanta ETF PCF/Daily",
      sourceUrl,
      observedAt,
      quality: "official_issuer_open_data",
      freshness: freshnessValue,
      stale: freshnessValue === "stale",
      facts: related.map(item => `related_symbol=${item.symbol}${item.name ? `:${item.name}` : ""}${item.weight !== null ? `;weight_pct=${item.weight}` : ""}`),
      limitations: ["相關標的是成分關係 Evidence，不等同推薦或買賣訊號。"]
    });
  }
  return evidence;
}

async function loadRelationship(request: RequestSpec) {
  if (request.market === "TW") {
    const url = ENDPOINTS.twseCompany;
    const payload = await providerRequest(url, "json");
    const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as JsonObject).data) ? (payload as JsonObject).data : [];
    const row = rows.find(item => text((item as JsonObject)?.公司代號 || (item as JsonObject)?.Code, 20) === request.symbol) as JsonObject | undefined;
    const industry = text(row?.產業別 || row?.Industry, 120);
    if (!row || !industry) throw Object.assign(new Error("TWSE industry unavailable"), { code: "RELATIONSHIP_UNAVAILABLE" });
    return {
      provider: "twse-company-industry",
      evidence: {
        type: "industry",
        symbol: request.symbol,
        market: request.market,
        title: `${request.symbol} 台灣產業分類`,
        summary: `公司 ${text(row?.公司名稱 || row?.Name, 120) || request.symbol} 的官方產業分類為 ${industry}。`,
        source: "TWSE Company Basic Open Data",
        sourceUrl: url,
        observedAt: "",
        quality: "official_open_data",
        facts: [`industry=${industry}`, `company=${text(row?.公司名稱 || row?.Name, 120) || request.symbol}`],
        limitations: ["官方產業分類不是 ETF 成分或投資建議。"]
      }
    };
  }
  const cik = await secTickerCik(request.symbol);
  const url = `${ENDPOINTS.secSubmissions}/CIK${cik}.json`;
  const payload = await providerRequest(url, "json") as JsonObject;
  const industry = text(payload.sicDescription, 120);
  if (!industry) throw Object.assign(new Error("SEC industry unavailable"), { code: "RELATIONSHIP_UNAVAILABLE" });
  return {
    provider: "sec-company-industry",
    evidence: {
      type: "industry",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} SEC industry classification`,
      summary: `SEC submissions 提供產業分類 ${industry}。`,
      source: "SEC EDGAR Submissions",
      sourceUrl: url,
      observedAt: "",
      quality: "official_open_data",
      facts: [`industry=${industry}`, `sic=${text(payload.sic, 40)}`],
      limitations: ["SEC SIC 分類不是 ETF 成分或投資建議。"]
    }
  };
}

async function loadMarketHistory(request: RequestSpec, now: number, source = request.market === "TW" ? "twse" : "yahoo") {
  if (request.market === "TW" && source === "twse") {
    const responses: Array<{ payload: unknown; url: string }> = [];
    for (const month of monthStarts(now, 6)) {
      const url = `${ENDPOINTS.twseDaily}?date=${month}&stockNo=${encodeURIComponent(request.symbol)}&response=json`;
      try {
        responses.push({ payload: await providerRequest(url, "json"), url });
      } catch {
        // Keep the month-level failure in fallback evidence; retain other official bars.
      }
    }
    const bars = responses.flatMap(item => {
      try {
        return parseTwseDailyPayload(request, item!.payload, "twse-daily-history", item!.url, now).bars;
      } catch {
        return [];
      }
    });
    const uniqueBars = Array.from(new Map(bars.map(item => [item.asOf, item])).values()).sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
    if (!uniqueBars.length) throw Object.assign(new Error("TWSE history unavailable"), { code: "HISTORY_UNAVAILABLE" });
    const asOf = uniqueBars.at(-1)!.asOf;
    return {
      provider: "twse-daily-history",
      history: {
        contract: "zhuge-investment-history-v1",
        symbol: request.symbol,
        market: request.market,
        currency: "TWD",
        provider: "twse-daily-history",
        source: "TWSE Daily Trading Open Data",
        sourceUrl: ENDPOINTS.twseDaily,
        asOf,
        freshness: temporalStatus(asOf, now, HISTORY_FRESH_MS),
        stale: temporalStatus(asOf, now, HISTORY_FRESH_MS) === "stale",
        available: true,
        bars: uniqueBars
      }
    };
  }
  const url = `${ENDPOINTS.yahooHistory}/${encodeURIComponent(yahooSymbol(request))}?range=1y&interval=1d&includePrePost=false`;
  return { provider: "yahoo-history", history: parseYahooHistory(request, await providerRequest(url, "json"), "yahoo-history", url, now) };
}

async function loadMarketPhase(request: RequestSpec, now: number) {
  if (request.market !== "TW") throw Object.assign(new Error("Market phase unavailable"), { code: "MARKET_PHASE_UNAVAILABLE" });
  const payload = await providerRequest(ENDPOINTS.twseHoliday, "json");
  const local = new Date(now + 8 * 60 * 60 * 1000);
  const weekday = local.getUTCDay();
  const dateKey = `${local.getUTCFullYear() - 1911}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as JsonObject).data) ? (payload as JsonObject).data : [];
  const holiday = rows.find(item => text((item as JsonObject)?.Date || (item as JsonObject)?.日期, 40).replace(/\D/g, "") === dateKey) as JsonObject | undefined;
  const description = text(holiday?.Description || holiday?.說明, 120);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const phase = weekday === 0 || weekday === 6 || /無交易|休市|holiday|closed/i.test(description)
    ? "CLOSED"
    : minutes >= 510 && minutes < 540 ? "PRE_OPEN"
      : minutes >= 540 && minutes < 810 ? "OPEN"
        : minutes >= 810 && minutes < 840 ? "POST_CLOSE"
          : "CLOSED";
  return {
    provider: "twse-market-phase",
    phase: {
      market: "TW",
      phase,
      source: "TWSE Holiday Schedule + published session hours",
      sourceUrl: ENDPOINTS.twseHoliday,
      asOf: new Date(now).toISOString(),
      available: true,
      evidence: [{
        type: "market_phase",
        symbol: request.symbol,
        market: "TW",
        title: `${request.symbol} 台股市場階段`,
        summary: `TWSE 交易時段判定為 ${phase}。`,
        source: "TWSE Holiday Schedule + published session hours",
        sourceUrl: ENDPOINTS.twseHoliday,
        observedAt: new Date(now).toISOString(),
        quality: "official_open_data",
        facts: [`phase=${phase}`, `holiday=${description || "none"}`],
        limitations: ["市場階段依公開交易日曆與固定交易時段判定，不代表個別標的可成交。"]
      }]
    }
  };
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

async function loadHistories(requests: RequestSpec[], now: number) {
  const results: JsonObject[] = [];
  const trace: JsonObject[] = [];
  for (const request of requests) {
    const result = await withFallback([
      { provider: "twse-daily-history", run: async () => (await loadMarketHistory(request, now, "twse")).history },
      { provider: "yahoo-history", run: async () => (await loadMarketHistory(request, now, "yahoo")).history }
    ].filter(candidate => request.market === "TW" || candidate.provider === "yahoo-history"));
    trace.push({ symbol: request.symbol, provider: result.provider, attempts: result.attempts });
    results.push(result.ok
      ? { ...(result.value as JsonObject), provider: result.provider, attempts: result.attempts }
      : { contract: "zhuge-investment-history-v1", symbol: request.symbol, market: request.market, provider: "", source: "", sourceUrl: "", asOf: "", freshness: "unavailable", stale: false, available: false, bars: [], error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts });
  }
  return { items: results, trace };
}

async function loadFundamentals(requests: RequestSpec[], now: number) {
  const items: JsonObject[] = [];
  const trace: JsonObject[] = [];
  for (const request of requests) {
    const result = await withFallback([{ provider: request.market === "TW" ? "twse-financial" : "sec-company-facts", run: async () => loadFundamental(request, now) }]);
    trace.push({ symbol: request.symbol, provider: result.provider, attempts: result.attempts });
    items.push(result.ok
      ? { symbol: request.symbol, market: request.market, provider: result.provider, available: true, evidence: [(result.value as JsonObject).evidence], error: null, attempts: result.attempts }
      : { symbol: request.symbol, market: request.market, provider: null, available: false, evidence: [], error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts });
  }
  return { items, trace };
}

async function loadRelationships(requests: RequestSpec[], now: number) {
  const items: JsonObject[] = [];
  const trace: JsonObject[] = [];
  for (const request of requests) {
    const candidates = request.market === "TW"
      ? [
          { provider: "yuanta-etf-pcf", run: async () => loadYuantaEtfRelationships(request, now) },
          { provider: "twse-company-industry", run: async () => [((await loadRelationship(request)) as JsonObject).evidence as JsonObject] }
        ]
      : [{ provider: "sec-company-industry", run: async () => [((await loadRelationship(request)) as JsonObject).evidence as JsonObject] }];
    const result = await withFallback(candidates);
    trace.push({ symbol: request.symbol, provider: result.provider, attempts: result.attempts });
    items.push(result.ok
      ? { symbol: request.symbol, market: request.market, provider: result.provider, available: true, evidence: Array.isArray(result.value) ? result.value : [(result.value as JsonObject).evidence], error: null, attempts: result.attempts }
      : { symbol: request.symbol, market: request.market, provider: null, available: false, evidence: [], error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts });
  }
  return { items, trace };
}

async function loadMarketPhases(requests: RequestSpec[], now: number) {
  const resultByMarket: Record<string, JsonObject> = {};
  const trace: JsonObject[] = [];
  for (const request of requests.filter(item => item.market === "TW")) {
    if (resultByMarket[request.market]) continue;
    const result = await withFallback([{ provider: "twse-market-phase", run: async () => (await loadMarketPhase(request, now)).phase }]);
    trace.push({ market: request.market, provider: result.provider, attempts: result.attempts });
    resultByMarket[request.market] = result.ok
      ? { ...(result.value as JsonObject), provider: result.provider, attempts: result.attempts }
      : { market: request.market, phase: "UNKNOWN", available: false, provider: null, source: "", sourceUrl: "", asOf: "", evidence: [], error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts };
  }
  return { items: resultByMarket, trace };
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

function phaseEvidence(phase: JsonObject) {
  return phase.available === true && Array.isArray(phase.evidence) ? phase.evidence[0] as JsonObject : null;
}

function buildContext(request: RequestSpec, quote: JsonObject, fx: JsonObject, news: JsonObject[], history: JsonObject, fundamental: JsonObject, relationship: JsonObject, phase: JsonObject, input: JsonObject, now: number) {
  const relatedNews = news.filter(item => item.symbol === request.symbol);
  const evidence = [
    quoteEvidence(quote),
    request.market === "US" ? fxEvidence(fx) : null,
    phaseEvidence(phase),
    technicalEvidence(history),
    ...(Array.isArray(fundamental.evidence) ? fundamental.evidence : []),
    ...(Array.isArray(relationship.evidence) ? relationship.evidence : []),
    ...relatedNews
  ].filter(Boolean);
  const missing: string[] = [];
  if (quote.available !== true) missing.push("latest_quote");
  if (request.market === "US" && fx.available !== true) missing.push("usd_twd_benchmark");
  if (!relatedNews.length) missing.push("news_search");
  if (!technicalEvidence(history)) missing.push("historical_ohlc_or_indicators");
  if (fundamental.available !== true) missing.push("fundamental_evidence");
  if (relationship.available !== true) missing.push("relationship_evidence");
  if (phase.available !== true) missing.push("market_phase");
  return {
    contract: CONTEXT_CONTRACT,
    symbol: request.symbol,
    market: request.market,
    generatedAt: new Date(now).toISOString(),
    portfolioContext: input.portfolio_context && typeof input.portfolio_context === "object"
      ? { current_position_count: finiteNumber((input.portfolio_context as JsonObject).current_position_count) || 0 }
      : {},
    marketPhase: phase,
    dataQuality: {
      quote: quote.freshness || "unavailable",
      fx: request.market === "US" ? (fx.freshness || "unavailable") : "not_applicable",
      news: relatedNews.length ? "provider" : "unavailable",
      technical: technicalEvidence(history)?.freshness || "unavailable",
      fundamental: fundamental.available === true ? "official_open_data" : "unavailable",
      relationship: relationship.available === true ? "official_open_data" : "unavailable",
      marketPhase: phase.available === true ? "official_open_data" : "unavailable"
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
    providerCache.clear();
    const now = Date.now();
    const [quotes, fx, newsResult, historiesResult, fundamentalsResult, relationshipsResult, marketPhaseResult] = await Promise.all([
      Promise.all(input.symbols.map(requestValue => loadQuote(requestValue, now))),
      loadFx(now),
      loadNews(input.symbols, now),
      loadHistories(input.symbols, now),
      loadFundamentals(input.symbols, now),
      loadRelationships(input.symbols, now),
      loadMarketPhases(input.symbols, now)
    ]);
    const contexts = input.symbols.map(requestValue => {
      const quote = quotes.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market) || {};
      const history = historiesResult.items.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market) || {};
      const fundamental = fundamentalsResult.items.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market) || { available: false, evidence: [] };
      const relationship = relationshipsResult.items.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market) || { available: false, evidence: [] };
      const phase = marketPhaseResult.items[requestValue.market] || { available: false, evidence: [] };
      return buildContext(requestValue, quote, fx, newsResult.items, history, fundamental, relationship, phase, input, now);
    });
    return json({
      contract: CONTRACT,
      read_only: true,
      generated_at: new Date(now).toISOString(),
      quotes,
      fx,
      news: newsResult.items,
      histories: historiesResult.items,
      fundamentals: fundamentalsResult.items,
      relationships: relationshipsResult.items,
      market_phase: marketPhaseResult.items,
      contexts,
      quality: {
        market: {
          total: quotes.length,
          available: quotes.filter(item => item.available === true).length,
          stale: quotes.filter(item => item.stale === true).length
        },
        fx: { available: fx.available === true, freshness: fx.freshness || "unavailable" },
        news: { count: newsResult.items.length, available: newsResult.items.length > 0 },
        technical: { available: historiesResult.items.some(item => Boolean(technicalEvidence(item))) },
        fundamental: { available: fundamentalsResult.items.some(item => item.available === true) },
        relationship: { available: relationshipsResult.items.some(item => item.available === true) },
        marketPhase: { available: Object.values(marketPhaseResult.items).some(item => item.available === true) }
      },
      provider_trace: {
        market: quotes.map(item => ({ symbol: item.symbol, provider: item.provider || null, attempts: item.attempts || [] })),
        fx: { provider: fx.provider || null, attempts: fx.attempts || [] },
        news: newsResult.trace,
        history: historiesResult.trace,
        fundamental: fundamentalsResult.trace,
        relationship: relationshipsResult.trace,
        marketPhase: marketPhaseResult.trace
      },
      stream_subscriptions: 0,
      mutating_operations_invoked: false
    }, 200, origin);
  } catch (error) {
    if (error instanceof HttpError) return json({ code: error.code, message: error.message }, error.status, origin);
    return json({ code: "INVESTMENT_INTELLIGENCE_READ_FAILED", message: "Investment Intelligence read adapter failed." }, 500, origin);
  }
});
