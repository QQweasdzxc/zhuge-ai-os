function normalizeSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function symbolAliases(value) {
  const symbol = normalizeSymbol(value);
  if (!symbol) return [];
  const base = symbol.replace(/\.(TW|TWO)$/, "");
  return base === symbol ? [symbol] : [symbol, base];
}

function marketKey(value) {
  const market = String(value ?? "").trim().toUpperCase();
  return market === "US" || market === "TW" ? market : "";
}

function symbolMarket(value) {
  // An exchange-qualified Taiwan ticker is explicit identity evidence. A bare
  // ticker is not enough to infer either Taiwan or US market membership.
  const symbol = normalizeSymbol(value);
  return /\.(TW|TWO)$/.test(symbol) ? "TW" : "";
}

function identityKey(symbol, market) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return "";
  const normalizedMarket = marketKey(market) || symbolMarket(normalizedSymbol);
  return `${normalizedMarket || "UNRESOLVED"}:${normalizedSymbol}`;
}

function addEvidence(index, symbol, evidence, market = "") {
  if (!evidence || typeof evidence !== "object") return;
  const aliases = symbolAliases(symbol);
  const key = identityKey(symbol, market);
  if (key) index.set(key, evidence);
  for (const alias of aliases) {
    const aliasKey = identityKey(alias, market);
    if (aliasKey) index.set(aliasKey, evidence);
  }
}

function findEvidence(index, symbol, market = "") {
  const scopedKey = identityKey(symbol, market);
  if (scopedKey && index.has(scopedKey)) return index.get(scopedKey);
  for (const alias of symbolAliases(symbol)) {
    const aliasKey = identityKey(alias, market);
    if (aliasKey && index.has(aliasKey)) return index.get(aliasKey);
  }
  return null;
}

export function portfolioHistoryForPosition(histories, position = {}) {
  if (!histories?.get) return null;
  const market = marketKey(position.market) || symbolMarket(position.researchSymbol) || symbolMarket(position.symbol);
  const symbols = [position.researchSymbol, position.symbol].filter(Boolean);
  for (const symbol of symbols) {
    const exact = histories.get(identityKey(symbol, market));
    if (exact) return exact;
    for (const alias of symbolAliases(symbol)) {
      const aliased = histories.get(identityKey(alias, market));
      if (aliased) return aliased;
    }
  }
  return null;
}

function unavailableEvidence() {
  return Object.freeze({
    status: "UNAVAILABLE",
    dataTruth: "UNAVAILABLE",
    provider: "Lab History Provider",
    source: Object.freeze([]),
    dataTimestamp: null,
    fetchedAt: null,
    stale: null,
    delayed: true,
    fallback: false,
    errorCode: "PROVIDER_READ_FAILED",
    note: "目前無法讀取歷史行情；不使用模擬或替代數值。",
    data: null,
  });
}

/**
 * Reuse history already loaded for the research cards, then fetch each distinct
 * missing portfolio symbol once. The returned map is an ephemeral view model;
 * it never changes or persists canonical portfolio positions.
 */
export async function loadPortfolioHistoryMap({ positions = [], trends = [], loadHistory, concurrency = 4 } = {}) {
  if (typeof loadHistory !== "function") throw new TypeError("Portfolio history loader is required.");

  const index = new Map();
  for (const trend of Array.isArray(trends) ? trends : []) {
    addEvidence(index, trend?.symbol, trend?.history, trend?.market);
  }

  const pending = new Map();
  for (const position of Array.isArray(positions) ? positions : []) {
    const symbol = normalizeSymbol(position?.researchSymbol || position?.symbol);
    const key = identityKey(symbol, position?.market);
    if (symbol && !findEvidence(index, symbol, position?.market)) pending.set(key, { symbol, position });
  }

  const queue = [...pending.entries()];
  let cursor = 0;
  const workerCount = Math.min(queue.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const [key, { symbol, position }] = queue[cursor++];
      let evidence;
      try { evidence = await loadHistory(symbol, position); }
      catch { evidence = unavailableEvidence(); }
      addEvidence(index, symbol, evidence || unavailableEvidence(), position?.market);
    }
  }));

  return index;
}
