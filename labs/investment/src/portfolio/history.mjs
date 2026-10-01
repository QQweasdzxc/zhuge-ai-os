function normalizeSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function symbolAliases(value) {
  const symbol = normalizeSymbol(value);
  if (!symbol) return [];
  const base = symbol.replace(/\.(TW|TWO)$/, "");
  return base === symbol ? [symbol] : [symbol, base];
}

function addEvidence(index, symbol, evidence) {
  if (!evidence || typeof evidence !== "object") return;
  for (const alias of symbolAliases(symbol)) index.set(alias, evidence);
}

function findEvidence(index, symbol) {
  for (const alias of symbolAliases(symbol)) {
    if (index.has(alias)) return index.get(alias);
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
    addEvidence(index, trend?.symbol, trend?.history);
  }

  const pending = new Map();
  for (const position of Array.isArray(positions) ? positions : []) {
    const symbol = normalizeSymbol(position?.researchSymbol || position?.symbol);
    if (symbol && !findEvidence(index, symbol)) pending.set(symbol, position);
  }

  const queue = [...pending.entries()];
  let cursor = 0;
  const workerCount = Math.min(queue.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const [symbol] = queue[cursor++];
      let evidence;
      try { evidence = await loadHistory(symbol); }
      catch { evidence = unavailableEvidence(); }
      addEvidence(index, symbol, evidence || unavailableEvidence());
    }
  }));

  return index;
}

