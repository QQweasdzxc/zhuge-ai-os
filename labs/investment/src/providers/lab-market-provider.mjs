import { calculateIndicators } from "../domain/indicators.mjs";
import { matchWatchlistEventCandidates } from "../watchlist/events.mjs";

const MARKETS = new Set(["TW", "US"]);

function text(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function unavailable(status, provider, note, errorCode = "DATA_UNAVAILABLE") {
  return Object.freeze({
    status,
    data: null,
    provider,
    source: [],
    dataTimestamp: null,
    fetchedAt: null,
    stale: null,
    delayed: false,
    fallback: false,
    note,
    errorCode,
  });
}

function canonicalRequest(input = {}) {
  const rawSymbol = text(input.symbol, 24).toUpperCase();
  const suffixVenue = rawSymbol.endsWith(".TWO") ? "TPEX" : rawSymbol.endsWith(".TW") ? "TWSE" : "";
  const symbol = rawSymbol.replace(/\.(TW|TWO)$/i, "");
  const market = text(input.market, 10).toUpperCase();
  if (!symbol || !MARKETS.has(market) || !/^(?:[A-Z0-9][A-Z0-9._-]{0,19}|\^[A-Z0-9._-]{1,19})$/.test(symbol)) {
    const error = new Error("市場或標的代碼格式無法辨識。");
    error.code = "SYMBOL_REQUEST_INVALID";
    throw error;
  }
  const venueValue = text(input.venue, 20).toUpperCase();
  return Object.freeze({
    symbol,
    market,
    venue: market === "TW" ? (venueValue === "TPEX" || suffixVenue === "TPEX" ? "TPEX" : venueValue === "TWSE" || suffixVenue === "TWSE" ? "TWSE" : "") : "US",
    name: text(input.name),
    query: text(input.query),
  });
}

function normalizeCatalogItem(item) {
  const market = text(item?.market, 10).toUpperCase();
  const symbol = text(item?.symbol, 24).toUpperCase();
  const venue = text(item?.venue, 20).toUpperCase();
  if (!MARKETS.has(market) || !symbol || (market === "TW" && !["TWSE", "TPEX"].includes(venue))) return null;
  return Object.freeze({
    symbol,
    name: text(item?.name) || symbol,
    market,
    venue,
    industry: text(item?.industry),
    source: text(item?.source),
  });
}

export function createLabMarketProvider({
  intelligenceProvider,
  invokeFunction,
  authorize = async () => true,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof intelligenceProvider?.load !== "function") throw new TypeError("Lab Market Provider requires the existing Zhuge Investment Intelligence Provider.");
  if (typeof invokeFunction !== "function") throw new TypeError("Lab Market Provider requires the authenticated Shared Data Gateway.");

  async function ensureAuthorized() {
    const result = await authorize();
    if (result !== true) {
      const error = new Error("Zhuge Investment read authorization is required.");
      error.code = typeof result === "string" ? result : "ACCESS_UNAVAILABLE";
      throw error;
    }
  }

  async function searchSymbols({ market, query } = {}) {
    await ensureAuthorized();
    const requestedMarket = text(market, 10).toUpperCase();
    const requestedQuery = text(query, 80);
    if (!MARKETS.has(requestedMarket) || requestedQuery.length < 1) {
      const error = new Error("請輸入台股或美股代碼／名稱。");
      error.code = "CATALOG_QUERY_INVALID";
      throw error;
    }
    const response = await invokeFunction("investment-intelligence-read", {
      catalog_query: { market: requestedMarket, query: requestedQuery },
    });
    if (response?.contract !== "zhuge-investment-intelligence-edge-v1" || response?.read_only !== true || !Array.isArray(response?.catalog_results)) {
      const error = new Error("Market catalog contract is unavailable or invalid.");
      error.code = "CATALOG_CONTRACT_INVALID";
      throw error;
    }
    const items = response.catalog_results.map(normalizeCatalogItem).filter(Boolean);
    return Object.freeze({
      status: items.length ? "AVAILABLE" : "EMPTY",
      market: requestedMarket,
      query: requestedQuery,
      source: response.catalog_source || null,
      dataTimestamp: response.catalog_data_timestamp || null,
      fetchedAt: text(response.generated_at) || now(),
      items: Object.freeze(items),
    });
  }

  async function resolveRequest(input) {
    const request = canonicalRequest(input);
    if (request.market !== "TW" || request.venue) return request;
    const catalog = await searchSymbols({ market: "TW", query: request.symbol });
    const matches = catalog.items.filter(item => item.symbol === request.symbol);
    if (matches.length !== 1) {
      const error = new Error(matches.length ? "同代碼有多個掛牌市場，請選擇交易所。" : "上市／上櫃市場尚未確認；請先從搜尋結果選擇掛牌市場。");
      error.code = matches.length ? "LISTING_AMBIGUOUS" : "LISTING_NOT_RESOLVED";
      error.matches = matches;
      throw error;
    }
    return Object.freeze({ ...request, venue: matches[0].venue, name: request.name || matches[0].name });
  }

  async function loadResearch(inputs, options = {}) {
    await ensureAuthorized();
    const values = Array.isArray(inputs) ? inputs : [inputs];
    const symbols = [];
    for (const item of values) symbols.push(await resolveRequest(item));
    const taiwanEvidence = options.includeTaiwanEvidence === true
      ? symbols
        .filter(item => item.market === "TW")
        .map(item => ({
          symbol: item.symbol,
          market: "TW",
          venue: item.venue,
          name: item.name,
          kinds: ["institutional", "ownership", "margin", "announcements", "brokerBranches"],
        }))
        .slice(0, 12)
      : [];
    const result = await intelligenceProvider.load({
      ...options,
      symbols,
      taiwanEvidence,
      newsLimit: Math.min(5, Math.max(1, Number(options.newsLimit || 3))),
    });
    if (result?.contract !== "zhuge-investment-intelligence-runtime-v1") {
      const error = new Error("Zhuge Investment Intelligence returned an unexpected contract.");
      error.code = "INTELLIGENCE_CONTRACT_INVALID";
      throw error;
    }
    return result;
  }

  async function getQuote(input) {
    const request = await resolveRequest(input);
    const result = await loadResearch([request]);
    return result.quotes.find(item => item.symbol === request.symbol && item.market === request.market) || unavailable("UNAVAILABLE", "Zhuge Investment Intelligence", "行情來源目前沒有回傳此標的。", "QUOTE_UNAVAILABLE");
  }

  async function getHistory(input) {
    const request = await resolveRequest(input);
    const result = await loadResearch([request]);
    const history = result.histories.find(item => item.symbol === request.symbol && item.market === request.market);
    return history || Object.freeze({ symbol: request.symbol, market: request.market, available: false, bars: [], provider: null, asOf: null, error: "HISTORY_UNAVAILABLE" });
  }

  async function getTechnical(input) {
    const request = await resolveRequest(input);
    const history = await getHistory(request);
    const bars = (Array.isArray(history.bars) ? history.bars : []).map(bar => ({
      ...bar,
      date: bar.date || bar.asOf || bar.as_of || bar.timestamp,
    }));
    return Object.freeze({
      status: history.available === true ? "AVAILABLE" : bars.length ? "PARTIAL" : "UNAVAILABLE",
      provider: history.provider || null,
      source: history.source || null,
      dataTimestamp: history.asOf || null,
      indicators: calculateIndicators(bars),
      bars: Object.freeze(bars),
      error: history.error || null,
    });
  }

  async function getProfile(input) {
    const request = await resolveRequest(input);
    const result = await loadResearch([request]);
    return result.fundamentals.find(item => item.symbol === request.symbol && item.market === request.market)
      || Object.freeze({ symbol: request.symbol, market: request.market, available: false, evidence: [], error: "PROFILE_UNAVAILABLE" });
  }

  async function loadTaiwanEvidence(input, kinds = ["institutional", "ownership", "margin", "announcements", "brokerBranches"]) {
    await ensureAuthorized();
    const request = await resolveRequest(input);
    if (request.market === "US") {
      const notApplicable = Object.fromEntries(kinds.map(kind => [kind, unavailable("NOT_APPLICABLE", "Zhuge Investment Provider", `${kind} 是台灣市場專用資料，不適用美股。`, "NOT_APPLICABLE")]));
      return Object.freeze({ symbol: request.symbol, market: "US", venue: "US", evidence: Object.freeze(notApplicable) });
    }
    const result = await intelligenceProvider.load({
      symbols: [],
      taiwanEvidence: [{
        symbol: request.symbol,
        market: "TW",
        venue: request.venue,
        name: request.name,
        kinds,
      }],
    });
    const item = result.taiwanEvidence.find(value => value.symbol === request.symbol && value.venue === request.venue);
    if (!item || !item.evidence || typeof item.evidence !== "object") {
      const fallback = Object.fromEntries(kinds.map(kind => [kind, unavailable("UNAVAILABLE", "Zhuge Official Taiwan Provider", "官方台灣資料回應不可用；未以其他數字替代。", "TAIWAN_EVIDENCE_UNAVAILABLE")]));
      return Object.freeze({ symbol: request.symbol, market: "TW", venue: request.venue, evidence: Object.freeze(fallback) });
    }
    return Object.freeze({ ...item, evidence: Object.freeze({ ...item.evidence }) });
  }

  async function getInstitutional(input) {
    return (await loadTaiwanEvidence(input, ["institutional"])).evidence.institutional;
  }

  async function getOwnership(input) {
    return (await loadTaiwanEvidence(input, ["ownership"])).evidence.ownership;
  }

  async function getMargin(input) {
    return (await loadTaiwanEvidence(input, ["margin"])).evidence.margin;
  }

  async function getAnnouncements(input) {
    return (await loadTaiwanEvidence(input, ["announcements"])).evidence.announcements;
  }

  async function getTaiwanMarketOverview() {
    await ensureAuthorized();
    const result = await intelligenceProvider.load({ symbols: [], taiwanMarketOverview: true });
    return result.taiwanMarketOverview || Object.freeze({
      index: unavailable("UNAVAILABLE", "TWSE", "台灣市場統計讀取失敗。", "TAIWAN_MARKET_UNAVAILABLE"),
      breadth: unavailable("UNAVAILABLE", "TWSE / TPEx", "市場廣度讀取失敗。", "TAIWAN_MARKET_UNAVAILABLE"),
      institutions: unavailable("UNAVAILABLE", "TWSE", "法人市場資料讀取失敗。", "TAIWAN_MARKET_UNAVAILABLE"),
      tpexInstitutions: unavailable("UNAVAILABLE", "TPEx", "上櫃法人市場資料讀取失敗。", "TAIWAN_MARKET_UNAVAILABLE"),
      margin: unavailable("UNAVAILABLE", "TWSE / TPEx", "上市櫃融資融券市場彙總讀取失敗。", "TAIWAN_MARKET_UNAVAILABLE"),
    });
  }

  async function getTaiwanMarketScan(filters = {}) {
    await ensureAuthorized();
    const response = await invokeFunction("investment-intelligence-read", { taiwan_market_scan: filters });
    if (response?.contract !== "zhuge-investment-intelligence-edge-v1"
      || response?.read_only !== true
      || !response?.taiwan_market_scan
      || response.taiwan_market_scan.contract !== "zhuge-taiwan-market-scan-v1"
      || !Array.isArray(response.taiwan_market_scan.items)) {
      const error = new Error("Taiwan market scanner contract is unavailable or invalid.");
      error.code = "TAIWAN_SCANNER_CONTRACT_INVALID";
      throw error;
    }
    return Object.freeze({ ...response.taiwan_market_scan, readOnly: true });
  }

  async function getMarketContext(inputs = []) {
    const result = await loadResearch(inputs, { globalMarketContext: true });
    return Object.freeze({
      generatedAt: result.generatedAt,
      fx: result.fx,
      marketPhase: result.marketPhase,
      globalMarketContext: result.globalMarketContext,
      globalReferenceContext: Object.freeze(Array.isArray(result.globalReferenceContext) ? result.globalReferenceContext : []),
      globalCommodityContext: Object.freeze(Array.isArray(result.globalCommodityContext) ? result.globalCommodityContext : []),
      news: result.news,
      quotes: result.quotes,
      histories: result.histories,
      providerTrace: result.providerTrace,
      quality: result.quality,
      readOnly: true,
    });
  }

  async function getTdccHistoricalSeries(input) {
    await ensureAuthorized();
    const request = await resolveRequest(input);
    if (request.market !== "TW") {
      return Object.freeze({ contract: "zhuge-tdcc-series-v1", status: "NOT_APPLICABLE", symbol: request.symbol, observations: [], provider: null, dataTimestamp: null });
    }
    const result = await intelligenceProvider.load({ symbols: [], tdccHistorySymbol: request.symbol });
    return result?.tdccHistoricalSeries || Object.freeze({
      contract: "zhuge-tdcc-series-v1",
      status: "UNAVAILABLE",
      symbol: request.symbol,
      observations: [],
      provider: "TDCC public dataset 11452",
      dataTimestamp: null,
      error: "TDCC_HISTORY_UNAVAILABLE",
    });
  }

  async function getNews(input) {
    const request = await resolveRequest(input);
    const result = await loadResearch([request]);
    return Object.freeze({ items: Object.freeze(result.news.filter(item => !item.symbol || item.symbol === request.symbol)), generatedAt: result.generatedAt, readOnly: true });
  }

  async function getWatchlistEventCandidates(items = [], { maxSymbols = 20 } = {}) {
    await ensureAuthorized();
    const candidates = [];
    const unresolved = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const market = text(item?.market, 10).toUpperCase();
      const symbol = text(item?.symbol, 24).toUpperCase();
      if (!MARKETS.has(market) || !symbol) continue;
      const key = `${market}:${symbol.replace(/\.(TW|TWO)$/i, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        candidates.push(await resolveRequest({
          symbol,
          market,
          name: text(item?.name),
          query: [symbol.replace(/\.(TW|TWO)$/i, ""), text(item?.name)].filter(Boolean).join(" "),
        }));
      } catch (error) {
        unresolved.push({ market, symbol, errorCode: text(error?.code, 80) || "SYMBOL_UNRESOLVED" });
      }
    }

    const boundedLimit = Math.max(0, Math.min(100, Math.floor(Number(maxSymbols) || 0)));
    const selected = candidates.slice(0, boundedLimit);
    const news = [];
    const failures = [];
    for (let offset = 0; offset < selected.length; offset += 5) {
      const batch = selected.slice(offset, offset + 5);
      try {
        const result = await intelligenceProvider.load({ symbols: batch, newsLimit: 5, newsOnly: true });
        if (result?.contract !== "zhuge-investment-intelligence-runtime-v1") throw Object.assign(new Error("Unexpected Investment Intelligence contract."), { code: "INTELLIGENCE_CONTRACT_INVALID" });
        news.push(...(Array.isArray(result.news) ? result.news : []));
      } catch (error) {
        failures.push({ symbols: batch.map(item => `${item.market}:${item.symbol}`), errorCode: text(error?.code, 80) || "NEWS_READ_UNAVAILABLE" });
      }
    }

    const matched = matchWatchlistEventCandidates(selected, news, { maxSymbols: boundedLimit });
    const partial = unresolved.length > 0 || failures.length > 0 || candidates.length > boundedLimit;
    return Object.freeze({
      ...matched,
      status: partial ? "PARTIAL" : matched.status,
      scannedCount: Math.min(selected.length, matched.scannedCount),
      totalCount: seen.size,
      unscannedCount: Math.max(matched.unscannedCount, candidates.length - selected.length) + unresolved.length,
      unresolved: Object.freeze(unresolved),
      failures: Object.freeze(failures),
      readOnly: true,
      note: "來源搜尋結果僅為候選訊息，尚未人工核對原文；此功能不寄送通知。",
    });
  }

  return Object.freeze({
    searchSymbols,
    loadResearch,
    getQuote,
    getHistory,
    getTechnical,
    getProfile,
    getInstitutional,
    getOwnership,
    getMargin,
    getAnnouncements,
    getTaiwanEvidence: loadTaiwanEvidence,
    getTaiwanMarketOverview,
    getTaiwanMarketScan,
    getMarketContext,
    getTdccHistoricalSeries,
    getNews,
    getWatchlistEventCandidates,
  });
}

export const labMarketProviderContract = Object.freeze({
  provider: "existing InvestmentIntelligenceProviders + investment-intelligence-read",
  readOnly: true,
  markets: Object.freeze(["TW", "US"]),
  requiredMethods: Object.freeze(["getQuote", "getHistory", "getProfile", "getInstitutional", "getOwnership", "getMargin", "getAnnouncements", "getTaiwanMarketOverview", "getTaiwanMarketScan", "getMarketContext", "getTdccHistoricalSeries", "getWatchlistEventCandidates"]),
});
