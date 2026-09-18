(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentIntelligenceLayer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROVIDER_KINDS = Object.freeze(["market", "news", "fundamental", "fx", "social"]);
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
        if (value != null) {
          return Object.freeze({ ok: true, provider: provider.id, value, attempts: Object.freeze(attempts) });
        }
        attempts.push(Object.freeze({ provider: provider.id, ok: false, reason: "EMPTY" }));
      } catch (error) {
        attempts.push(Object.freeze({ provider: provider.id, ok: false, reason: String(error?.code || error?.message || "FAILED") }));
      }
    }
    return Object.freeze({ ok: false, provider: null, value: null, attempts: Object.freeze(attempts) });
  }

  function normalizeEvidence(item = {}) {
    const observedAt = String(item.observedAt || item.publishedAt || item.asOf || "").trim();
    return Object.freeze({
      type: String(item.type || "unknown"),
      title: String(item.title || "").trim(),
      summary: String(item.summary || "").trim(),
      source: String(item.source || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      observedAt,
      quality: String(item.quality || "unknown"),
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
      evidence: Object.freeze(evidence),
      missing: Object.freeze((Array.isArray(input.missing) ? input.missing : []).map(String)),
      strategyIds: Object.freeze((Array.isArray(input.strategyIds) ? input.strategyIds : []).map(String))
    });
  }

  function clearProvidersForTest() { providers.clear(); }

  return Object.freeze({ PROVIDER_KINDS, registerProvider, listProviders, fetchWithFallback, normalizeEvidence, buildContextPack, clearProvidersForTest });
});
