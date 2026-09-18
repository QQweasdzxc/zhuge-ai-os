(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentIntelligenceProviders = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const DEFAULT_ENDPOINTS = Object.freeze({
    yahooChart: "https://query2.finance.yahoo.com/v8/finance/chart",
    yahooHistory: "https://query1.finance.yahoo.com/v8/finance/chart",
    twseQuote: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
    twseDaily: "https://www.twse.com.tw/rwd/en/afterTrading/STOCK_DAY",
    twseHoliday: "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
    twseFinancial: "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci",
    twseCompany: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    exchangeRate: "https://open.er-api.com/v6/latest/USD",
    frankfurter: "https://api.frankfurter.app/latest?from=USD&to=TWD",
    secTickers: "https://www.sec.gov/files/company_tickers.json",
    secFacts: "https://data.sec.gov/api/xbrl/companyfacts",
    secSubmissions: "https://data.sec.gov/submissions",
    googleNews: "https://news.google.com/rss/search",
    bingNews: "https://www.bing.com/news/search"
  });

  function providerError(code, message, detail = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, detail);
    return error;
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value) {
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function marketOf(value) {
    const market = text(value).toUpperCase();
    return market === "US" ? "US" : "TW";
  }

  function normalizeRequest(item) {
    const request = typeof item === "string" ? { symbol: item } : item || {};
    const symbol = text(request.symbol).toUpperCase().replace(/\.(TW|TWO)$/i, "");
    if (!symbol) return null;
    return Object.freeze({
      symbol,
      market: marketOf(request.market || (/^\d{4,6}$/.test(symbol) ? "TW" : "US")),
      name: text(request.name),
      query: text(request.query)
    });
  }

  function uniqueRequests(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [items])
      .map(normalizeRequest)
      .filter(item => {
        if (!item) return false;
        const key = `${item.market}:${item.symbol}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function yahooSymbol(request) {
    return request.market === "TW" ? `${request.symbol}.TW` : request.symbol;
  }

  function twseSymbol(request) {
    return `tse_${request.symbol}.tw`;
  }

  function parseTaipeiDate(value) {
    const raw = text(value);
    if (!raw) return "";
    const normalized = raw.replace(/[.\-]/g, "/");
    const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!match) return Number.isNaN(new Date(raw).getTime()) ? "" : new Date(raw).toISOString();
    const [, year, month, day] = match;
    const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  function freshnessLabel(asOf, nowMs, freshWithinMs) {
    const timestamp = Date.parse(String(asOf || ""));
    if (!Number.isFinite(timestamp)) return "unknown";
    const age = nowMs - timestamp;
    if (age < -5 * 60 * 1000) return "unknown";
    return age <= freshWithinMs ? "fresh" : "stale";
  }

  function monthStarts(nowMs, count = 6) {
    const cursor = new Date(nowMs);
    cursor.setUTCDate(1);
    cursor.setUTCHours(0, 0, 0, 0);
    const result = [];
    for (let index = 0; index < count; index += 1) {
      const year = cursor.getUTCFullYear();
      const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      result.push(`${year}${month}01`);
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
    return result;
  }

  function fieldIndex(fields, names) {
    const normalized = (Array.isArray(fields) ? fields : []).map(item => text(item).toLowerCase());
    return names.reduce((found, name) => {
      if (found >= 0) return found;
      const target = String(name).toLowerCase();
      return normalized.findIndex(field => field === target || field.includes(target));
    }, -1);
  }

  function parseTwseDailyPayload(request, payload, provider, sourceUrl, nowMs) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const fields = Array.isArray(payload?.fields) ? payload.fields : [];
    const dateIndex = fieldIndex(fields, ["date", "日期"]);
    const openIndex = fieldIndex(fields, ["openingprice", "開盤價"]);
    const highIndex = fieldIndex(fields, ["highestprice", "最高價"]);
    const lowIndex = fieldIndex(fields, ["lowestprice", "最低價"]);
    const closeIndex = fieldIndex(fields, ["closingprice", "收盤價"]);
    const volumeIndex = fieldIndex(fields, ["tradevolume", "成交股數"]);
    const bars = rows.map(row => {
      const date = parseTaipeiDate(row?.[dateIndex >= 0 ? dateIndex : 0]);
      const close = number(row?.[closeIndex >= 0 ? closeIndex : 6]);
      if (!date || close === null) return null;
      return {
        asOf: date,
        open: number(row?.[openIndex >= 0 ? openIndex : 3]),
        high: number(row?.[highIndex >= 0 ? highIndex : 4]),
        low: number(row?.[lowIndex >= 0 ? lowIndex : 5]),
        close,
        volume: number(row?.[volumeIndex >= 0 ? volumeIndex : 1])
      };
    }).filter(Boolean).sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
    if (!bars.length) throw providerError("HISTORY_UNAVAILABLE", `TWSE daily history unavailable for ${request.symbol}.`);
    const asOf = bars.at(-1).asOf;
    return {
      contract: "zhuge-investment-history-v1",
      symbol: request.symbol,
      market: request.market,
      currency: "TWD",
      provider,
      source: "TWSE Daily Trading Open Data",
      sourceUrl,
      asOf,
      freshness: freshnessLabel(asOf, nowMs, 7 * 24 * 60 * 60 * 1000),
      stale: freshnessLabel(asOf, nowMs, 7 * 24 * 60 * 60 * 1000) === "stale",
      available: true,
      bars
    };
  }

  function parseYahooHistory(request, payload, provider, sourceUrl, nowMs) {
    const result = payload?.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const quote = result?.indicators?.quote?.[0] || {};
    const bars = timestamps.map((timestamp, index) => {
      const close = number(quote.close?.[index]);
      if (close === null) return null;
      return {
        asOf: new Date(Number(timestamp) * 1000).toISOString(),
        open: number(quote.open?.[index]),
        high: number(quote.high?.[index]),
        low: number(quote.low?.[index]),
        close,
        volume: number(quote.volume?.[index])
      };
    }).filter(Boolean);
    if (!bars.length) throw providerError("HISTORY_UNAVAILABLE", `Yahoo history unavailable for ${request.symbol}.`);
    const meta = result?.meta || {};
    const asOf = bars.at(-1).asOf;
    return {
      contract: "zhuge-investment-history-v1",
      symbol: request.symbol,
      market: request.market,
      currency: text(meta.currency) || (request.market === "TW" ? "TWD" : "USD"),
      provider,
      source: "Yahoo Finance Chart Compatibility Provider",
      sourceUrl,
      asOf,
      freshness: freshnessLabel(asOf, nowMs, 7 * 24 * 60 * 60 * 1000),
      stale: freshnessLabel(asOf, nowMs, 7 * 24 * 60 * 60 * 1000) === "stale",
      available: true,
      bars
    };
  }

  function technicalEvidence(history, nowMs) {
    if (!history?.available || !Array.isArray(history.bars) || history.bars.length < 20) return null;
    const closes = history.bars.map(item => number(item.close)).filter(value => value !== null);
    if (closes.length < 20) return null;
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const facts = [`bars=${closes.length}`, `last_close=${closes.at(-1)}`, `sma20=${average(closes.slice(-20)).toFixed(4)}`];
    if (closes.length >= 50) facts.push(`sma50=${average(closes.slice(-50)).toFixed(4)}`);
    if (closes.length >= 15) {
      const changes = closes.slice(-15).slice(1).map((value, index) => value - closes.slice(-15)[index]);
      const gains = changes.filter(value => value > 0);
      const losses = changes.filter(value => value < 0).map(value => Math.abs(value));
      const averageGain = gains.reduce((sum, value) => sum + value, 0) / 14;
      const averageLoss = losses.reduce((sum, value) => sum + value, 0) / 14;
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
      stale: history.stale,
      facts,
      limitations: ["本 Evidence 只提供可驗證的技術觀察，不產生買賣建議。", ...(history.stale ? ["歷史序列最新資料已超過 freshness window。"] : [])]
    };
  }

  function twseIndustryEvidence(request, payload, provider, sourceUrl) {
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const row = rows.find(item => text(item?.公司代號 || item?.Code) === request.symbol);
    const industry = text(row?.產業別 || row?.Industry);
    if (!row || !industry) throw providerError("RELATIONSHIP_UNAVAILABLE", `TWSE industry unavailable for ${request.symbol}.`);
    return {
      type: "industry",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} 台灣產業分類`,
      summary: `公司 ${text(row?.公司名稱 || row?.Name) || request.symbol} 的官方產業分類為 ${industry}。`,
      source: "TWSE Company Basic Open Data",
      sourceUrl,
      observedAt: "",
      quality: "official_open_data",
      facts: [`industry=${industry}`, `company=${text(row?.公司名稱 || row?.Name) || request.symbol}`],
      limitations: ["官方產業分類不是 ETF 成分或投資建議。"]
    };
  }

  function secLatestFact(facts, names) {
    for (const name of names) {
      const entry = facts?.["us-gaap"]?.[name] || facts?.["dei"]?.[name];
      const units = entry?.units && typeof entry.units === "object" ? entry.units : {};
      const rows = Object.values(units).flat().filter(item => number(item?.val) !== null).sort((a, b) => String(b?.end || b?.filed || "").localeCompare(String(a?.end || a?.filed || "")));
      if (rows.length) return { name, unit: Object.keys(units)[0], value: number(rows[0].val), end: text(rows[0].end || rows[0].filed) };
    }
    return null;
  }

  function secFundamentalEvidence(request, facts, provider, sourceUrl) {
    const factNamespaces = facts?.facts && typeof facts.facts === "object" ? facts.facts : facts;
    const selections = [
      ["revenue", ["Revenues", "SalesRevenueNet"]],
      ["assets", ["Assets"]],
      ["net_income", ["NetIncomeLoss"]],
      ["eps_diluted", ["EarningsPerShareDiluted"]]
    ].map(([label, names]) => [label, secLatestFact(factNamespaces, names)]).filter(([, value]) => value);
    if (!selections.length) throw providerError("FUNDAMENTAL_UNAVAILABLE", `SEC facts unavailable for ${request.symbol}.`);
    return {
      type: "fundamental",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} SEC Company Facts`,
      summary: `SEC Company Facts 提供 ${selections.length} 項可驗證的基本面欄位。`,
      source: "SEC EDGAR Company Facts",
      sourceUrl,
      observedAt: selections.map(([, value]) => value.end).filter(Boolean).sort().at(-1) || "",
      quality: "official_open_data",
      facts: selections.map(([label, value]) => `${label}=${value.value}${value.unit ? ` ${value.unit}` : ""}${value.end ? ` @${value.end}` : ""}`),
      limitations: ["SEC Company Facts 不直接提供完整估值、ETF 成分或投資建議。"]
    };
  }

  function secIndustryEvidence(request, payload, provider, sourceUrl) {
    const industry = text(payload?.sicDescription);
    if (!industry) throw providerError("RELATIONSHIP_UNAVAILABLE", `SEC industry unavailable for ${request.symbol}.`);
    return {
      type: "industry",
      symbol: request.symbol,
      market: request.market,
      title: `${request.symbol} SEC industry classification`,
      summary: `SEC submissions 提供產業分類 ${industry}。`,
      source: "SEC EDGAR Submissions",
      sourceUrl,
      observedAt: "",
      quality: "official_open_data",
      facts: [`industry=${industry}`, `sic=${text(payload?.sic)}`],
      limitations: ["SEC SIC 分類不是 ETF 成分或投資建議。"]
    };
  }

  function asOfFromTwse(row) {
    const millis = number(row?.tlong);
    if (millis) return new Date(millis).toISOString();
    const date = text(row?.d);
    const time = text(row?.t || row?.ot);
    if (!date || !time) return "";
    const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time}+08:00`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  function decodeXml(value) {
    return text(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .trim();
  }

  function xmlTag(block, tag) {
    const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
    return decodeXml(block.match(expression)?.[1] || "");
  }

  function parseRss(xml, request, provider, now, limit = 8) {
    const items = [];
    const matches = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
    for (const block of matches.slice(0, limit)) {
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
        limitations: ["Provider RSS 摘要；尚未取得原文全文驗證。"]
      });
    }
    return items;
  }

  function create(options = {}) {
    const intelligence = options.intelligence || root?.InvestmentIntelligenceLayer;
    if (!intelligence) throw new TypeError("InvestmentIntelligenceProviders requires InvestmentIntelligenceLayer.");
    const analysis = options.analysis || root?.InvestmentAnalysisService;
    const strategyLibrary = options.strategyLibrary || root?.InvestmentStrategyLibrary;
    const fetchImpl = options.fetch || root?.fetch?.bind(root);
    const endpoints = Object.freeze({ ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) });
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const invokeFunction = options.invokeFunction;
    const edgeFunctionName = text(options.edgeFunctionName || "investment-intelligence-read");
    const secUserAgent = text(options.secUserAgent || "Zhuge AI OS Investment Intelligence/1.0 (contact: qq.1025@gmail.com)");
    const responseCache = new Map();
    let registered = false;

    async function request(fetchUrl, parser = "json") {
      if (typeof fetchImpl !== "function") throw providerError("FETCH_UNAVAILABLE", "Investment provider fetch is unavailable.");
      const cacheKey = `${parser}:${fetchUrl}`;
      if (responseCache.has(cacheKey)) return responseCache.get(cacheKey);
      const pending = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), Number(options.timeoutMs || 12000)) : null;
      try {
        const headers = { Accept: parser === "text" ? "application/rss+xml,text/xml,text/plain" : "application/json" };
        if (/https:\/\/(?:www\.)?(?:sec\.gov|data\.sec\.gov)\//i.test(fetchUrl)) headers["User-Agent"] = secUserAgent;
        const response = await fetchImpl(fetchUrl, {
          method: "GET",
          headers,
          signal: controller?.signal
        });
        if (!response || response.ok === false) {
          throw providerError("HTTP_${STATUS}".replace("${STATUS}", String(response?.status || "ERROR")), `Provider returned HTTP ${response?.status || "error"}.`, { status: response?.status || 0 });
        }
        return parser === "text" ? response.text() : response.json();
      } catch (error) {
        if (error?.name === "AbortError") throw providerError("TIMEOUT", "Provider request timed out.");
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      })();
      responseCache.set(cacheKey, pending);
      try {
        return await pending;
      } catch (error) {
        responseCache.delete(cacheKey);
        throw error;
      }
    }

    function quoteFromYahoo(request, payload, provider, sourceUrl) {
      const result = payload?.chart?.result?.[0];
      const meta = result?.meta || {};
      const chartClose = result?.indicators?.quote?.[0]?.close || [];
      const fallbackPrice = chartClose.slice().reverse().find(item => number(item) !== null);
      const price = number(meta.regularMarketPrice ?? fallbackPrice);
      if (price === null) throw providerError("QUOTE_UNAVAILABLE", `Yahoo quote unavailable for ${request.symbol}.`);
      const regularMarketTime = number(meta.regularMarketTime);
      return {
        symbol: request.symbol,
        market: request.market,
        currency: text(meta.currency) || (request.market === "TW" ? "TWD" : "USD"),
        price,
        provider,
        source: "Yahoo Finance Chart",
        sourceUrl,
        asOf: regularMarketTime ? new Date(regularMarketTime * 1000).toISOString() : "",
        available: true
      };
    }

    function quoteFromTwse(request, payload, provider, sourceUrl) {
      const row = (Array.isArray(payload?.msgArray) ? payload.msgArray : []).find(item => text(item?.c) === request.symbol);
      const price = number(row?.z) ?? number(row?.pz) ?? number(row?.o);
      if (!row || price === null) throw providerError("QUOTE_UNAVAILABLE", `TWSE quote unavailable for ${request.symbol}.`);
      return {
        symbol: request.symbol,
        market: "TW",
        currency: "TWD",
        price,
        provider,
        source: "TWSE Open Market Quote",
        sourceUrl,
        asOf: asOfFromTwse(row),
        available: true
      };
    }

    function fxFromExchangeRate(payload, provider, sourceUrl) {
      const rate = number(payload?.rates?.TWD);
      if (rate === null) throw providerError("FX_UNAVAILABLE", "USD/TWD rate unavailable.");
      const date = text(payload?.time_last_update_utc);
      return {
        base: "USD",
        quote: "TWD",
        rate,
        provider,
        source: "ExchangeRate-API Open Rates",
        sourceUrl,
        asOf: date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : "",
        available: true
      };
    }

    function fxFromFrankfurter(payload, provider, sourceUrl) {
      const rate = number(payload?.rates?.TWD);
      if (rate === null) throw providerError("FX_UNAVAILABLE", "Frankfurter USD/TWD rate unavailable.");
      const date = text(payload?.date);
      return {
        base: "USD",
        quote: "TWD",
        rate,
        provider,
        source: "Frankfurter ECB Rates",
        sourceUrl,
        asOf: date ? `${date}T00:00:00.000Z` : "",
        available: true
      };
    }

    function register() {
      if (registered) return;
      intelligence.registerProvider({
        id: "twse-open",
        kind: "market",
        priority: 10,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = `${endpoints.twseQuote}?ex_ch=${encodeURIComponent(twseSymbol(requestValue))}&json=1&delay=0`;
          return quoteFromTwse(requestValue, await request(url), "twse-open", url);
        }
      });
      intelligence.registerProvider({
        id: "yahoo-chart",
        kind: "market",
        priority: 20,
        markets: ["US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = `${endpoints.yahooChart}/${encodeURIComponent(yahooSymbol(requestValue))}?range=1d&interval=1m&includePrePost=false`;
          return quoteFromYahoo(requestValue, await request(url), "yahoo-chart", url);
        }
      });
      intelligence.registerProvider({
        id: "twse-daily-history",
        kind: "market_history",
        priority: 10,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const responses = [];
          for (const month of monthStarts(now(), 6)) {
            const url = `${endpoints.twseDaily}?date=${month}&stockNo=${encodeURIComponent(requestValue.symbol)}&response=json`;
            try {
              responses.push({ payload: await request(url), url });
            } catch {
              // Keep the month-level failure in fallback evidence; retain other official bars.
            }
          }
          const bars = responses.flatMap(({ payload, url }) => {
            try {
              return parseTwseDailyPayload(requestValue, payload, "twse-daily-history", url, now()).bars;
            } catch {
              return [];
            }
          });
          if (!bars.length) throw providerError("HISTORY_UNAVAILABLE", `TWSE daily history unavailable for ${requestValue.symbol}.`);
          const uniqueBars = Array.from(new Map(bars.map(item => [item.asOf, item])).values()).sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
          const asOf = uniqueBars.at(-1).asOf;
          return {
            contract: "zhuge-investment-history-v1",
            symbol: requestValue.symbol,
            market: requestValue.market,
            currency: "TWD",
            provider: "twse-daily-history",
            source: "TWSE Daily Trading Open Data",
            sourceUrl: endpoints.twseDaily,
            asOf,
            freshness: freshnessLabel(asOf, now(), 7 * 24 * 60 * 60 * 1000),
            stale: freshnessLabel(asOf, now(), 7 * 24 * 60 * 60 * 1000) === "stale",
            available: true,
            bars: uniqueBars
          };
        }
      });
      intelligence.registerProvider({
        id: "yahoo-history",
        kind: "market_history",
        priority: 20,
        markets: ["TW", "US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = `${endpoints.yahooHistory}/${encodeURIComponent(yahooSymbol(requestValue))}?range=1y&interval=1d&includePrePost=false`;
          return parseYahooHistory(requestValue, await request(url), "yahoo-history", url, now());
        }
      });
      intelligence.registerProvider({
        id: "twse-financial",
        kind: "fundamental",
        priority: 10,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const payload = await request(endpoints.twseFinancial);
          const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
          const row = rows.find(item => text(item?.公司代號 || item?.Code) === requestValue.symbol);
          if (!row) throw providerError("FUNDAMENTAL_UNAVAILABLE", `TWSE financial data unavailable for ${requestValue.symbol}.`);
          const facts = Object.entries(row)
            .filter(([key, value]) => /營業收入|營業利益|本期淨利|每股盈餘|revenue|income|eps/i.test(key) && text(value))
            .slice(0, 8)
            .map(([key, value]) => `${key}=${text(value)}`);
          if (!facts.length) throw providerError("FUNDAMENTAL_UNAVAILABLE", `TWSE financial facts unavailable for ${requestValue.symbol}.`);
          return {
            type: "fundamental",
            symbol: requestValue.symbol,
            market: requestValue.market,
            title: `${requestValue.symbol} TWSE 公開財報資料`,
            summary: `TWSE 官方公開資料提供 ${facts.length} 項財報欄位。`,
            source: "TWSE Financial Open Data",
            sourceUrl: endpoints.twseFinancial,
            observedAt: text(row?.出表日期),
            quality: "official_open_data",
            facts,
            limitations: ["TWSE 公開財報資料不直接提供完整估值或投資建議。"]
          };
        }
      });
      intelligence.registerProvider({
        id: "sec-company-facts",
        kind: "fundamental",
        priority: 10,
        markets: ["US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const tickerPayload = await request(endpoints.secTickers);
          const tickerRows = Object.values(tickerPayload || {});
          const ticker = tickerRows.find(item => text(item?.ticker).toUpperCase() === requestValue.symbol);
          const cik = text(ticker?.cik_str).padStart(10, "0");
          if (!cik) throw providerError("FUNDAMENTAL_UNAVAILABLE", `SEC CIK unavailable for ${requestValue.symbol}.`);
          const url = `${endpoints.secFacts}/CIK${cik}.json`;
          return secFundamentalEvidence(requestValue, await request(url), "sec-company-facts", url);
        }
      });
      intelligence.registerProvider({
        id: "twse-company-industry",
        kind: "relationship",
        priority: 10,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = endpoints.twseCompany;
          return twseIndustryEvidence(requestValue, await request(url), "twse-company-industry", url);
        }
      });
      intelligence.registerProvider({
        id: "sec-company-industry",
        kind: "relationship",
        priority: 10,
        markets: ["US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const tickerPayload = await request(endpoints.secTickers);
          const tickerRows = Object.values(tickerPayload || {});
          const ticker = tickerRows.find(item => text(item?.ticker).toUpperCase() === requestValue.symbol);
          const cik = text(ticker?.cik_str).padStart(10, "0");
          if (!cik) throw providerError("RELATIONSHIP_UNAVAILABLE", `SEC CIK unavailable for ${requestValue.symbol}.`);
          const url = `${endpoints.secSubmissions}/CIK${cik}.json`;
          return secIndustryEvidence(requestValue, await request(url), "sec-company-industry", url);
        }
      });
      intelligence.registerProvider({
        id: "twse-market-phase",
        kind: "market_phase",
        priority: 10,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const payload = await request(endpoints.twseHoliday);
          const local = new Date(now() + 8 * 60 * 60 * 1000);
          const weekday = local.getUTCDay();
          const dateKey = `${local.getUTCFullYear() - 1911}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
          const holidayRows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
          const holiday = holidayRows.find(row => text(row?.Date || row?.日期).replace(/\D/g, "") === dateKey);
          const description = text(holiday?.Description || holiday?.說明);
          const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
          const phase = weekday === 0 || weekday === 6 || /無交易|休市|holiday|closed/i.test(description)
            ? "CLOSED"
            : minutes >= 8 * 60 + 30 && minutes < 9 * 60 ? "PRE_OPEN"
              : minutes >= 9 * 60 && minutes < 13 * 60 + 30 ? "OPEN"
                : minutes >= 13 * 60 + 30 && minutes < 14 * 60 ? "POST_CLOSE"
                  : "CLOSED";
          return {
            market: "TW",
            phase,
            source: "TWSE Holiday Schedule + published session hours",
            sourceUrl: endpoints.twseHoliday,
            asOf: new Date(now()).toISOString(),
            available: true,
            evidence: [{
              type: "market_phase",
              symbol: requestValue.symbol,
              market: "TW",
              title: `${requestValue.symbol} 台股市場階段`,
              summary: `TWSE 交易時段判定為 ${phase}。`,
              source: "TWSE Holiday Schedule + published session hours",
              sourceUrl: endpoints.twseHoliday,
              observedAt: new Date(now()).toISOString(),
              quality: "official_open_data",
              facts: [`phase=${phase}`, `holiday=${description || "none"}`],
              limitations: ["市場階段依公開交易日曆與固定交易時段判定，不代表個別標的可成交。"]
            }]
          };
        }
      });
      intelligence.registerProvider({
        id: "open-er-api",
        kind: "fx",
        priority: 10,
        markets: ["*"],
        fetch: async () => fxFromExchangeRate(await request(endpoints.exchangeRate), "open-er-api", endpoints.exchangeRate)
      });
      intelligence.registerProvider({
        id: "frankfurter",
        kind: "fx",
        priority: 20,
        markets: ["*"],
        fetch: async () => fxFromFrankfurter(await request(endpoints.frankfurter), "frankfurter", endpoints.frankfurter)
      });
      intelligence.registerProvider({
        id: "google-news-rss",
        kind: "news",
        priority: 10,
        markets: ["TW", "US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const query = requestValue.query || `${requestValue.symbol}${requestValue.market === "TW" ? " 台股" : ""}`;
          const url = `${endpoints.googleNews}?q=${encodeURIComponent(query)}&hl=${requestValue.market === "TW" ? "zh-TW" : "en-US"}&gl=${requestValue.market === "TW" ? "TW" : "US"}&ceid=${requestValue.market === "TW" ? "TW:zh-Hant" : "US:en"}`;
          return parseRss(await request(url, "text"), requestValue, "Google News RSS", now(), 8);
        }
      });
      intelligence.registerProvider({
        id: "bing-news-rss",
        kind: "news",
        priority: 20,
        markets: ["TW", "US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const query = requestValue.query || `${requestValue.symbol}${requestValue.market === "TW" ? " 台股" : ""}`;
          const url = `${endpoints.bingNews}?q=${encodeURIComponent(query)}&format=rss`;
          return parseRss(await request(url, "text"), requestValue, "Bing News RSS", now(), 8);
        }
      });
      registered = true;
    }

    function normalizeQuoteResult(requestValue, result) {
      return result.ok
        ? intelligence.normalizeQuote({ ...result.value, provider: result.provider, attempts: result.attempts }, now())
        : intelligence.normalizeQuote({ symbol: requestValue.symbol, market: requestValue.market, available: false, error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts }, now());
    }

    async function loadQuotes(symbols = []) {
      register();
      const requests = uniqueRequests(symbols);
      return Object.freeze(await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("market", requestValue);
        return normalizeQuoteResult(requestValue, result);
      })));
    }

    async function loadFx() {
      register();
      const result = await intelligence.fetchWithFallback("fx", { market: "*" });
      return result.ok
        ? intelligence.normalizeFx({ ...result.value, provider: result.provider, attempts: result.attempts }, now())
        : intelligence.normalizeFx({ available: false, error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts }, now());
    }

    async function loadNews(symbols = [], limit = 3) {
      register();
      const requests = uniqueRequests(symbols).slice(0, limit);
      const results = await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("news", requestValue);
        return result.ok ? result.value.map(item => intelligence.normalizeEvidence(item)) : [];
      }));
      const seen = new Set();
      return Object.freeze(results.flat().filter(item => {
        const key = `${item.sourceUrl}|${item.title}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    }

    async function loadHistories(symbols = []) {
      register();
      const requests = uniqueRequests(symbols);
      return Object.freeze(await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("market_history", requestValue);
        if (result.ok) return Object.freeze({ ...result.value, provider: result.provider, attempts: result.attempts });
        return Object.freeze({
          contract: "zhuge-investment-history-v1",
          symbol: requestValue.symbol,
          market: requestValue.market,
          provider: "",
          source: "",
          sourceUrl: "",
          asOf: "",
          freshness: "unavailable",
          stale: false,
          available: false,
          bars: [],
          error: result.attempts.at(-1)?.reason || "UNAVAILABLE",
          attempts: result.attempts
        });
      })));
    }

    async function loadFundamentals(symbols = []) {
      register();
      const requests = uniqueRequests(symbols);
      return Object.freeze(await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("fundamental", requestValue);
        return Object.freeze({
          symbol: requestValue.symbol,
          market: requestValue.market,
          provider: result.provider,
          available: result.ok,
          evidence: result.ok ? Object.freeze([result.value]) : Object.freeze([]),
          error: result.ok ? null : (result.attempts.at(-1)?.reason || "UNAVAILABLE"),
          attempts: result.attempts
        });
      })));
    }

    async function loadRelationships(symbols = []) {
      register();
      const requests = uniqueRequests(symbols);
      return Object.freeze(await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("relationship", requestValue);
        return Object.freeze({
          symbol: requestValue.symbol,
          market: requestValue.market,
          provider: result.provider,
          available: result.ok,
          evidence: result.ok ? Object.freeze([result.value]) : Object.freeze([]),
          error: result.ok ? null : (result.attempts.at(-1)?.reason || "UNAVAILABLE"),
          attempts: result.attempts
        });
      })));
    }

    async function loadMarketPhases(symbols = []) {
      register();
      const requests = uniqueRequests(symbols).filter(item => item.market === "TW");
      const results = await Promise.all(requests.map(async requestValue => {
        const result = await intelligence.fetchWithFallback("market_phase", requestValue);
        return result.ok
          ? Object.freeze({ ...result.value, provider: result.provider, attempts: result.attempts })
          : Object.freeze({ market: requestValue.market, phase: "UNKNOWN", available: false, provider: "", source: "", sourceUrl: "", evidence: [], error: result.attempts.at(-1)?.reason || "UNAVAILABLE", attempts: result.attempts });
      }));
      const byMarket = new Map();
      for (const item of results) if (!byMarket.has(item.market)) byMarket.set(item.market, item);
      return Object.freeze(Object.fromEntries(byMarket.entries()));
    }

    function quoteEvidence(quote) {
      if (!quote?.available) return null;
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
        facts: [`price=${quote.price}`, `currency=${quote.currency}`, `provider=${quote.provider}`],
        limitations: quote.stale ? ["行情已超過 freshness window，僅作最新可用資料。"] : []
      };
    }

    function fxEvidence(fx) {
      if (!fx?.available) return null;
      return {
        type: "fx_benchmark",
        title: "USD/TWD 基準匯率",
        summary: `1 USD ≈ ${fx.rate} TWD；來源 ${fx.source}；時間 ${fx.asOf || "未知"}。`,
        source: fx.source,
        sourceUrl: fx.sourceUrl,
        observedAt: fx.asOf,
        quality: fx.freshness === "fresh" ? "fresh" : "stale",
        freshness: fx.freshness,
        facts: [`rate=${fx.rate}`, "base=USD", "quote=TWD"],
        limitations: fx.stale ? ["匯率已超過 freshness window，僅作閱讀換算。"] : []
      };
    }

    function phaseEvidence(phase) {
      return phase?.available && Array.isArray(phase.evidence) ? phase.evidence[0] || null : null;
    }

    function normalizeEdgeContext(item = {}) {
      return intelligence.buildContextPack({
        symbol: item.symbol,
        market: item.market,
        generatedAt: item.generatedAt,
        portfolioContext: item.portfolioContext,
        marketPhase: item.marketPhase,
        decisionZones: item.decisionZones,
        dataQuality: item.dataQuality,
        evidence: item.evidence,
        missing: item.missing,
        strategyIds: item.strategyIds,
        strategyEvidence: item.strategyEvidence
      });
    }

    function enrichContexts(contexts) {
      if (!analysis?.enrichContextPack) return Object.freeze(contexts);
      return Object.freeze(contexts.map(context => analysis.enrichContextPack(context, { strategyLibrary })));
    }

    function edgeRequest(input = {}) {
      const requests = uniqueRequests(input.symbols || input.positions || ["2330", "0050", "AAPL"]);
      return {
        symbols: requests.map(item => ({
          symbol: item.symbol,
          market: item.market,
          name: item.name,
          query: item.query
        })),
        news_limit: Math.min(5, Math.max(1, Number(input.newsLimit || 3))),
        portfolio_context: input.portfolioContext && typeof input.portfolioContext === "object"
          ? { current_position_count: Number(input.portfolioContext.currentPositionCount || 0) }
          : {},
        strategy_ids: Array.isArray(input.strategyIds) ? input.strategyIds.map(String).slice(0, 20) : []
      };
    }

    async function loadViaEdge(input = {}) {
      if (typeof invokeFunction !== "function") {
        throw providerError("EDGE_ADAPTER_UNAVAILABLE", "Investment Edge adapter is not configured.");
      }
      const response = await invokeFunction(edgeFunctionName, edgeRequest(input));
      if (!response || typeof response !== "object" || response.contract !== "zhuge-investment-intelligence-edge-v1") {
        throw providerError("INVALID_EDGE_RESPONSE", "Investment Edge adapter returned an invalid contract.");
      }
      if (response.read_only !== true) {
        throw providerError("EDGE_READ_ONLY_CONTRACT_INVALID", "Investment Edge adapter did not prove read-only behavior.");
      }
      const generatedAt = text(response.generated_at) || new Date(now()).toISOString();
      const quotes = Object.freeze((Array.isArray(response.quotes) ? response.quotes : []).map(item => intelligence.normalizeQuote(item, now())));
      const fx = intelligence.normalizeFx(response.fx || { available: false }, now());
      const news = Object.freeze((Array.isArray(response.news) ? response.news : []).map(item => intelligence.normalizeEvidence(item)));
      const histories = Object.freeze(Array.isArray(response.histories) ? response.histories : []);
      const fundamentals = Object.freeze(Array.isArray(response.fundamentals) ? response.fundamentals : []);
      const relationships = Object.freeze(Array.isArray(response.relationships) ? response.relationships : []);
      const marketPhase = Object.freeze(response.market_phase && typeof response.market_phase === "object" ? { ...response.market_phase } : {});
      const contexts = enrichContexts((Array.isArray(response.contexts) ? response.contexts : []).map(normalizeEdgeContext));
      const analyses = Object.freeze(contexts.map(item => item.analysis).filter(Boolean));
      return Object.freeze({
        contract: "zhuge-investment-intelligence-runtime-v1",
        generatedAt,
        quotes,
        fx,
        news,
        histories,
        fundamentals,
        relationships,
        marketPhase,
        contexts,
        analyses,
        quality: Object.freeze(response.quality && typeof response.quality === "object" ? { ...response.quality } : {}),
        providerTrace: Object.freeze(response.provider_trace && typeof response.provider_trace === "object" ? { ...response.provider_trace } : {})
      });
    }

    async function loadDirect(input = {}) {
      responseCache.clear();
      const requests = uniqueRequests(input.symbols || input.positions || ["2330", "0050", "AAPL"]);
      const [quotes, fx, news, histories, fundamentals, relationships, marketPhases] = await Promise.all([
        loadQuotes(requests),
        loadFx(),
        loadNews(requests, Number(input.newsLimit || 3)),
        loadHistories(requests),
        loadFundamentals(requests),
        loadRelationships(requests),
        loadMarketPhases(requests)
      ]);
      const contexts = enrichContexts(requests.map(requestValue => {
        const quote = quotes.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market);
        const history = histories.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market);
        const fundamental = fundamentals.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market);
        const relationship = relationships.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market);
        const phase = marketPhases[requestValue.market] || {};
        const evidence = [
          quoteEvidence(quote),
          fxEvidence(requestValue.market === "US" ? fx : null),
          phaseEvidence(phase),
          technicalEvidence(history, now()),
          ...(fundamental?.evidence || []),
          ...(relationship?.evidence || []),
          ...news.filter(item => !item.symbol || item.symbol === requestValue.symbol)
        ].filter(Boolean);
        const missing = [];
        if (!quote?.available) missing.push("latest_quote");
        if (requestValue.market === "US" && !fx?.available) missing.push("usd_twd_benchmark");
        if (!news.some(item => item.symbol === requestValue.symbol)) missing.push("news_search");
        if (!technicalEvidence(history, now())) missing.push("historical_ohlc_or_indicators");
        if (!fundamental?.available) missing.push("fundamental_evidence");
        if (!relationship?.available) missing.push("relationship_evidence");
        if (!phase?.available) missing.push("market_phase");
        return intelligence.buildContextPack({
          symbol: requestValue.symbol,
          market: requestValue.market,
          generatedAt: new Date(now()).toISOString(),
          portfolioContext: input.portfolioContext || {},
          marketPhase: phase,
          dataQuality: {
            quote: quote?.freshness || "unavailable",
            fx: requestValue.market === "US" ? (fx?.freshness || "unavailable") : "not_applicable",
            news: news.some(item => item.symbol === requestValue.symbol) ? "provider" : "unavailable",
            technical: technicalEvidence(history, now())?.freshness || "unavailable",
            fundamental: fundamental?.available ? "official_open_data" : "unavailable",
            relationship: relationship?.available ? "official_open_data" : "unavailable",
            marketPhase: phase?.available ? "official_open_data" : "unavailable"
          },
          evidence,
          missing,
          strategyIds: input.strategyIds || []
        });
      }));
      const analyses = Object.freeze(contexts.map(item => item.analysis).filter(Boolean));
      return Object.freeze({
        contract: "zhuge-investment-intelligence-runtime-v1",
        generatedAt: new Date(now()).toISOString(),
        quotes,
        fx,
        news,
        histories,
        fundamentals,
        relationships,
        marketPhase: marketPhases,
        contexts,
        analyses,
        quality: Object.freeze({
          market: Object.freeze({ total: quotes.length, available: quotes.filter(item => item.available).length, stale: quotes.filter(item => item.stale).length }),
          fx: Object.freeze({ available: Boolean(fx?.available), freshness: fx?.freshness || "unavailable" }),
          news: Object.freeze({ count: news.length, available: news.length > 0 }),
          technical: Object.freeze({ available: histories.some(item => technicalEvidence(item, now())) }),
          fundamental: Object.freeze({ available: fundamentals.some(item => item.available) }),
          relationship: Object.freeze({ available: relationships.some(item => item.available) }),
          marketPhase: Object.freeze({ available: Object.values(marketPhases).some(item => item.available) })
        })
      });
    }

    async function load(input = {}) {
      return typeof invokeFunction === "function" ? loadViaEdge(input) : loadDirect(input);
    }

    return Object.freeze({ register, loadQuotes, loadFx, loadNews, loadHistories, loadFundamentals, loadRelationships, loadMarketPhases, loadDirect, loadViaEdge, load });
  }

  return Object.freeze({ DEFAULT_ENDPOINTS, create });
});
