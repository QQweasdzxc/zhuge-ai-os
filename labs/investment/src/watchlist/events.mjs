const MARKETS = new Set(["TW", "US"]);

function text(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function marketKey(market, symbol) {
  return `${text(market, 8).toUpperCase()}:${text(symbol, 24).toUpperCase().replace(/\.(TW|TWO)$/i, "")}`;
}

function validWatchlistRow(item) {
  const market = text(item?.market, 8).toUpperCase();
  const symbol = text(item?.symbol, 24).toUpperCase();
  return MARKETS.has(market) && /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(symbol)
    ? { market, symbol: symbol.replace(/\.(TW|TWO)$/i, ""), name: text(item?.name, 180) }
    : null;
}

/**
 * Attach provider search results only to the exact market/symbol query that
 * produced them. These remain candidate mentions, not verified material
 * events or delivered notifications.
 */
export function matchWatchlistEventCandidates(watchlist = [], providerItems = [], { maxSymbols = 20 } = {}) {
  const uniqueRows = new Map();
  for (const item of Array.isArray(watchlist) ? watchlist : []) {
    const row = validWatchlistRow(item);
    if (row) uniqueRows.set(marketKey(row.market, row.symbol), row);
  }
  const rows = [...uniqueRows.values()];
  const limit = Math.max(0, Math.min(100, Math.floor(Number(maxSymbols) || 0)));
  const scannedRows = rows.slice(0, limit);
  const scannedKeys = new Set(scannedRows.map(row => marketKey(row.market, row.symbol)));
  const labels = new Map(scannedRows.map(row => [marketKey(row.market, row.symbol), row]));
  const seen = new Set();
  const items = [];

  for (const item of Array.isArray(providerItems) ? providerItems : []) {
    const market = text(item?.market, 8).toUpperCase();
    const symbol = text(item?.symbol, 24).toUpperCase().replace(/\.(TW|TWO)$/i, "");
    const key = marketKey(market, symbol);
    const sourceUrl = text(item?.sourceUrl || item?.source_url, 1000);
    const title = text(item?.title, 300);
    if (!scannedKeys.has(key) || !title || !/^https:\/\//i.test(sourceUrl)) continue;
    const dedupeKey = `${key}|${sourceUrl}|${title}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const row = labels.get(key);
    items.push(Object.freeze({
      market,
      symbol,
      name: row?.name || symbol,
      title,
      summary: text(item?.summary, 1000),
      source: text(item?.source || item?.provider, 160),
      sourceUrl,
      observedAt: text(item?.observedAt || item?.observed_at, 80),
      freshness: text(item?.freshness, 40) || "unknown",
      stale: item?.stale === true,
      classification: "candidate_provider_search_result",
    }));
  }

  const unscannedCount = Math.max(0, rows.length - scannedRows.length);
  return Object.freeze({
    status: unscannedCount ? "PARTIAL" : items.length ? "AVAILABLE" : "EMPTY",
    scannedCount: scannedRows.length,
    totalCount: rows.length,
    unscannedCount,
    items: Object.freeze(items),
    notificationDelivery: "SECRET_REQUIRED",
    note: "來源搜尋結果僅為候選訊息，尚未人工核對原文；此功能不寄送通知。",
  });
}
