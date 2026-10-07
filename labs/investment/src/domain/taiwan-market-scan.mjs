import { first, normalizeDate, number, rows, text } from "../lib/normalize.mjs";

const SOURCES = Object.freeze({
  TWSE: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
});

function normalizedVenue(value) {
  const venue = text(value).toUpperCase();
  return venue === "TWSE" || venue === "TPEX" ? venue : "";
}

function dateOf(row) {
  return normalizeDate(first(row, ["Date", "日期", "資料日期", "出表日期", "交易日期"]));
}

function catalogRows(payload) {
  return rows(payload).map((row) => {
    const symbol = text(first(row, ["公司代號", "證券代號", "Code", "SecuritiesCompanyCode", "股票代號"])).toUpperCase();
    const name = text(first(row, ["公司名稱", "證券名稱", "CompanyName", "公司簡稱", "Name"]));
    const industry = text(first(row, ["產業別", "產業類別", "Industry"]));
    return symbol ? { symbol, name, industry } : null;
  }).filter(Boolean);
}

function quoteRows(payload, venue) {
  const tpex = venue === "TPEX";
  return rows(payload).map((row) => {
    const symbol = text(tpex ? row.SecuritiesCompanyCode : row.Code).toUpperCase();
    const date = dateOf(row);
    const close = number(tpex ? row.Close : row.ClosingPrice);
    const change = number(row.Change);
    const volume = number(tpex ? row.TradingShares : row.TradeVolume);
    const tradeValue = number(tpex ? row.TradingAmount : row.TradeValue);
    if (!symbol || !date || close == null) return null;
    const priorClose = change == null ? null : close - change;
    return {
      symbol,
      name: text(tpex ? row.CompanyName : row.Name),
      venue,
      market: "TW",
      date,
      open: number(tpex ? row.Open : row.OpeningPrice),
      high: number(tpex ? row.High : row.HighestPrice),
      low: number(tpex ? row.Low : row.LowestPrice),
      close,
      change,
      changePercent: priorClose != null && priorClose > 0 ? change / priorClose * 100 : null,
      volume,
      tradeValue,
    };
  }).filter(Boolean);
}

function numberFilter(value, minimum, maximum) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : NaN;
}

export function normalizeTaiwanScanFilters(input = {}) {
  const venue = input.venue == null || input.venue === "" || String(input.venue).toUpperCase() === "ALL"
    ? "ALL"
    : normalizedVenue(input.venue);
  const sort = text(input.sort || "score").toLowerCase();
  const filters = {
    venue,
    industry: text(input.industry, 120),
    minPrice: numberFilter(input.minPrice, 0, 1_000_000),
    maxPrice: numberFilter(input.maxPrice, 0, 1_000_000),
    minChangePct: numberFilter(input.minChangePct, -100, 1_000),
    maxChangePct: numberFilter(input.maxChangePct, -100, 1_000),
    minVolume: numberFilter(input.minVolume, 0, 1_000_000_000_000),
    minTradeValue: numberFilter(input.minTradeValue, 0, 1_000_000_000_000_000),
    sort,
    limit: Math.min(200, Math.max(1, Math.floor(Number(input.limit) || 50))),
    offset: Math.min(5000, Math.max(0, Math.floor(Number(input.offset) || 0))),
  };
  if (!venue || (venue !== "ALL" && !normalizedVenue(venue))
    || !["score", "change", "trade_value", "volume"].includes(sort)
    || Object.values(filters).some(value => typeof value === "number" && Number.isNaN(value))
    || (filters.minPrice != null && filters.maxPrice != null && filters.minPrice > filters.maxPrice)
    || (filters.minChangePct != null && filters.maxChangePct != null && filters.minChangePct > filters.maxChangePct)) return null;
  return Object.freeze(filters);
}

function percentileRanks(items, field) {
  const available = items.filter(item => Number.isFinite(item[field])).slice().sort((a, b) => a[field] - b[field] || a.symbol.localeCompare(b.symbol));
  const ranks = new Map();
  for (let index = 0; index < available.length; index += 1) {
    let firstIndex = index;
    while (firstIndex > 0 && available[firstIndex - 1][field] === available[index][field]) firstIndex -= 1;
    const percentile = available.length <= 1 ? 50 : firstIndex / (available.length - 1) * 100;
    ranks.set(`${available[index].venue}:${available[index].date}:${available[index].symbol}`, percentile);
  }
  return ranks;
}

