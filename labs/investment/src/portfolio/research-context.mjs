function canonicalSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\.(TW|TWO)$/i, "");
}

/** Returns null when the canonical watchlist read is unavailable; false only means a confirmed non-member. */
export function formalWatchlistMembership({ symbol, market, status, items } = {}) {
  if (!symbol || !market || !["AVAILABLE", "EMPTY"].includes(status) || !Array.isArray(items)) return null;
  const targetSymbol = canonicalSymbol(symbol);
  const targetMarket = String(market).trim().toUpperCase();
  return items.some(item => String(item?.market || "").trim().toUpperCase() === targetMarket
    && canonicalSymbol(item?.symbol) === targetSymbol);
}
