(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentIntelligenceProviders = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const DEFAULT_ENDPOINTS = Object.freeze({
    yahooChart: "https://query2.finance.yahoo.com/v8/finance/chart",
    twseQuote: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
    exchangeRate: "https://open.er-api.com/v6/latest/USD",
    frankfurter: "https://api.frankfurter.app/latest?from=USD&to=TWD",
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
    const parsed = Number(value);
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
    const fetchImpl = options.fetch || root?.fetch?.bind(root);
    const endpoints = Object.freeze({ ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) });
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const invokeFunction = options.invokeFunction;
    const edgeFunctionName = text(options.edgeFunctionName || "investment-intelligence-read");
    let registered = false;

    async function request(fetchUrl, parser = "json") {
      if (typeof fetchImpl !== "function") throw providerError("FETCH_UNAVAILABLE", "Investment provider fetch is unavailable.");
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), Number(options.timeoutMs || 12000)) : null;
      try {
        const response = await fetchImpl(fetchUrl, {
          method: "GET",
          headers: { Accept: parser === "text" ? "application/rss+xml,text/xml,text/plain" : "application/json" },
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
        id: "yahoo-chart",
        kind: "market",
        priority: 10,
        markets: ["TW", "US"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = `${endpoints.yahooChart}/${encodeURIComponent(yahooSymbol(requestValue))}?range=1d&interval=1m&includePrePost=false`;
          return quoteFromYahoo(requestValue, await request(url), "yahoo-chart", url);
        }
      });
      intelligence.registerProvider({
        id: "twse-open",
        kind: "market",
        priority: 20,
        markets: ["TW"],
        fetch: async requestInput => {
          const requestValue = normalizeRequest(requestInput);
          const url = `${endpoints.twseQuote}?ex_ch=${encodeURIComponent(twseSymbol(requestValue))}&json=1&delay=0`;
          return quoteFromTwse(requestValue, await request(url), "twse-open", url);
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

    function normalizeEdgeContext(item = {}) {
      return intelligence.buildContextPack({
        symbol: item.symbol,
        market: item.market,
        generatedAt: item.generatedAt,
        portfolioContext: item.portfolioContext,
        marketPhase: item.marketPhase,
        dataQuality: item.dataQuality,
        evidence: item.evidence,
        missing: item.missing,
        strategyIds: item.strategyIds
      });
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
      const contexts = Object.freeze((Array.isArray(response.contexts) ? response.contexts : []).map(normalizeEdgeContext));
      return Object.freeze({
        contract: "zhuge-investment-intelligence-runtime-v1",
        generatedAt,
        quotes,
        fx,
        news,
        contexts,
        quality: Object.freeze(response.quality && typeof response.quality === "object" ? { ...response.quality } : {}),
        providerTrace: Object.freeze(response.provider_trace && typeof response.provider_trace === "object" ? { ...response.provider_trace } : {})
      });
    }

    async function loadDirect(input = {}) {
      const requests = uniqueRequests(input.symbols || input.positions || ["2330", "0050", "AAPL"]);
      const [quotes, fx, news] = await Promise.all([
        loadQuotes(requests),
        loadFx(),
        loadNews(requests, Number(input.newsLimit || 3))
      ]);
      const contexts = Object.freeze(requests.map(requestValue => {
        const quote = quotes.find(item => item.symbol === requestValue.symbol && item.market === requestValue.market);
        const evidence = [quoteEvidence(quote), fxEvidence(requestValue.market === "US" ? fx : null), ...news.filter(item => !item.symbol || item.symbol === requestValue.symbol)].filter(Boolean);
        const missing = [];
        if (!quote?.available) missing.push("latest_quote");
        if (requestValue.market === "US" && !fx?.available) missing.push("usd_twd_benchmark");
        if (!news.some(item => item.symbol === requestValue.symbol)) missing.push("news_search");
        return intelligence.buildContextPack({
          symbol: requestValue.symbol,
          market: requestValue.market,
          generatedAt: new Date(now()).toISOString(),
          portfolioContext: input.portfolioContext || {},
          dataQuality: {
            quote: quote?.freshness || "unavailable",
            fx: requestValue.market === "US" ? (fx?.freshness || "unavailable") : "not_applicable",
            news: news.some(item => item.symbol === requestValue.symbol) ? "provider" : "unavailable"
          },
          evidence,
          missing,
          strategyIds: input.strategyIds || []
        });
      }));
      return Object.freeze({
        contract: "zhuge-investment-intelligence-runtime-v1",
        generatedAt: new Date(now()).toISOString(),
        quotes,
        fx,
        news,
        contexts,
        quality: Object.freeze({
          market: Object.freeze({ total: quotes.length, available: quotes.filter(item => item.available).length, stale: quotes.filter(item => item.stale).length }),
          fx: Object.freeze({ available: Boolean(fx?.available), freshness: fx?.freshness || "unavailable" }),
          news: Object.freeze({ count: news.length, available: news.length > 0 })
        })
      });
    }

    async function load(input = {}) {
      return typeof invokeFunction === "function" ? loadViaEdge(input) : loadDirect(input);
    }

    return Object.freeze({ register, loadQuotes, loadFx, loadNews, loadDirect, loadViaEdge, load });
  }

  return Object.freeze({ DEFAULT_ENDPOINTS, create });
});