function passesFilters(item, filters) {
  if (filters.venue !== "ALL" && item.venue !== filters.venue) return false;
  if (filters.industry && item.industry !== filters.industry) return false;
  if (filters.minPrice != null && (item.close == null || item.close < filters.minPrice)) return false;
  if (filters.maxPrice != null && (item.close == null || item.close > filters.maxPrice)) return false;
  if (filters.minChangePct != null && (item.changePercent == null || item.changePercent < filters.minChangePct)) return false;
  if (filters.maxChangePct != null && (item.changePercent == null || item.changePercent > filters.maxChangePct)) return false;
  if (filters.minVolume != null && (item.volume == null || item.volume < filters.minVolume)) return false;
  if (filters.minTradeValue != null && (item.tradeValue == null || item.tradeValue < filters.minTradeValue)) return false;
  return true;
}

/**
 * Build a traceable, delayed-data Taiwan daily scan from exchange quote rows.
 * Ranking is descriptive only: (60% daily-change percentile + 40% turnover-value
 * percentile), grouped by venue and source date. It is not a trading signal.
 */
export function buildTaiwanMarketScan({ twseQuotes, tpexQuotes, twseCatalog, tpexCatalog, filters: rawFilters = {}, generatedAt = null } = {}) {
  const filters = normalizeTaiwanScanFilters(rawFilters);
  if (!filters) {
    const error = new TypeError("Taiwan market scan filters are invalid.");
    error.code = "SCANNER_FILTERS_INVALID";
    throw error;
  }
  const catalogs = new Map();
  const catalogCoverage = {};
  for (const [venue, payload] of [["TWSE", twseCatalog], ["TPEX", tpexCatalog]]) {
    const parsed = catalogRows(payload);
    catalogCoverage[venue] = parsed.length > 0;
    catalogs.set(venue, new Map(parsed.map(item => [item.symbol, item])));
  }
  const twseRows = quoteRows(twseQuotes, "TWSE");
  const tpexRows = quoteRows(tpexQuotes, "TPEX");
  const quoteCoverage = Object.freeze({ TWSE: twseRows.length > 0, TPEX: tpexRows.length > 0 });
  const all = [
    ...twseRows,
    ...tpexRows,
  ].map(item => {
    const catalog = catalogs.get(item.venue)?.get(item.symbol);
    return {
      ...item,
      name: item.name || catalog?.name || item.symbol,
      industry: catalog?.industry || null,
    };
  });

  const latestByVenue = new Map();
  for (const item of all) {
    const current = latestByVenue.get(item.venue);
    if (!current || item.date > current) latestByVenue.set(item.venue, item.date);
  }
  const latest = all.filter(item => item.date === latestByVenue.get(item.venue));
  const industries = new Map();
  for (const item of latest.filter(value => value.industry)) {
    const key = item.venue + ":" + item.date + ":" + item.industry;
    if (!industries.has(key)) industries.set(key, { venue: item.venue, date: item.date, industry: item.industry, count: 0, changes: [], turnovers: [], up: 0, down: 0, flat: 0 });
    const group = industries.get(key);
    group.count += 1;
    if (item.changePercent != null) {
      group.changes.push(item.changePercent);
      if (item.changePercent > 0) group.up += 1;
      else if (item.changePercent < 0) group.down += 1;
      else group.flat += 1;
    }
    if (item.tradeValue != null) group.turnovers.push(item.tradeValue);
  }
  const sectorRows = [...industries.values()].map(group => ({
    venue: group.venue,
    date: group.date,
    industry: group.industry,
    symbols: group.count,
    changeCoverage: group.changes.length,
    averageChangePercent: group.changes.length ? group.changes.reduce((sum, value) => sum + value, 0) / group.changes.length : null,
    up: group.up,
    down: group.down,
    flat: group.flat,
    tradeValue: group.turnovers.length === group.count ? group.turnovers.reduce((sum, value) => sum + value, 0) : null,
    tradeValueCoverage: group.turnovers.length,
  }));
  const sectorSummary = [];
  const sectorGroups = new Map();
  for (const item of sectorRows) {
    const key = item.venue + ":" + item.date;
    if (!sectorGroups.has(key)) sectorGroups.set(key, []);
    sectorGroups.get(key).push(item);
  }
  for (const group of sectorGroups.values()) {
    group.sort((a, b) => (b.averageChangePercent ?? -Infinity) - (a.averageChangePercent ?? -Infinity) || a.industry.localeCompare(b.industry, "zh-TW"));
    group.slice(0, 8).forEach((item, index) => sectorSummary.push({ ...item, rank: index + 1 }));
  }
  sectorSummary.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));
  const filtered = latest.filter(item => passesFilters(item, filters));
  const byGroup = new Map();
  for (const item of filtered) {
    const key = `${item.venue}:${item.date}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(item);
  }
  const ranked = [];
  for (const group of byGroup.values()) {
    const changeRanks = percentileRanks(group, "changePercent");
    const turnoverRanks = percentileRanks(group, "tradeValue");
    const scored = group.map(item => {
      const key = `${item.venue}:${item.date}:${item.symbol}`;
      const changePercentile = changeRanks.get(key) ?? null;
      const turnoverPercentile = turnoverRanks.get(key) ?? null;
      const score = changePercentile == null || turnoverPercentile == null
        ? null
        : Math.round(changePercentile * 0.6 + turnoverPercentile * 0.4);
      return { ...item, score, scoreComponents: { dailyChangePercentile: changePercentile, tradeValuePercentile: turnoverPercentile } };
    });
    scored.sort((a, b) => {
      const field = filters.sort === "change" ? "changePercent"
        : filters.sort === "trade_value" ? "tradeValue"
          : filters.sort === "volume" ? "volume" : "score";
      const left = a[field], right = b[field];
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;
      if (left != null && right != null && left !== right) return right - left;
      return a.symbol.localeCompare(b.symbol);
    });
    scored.forEach((item, index) => ranked.push({ ...item, rank: index + 1, rankingUniverseCount: scored.length }));
  }
  ranked.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));
  const page = ranked.slice(filters.offset, filters.offset + filters.limit);
  const dates = [...latestByVenue.entries()].filter(([venue]) => filters.venue === "ALL" || filters.venue === venue).map(([, date]) => date);
  const industryOptions = [...new Set(latest.filter(item => !filters.venue || filters.venue === "ALL" || item.venue === filters.venue).map(item => item.industry).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW"));
  return Object.freeze({
    contract: "zhuge-taiwan-market-scan-v1",
    status: !latest.length ? "UNAVAILABLE" : !quoteCoverage.TWSE || !quoteCoverage.TPEX || !catalogCoverage.TWSE || !catalogCoverage.TPEX ? "PARTIAL" : page.length ? "AVAILABLE" : "EMPTY",
    readOnly: true,
    provider: "TWSE / TPEx Official Open Data",
    source: [SOURCES.TWSE, SOURCES.TPEX],
    generatedAt,
    dataTimestamp: dates.length ? dates.sort().at(-1) : null,
    venueDates: Object.freeze(Object.fromEntries(latestByVenue)),
    quoteCoverage,
    catalogCoverage: Object.freeze(catalogCoverage),
    sourceLimitations: Object.freeze([
      "使用交易所最新可得收盤資料，不是盤中即時行情。",
      "上市櫃分開計算排名；不同交易日期不會混在同一排名組。",
      "未能與公司資料目錄配對的產業維持空值。",
      "描述性分數 = 套用條件後，同掛牌市場與交易日內日漲跌幅百分位 × 60% + 成交金額百分位 × 40%；不是預測或買賣訊號。",
    ]),
    methodology: Object.freeze({ score: "daily_change_percentile * 0.6 + trade_value_percentile * 0.4", venueAndDateScoped: true, filteredUniverse: true }),
    filters,
    total: ranked.length,
    pageCount: page.length,
    industryOptions: Object.freeze(industryOptions),
    sectorSummary: Object.freeze(sectorSummary.map(item => Object.freeze(item))),
    items: Object.freeze(page.map(item => Object.freeze(item))),
  });
}
