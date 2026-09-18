(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentIntelligenceLayer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROVIDER_KINDS = Object.freeze([
    "market",
    "market_history",
    "market_phase",
    "news",
    "fundamental",
    "relationship",
    "fx",
    "social"
  ]);
  const providers = new Map();

  function normalizeProvider(provider = {}) {
    const id = String(provider.id || "").trim();
    const kind = String(provider.kind || "").trim();
    if (!id) throw new TypeError("Investment Intelligence provider requires id.");
    if (!PROVIDER_KINDS.includes(kind)) throw new TypeError(`Unsupported Investment Intelligence provider kind: ${kind}`);
    if (typeof provider.fetch !== "function") throw new TypeError("Investment Intelligence provider requires fetch().");
    return Object.freeze({
      id,
      kind,
      priority: Number.isFinite(Number(provider.priority)) ? Number(provider.priority) : 100,
      markets: Object.freeze((Array.isArray(provider.markets) ? provider.markets : ["*"]).map(String)),
      fetch: provider.fetch
    });
  }

  function registerProvider(provider) {
    const normalized = normalizeProvider(provider);
    providers.set(normalized.id, normalized);
    return normalized;
  }

  function listProviders(kind) {
    return Array.from(providers.values())
      .filter(item => !kind || item.kind === kind)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  function supportsMarket(provider, market) {
    return provider.markets.includes("*") || provider.markets.includes(String(market || "").toUpperCase());
  }

  async function fetchWithFallback(kind, request = {}) {
    const candidates = listProviders(kind).filter(provider => supportsMarket(provider, request.market));
    const attempts = [];
    for (const provider of candidates) {
      try {
        const value = await provider.fetch(Object.freeze({ ...request }));
        if (value != null && (!Array.isArray(value) || value.length > 0)) {
          return Object.freeze({ ok: true, provider: provider.id, value, attempts: Object.freeze(attempts) });
        }
        attempts.push(Object.freeze({ provider: provider.id, ok: false, reason: "EMPTY" }));
      } catch (error) {
        attempts.push(Object.freeze({ provider: provider.id, ok: false, reason: String(error?.code || error?.message || "FAILED") }));
      }
    }
    return Object.freeze({ ok: false, provider: null, value: null, attempts: Object.freeze(attempts) });
  }

  function freshness(asOf, now = Date.now(), freshWithinMs = 15 * 60 * 1000) {
    const timestamp = Date.parse(String(asOf || ""));
    if (!Number.isFinite(timestamp)) return "unknown";
    const age = now - timestamp;
    if (age < -5 * 60 * 1000) return "unknown";
    return age <= freshWithinMs ? "fresh" : "stale";
  }

  function normalizeQuote(item = {}, now = Date.now()) {
    const price = Number(item.price);
    const asOf = String(item.asOf || item.as_of || item.observedAt || "").trim();
    const computedFreshness = item.freshness || freshness(asOf, now);
    return Object.freeze({
      contract: "zhuge-investment-quote-v1",
      symbol: String(item.symbol || "").trim().toUpperCase(),
      market: String(item.market || "").trim().toUpperCase(),
      currency: String(item.currency || "").trim().toUpperCase(),
      price: Number.isFinite(price) ? price : null,
      provider: String(item.provider || "").trim(),
      source: String(item.source || item.provider || "").trim(),
      sourceUrl: String(item.sourceUrl || item.source_url || "").trim(),
      asOf,
      receivedAt: String(item.receivedAt || new Date(now).toISOString()),
      freshness: computedFreshness,
      stale: computedFreshness === "stale",
      available: item.available !== false && Number.isFinite(price),
      error: String(item.error || "").trim() || null,
      attempts: Object.freeze(Array.isArray(item.attempts) ? item.attempts.slice() : [])
    });
  }

  function normalizeFx(item = {}, now = Date.now()) {
    const rate = Number(item.rate);
    const asOf = String(item.asOf || item.as_of || item.observedAt || "").trim();
    const computedFreshness = item.freshness || freshness(asOf, now, 24 * 60 * 60 * 1000);
    return Object.freeze({
      contract: "zhuge-investment-fx-v1",
      base: String(item.base || "USD").trim().toUpperCase(),
      quote: String(item.quote || "TWD").trim().toUpperCase(),
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      provider: String(item.provider || "").trim(),
      source: String(item.source || item.provider || "").trim(),
      sourceUrl: String(item.sourceUrl || item.source_url || "").trim(),
      asOf,
      receivedAt: String(item.receivedAt || new Date(now).toISOString()),
      freshness: computedFreshness,
      stale: computedFreshness === "stale",
      available: item.available !== false && Number.isFinite(rate) && rate > 0,
      error: String(item.error || "").trim() || null,
      attempts: Object.freeze(Array.isArray(item.attempts) ? item.attempts.slice() : [])
    });
  }

  function normalizeEvidence(item = {}) {
    const observedAt = String(item.observedAt || item.publishedAt || item.asOf || "").trim();
    const computedFreshness = item.freshness || freshness(observedAt);
    return Object.freeze({
      type: String(item.type || "unknown"),
      symbol: String(item.symbol || "").trim().toUpperCase(),
      market: String(item.market || "").trim().toUpperCase(),
      title: String(item.title || "").trim(),
      summary: String(item.summary || "").trim(),
      source: String(item.source || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      observedAt,
      quality: String(item.quality || "unknown"),
      freshness: computedFreshness,
      stale: item.stale === true || computedFreshness === "stale",
      facts: Object.freeze(Array.isArray(item.facts) ? item.facts.slice() : []),
      limitations: Object.freeze(Array.isArray(item.limitations) ? item.limitations.slice() : [])
    });
  }

  function evidenceKey(item) {
    return [item.type, item.source, item.sourceUrl, item.title, item.observedAt].join("|").toLowerCase();
  }

  function buildContextPack(input = {}) {
    const seen = new Set();
    const evidence = [];
    for (const raw of Array.isArray(input.evidence) ? input.evidence : []) {
      const item = normalizeEvidence(raw);
      const key = evidenceKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(item);
    }
    return Object.freeze({
      contract: "zhuge-investment-context-pack-v1",
      symbol: String(input.symbol || "").trim().toUpperCase(),
      market: String(input.market || "").trim().toUpperCase(),
      generatedAt: String(input.generatedAt || new Date().toISOString()),
      portfolioContext: Object.freeze(input.portfolioContext && typeof input.portfolioContext === "object" ? { ...input.portfolioContext } : {}),
      marketPhase: Object.freeze(input.marketPhase && typeof input.marketPhase === "object" ? { ...input.marketPhase } : {}),
      dataQuality: Object.freeze(input.dataQuality && typeof input.dataQuality === "object" ? { ...input.dataQuality } : {}),
      evidence: Object.freeze(evidence),
      missing: Object.freeze((Array.isArray(input.missing) ? input.missing : []).map(String)),
      strategyIds: Object.freeze((Array.isArray(input.strategyIds) ? input.strategyIds : []).map(String))
    });
  }

  function clearProvidersForTest() { providers.clear(); }

  return Object.freeze({
    PROVIDER_KINDS,
    registerProvider,
    listProviders,
    fetchWithFallback,
    freshness,
    normalizeQuote,
    normalizeFx,
    normalizeEvidence,
    buildContextPack,
    clearProvidersForTest
  });
});
