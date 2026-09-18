(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioCalculationService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const numeric = value => Number(value || 0);
  const total = (items, field) => items.reduce((sum, item) => sum + numeric(item[field]), 0);

  function summarize(positions = []) {
    const normalized = Array.isArray(positions) ? positions : [];
    const current = normalized.filter(position => position.positionStatus !== "history" && Number(position.quantity || 0) > 0);
    const tw = current.filter(position => position.currency === "TWD");
    const us = current.filter(position => position.currency === "USD");
    const twAll = normalized.filter(position => position.currency === "TWD");
    const usAll = normalized.filter(position => position.currency === "USD");
    const summarizeCurrency = items => {
      const cost = total(items, "investedCost");
      const value = total(items, "marketValue");
      const pnl = total(items, "unrealizedPnl");
      return Object.freeze({ count: items.length, cost, value, pnl, realizedPnl: 0, roi: cost ? pnl / cost * 100 : 0 });
    };
    const withRealized = (group, all) => Object.freeze({ ...group, realizedPnl: total(all, "realizedPnl") });
    return Object.freeze({
      assetCount: current.length,
      tw: withRealized(summarizeCurrency(tw), twAll),
      us: withRealized(summarizeCurrency(us), usAll),
      historicalAssetCount: normalized.filter(position => position.positionStatus === "history").length
    });
  }

  function classify(position = {}) {
    return numeric(position.unrealizedPnl) >= 0 ? "gain" : "loss";
  }

  function applyQuotes(positions = [], quotes = []) {
    const quoteMap = new Map((Array.isArray(quotes) ? quotes : [])
      .filter(quote => quote?.available && Number.isFinite(Number(quote.price)))
      .map(quote => [`${String(quote.market || "").toUpperCase()}:${String(quote.symbol || "").toUpperCase()}`, quote]));
    return Object.freeze((Array.isArray(positions) ? positions : []).map(position => {
      const key = `${String(position.market || "").toUpperCase()}:${String(position.symbol || "").toUpperCase()}`;
      const quote = quoteMap.get(key);
      if (!quote) return position;
      const quantity = numeric(position.quantity);
      const investedCost = numeric(position.investedCost);
      const marketValue = quantity * Number(quote.price);
      const unrealizedPnl = marketValue - investedCost;
      return Object.freeze({
        ...position,
        lastPrice: Number(quote.price),
        marketValue,
        unrealizedPnl,
        unrealizedPercent: investedCost ? unrealizedPnl / investedCost * 100 : 0,
        marketValueSource: quote.provider || quote.source || position.marketValueSource,
        quoteProvider: quote.provider || "",
        quoteSource: quote.source || "",
        quoteAsOf: quote.asOf || null,
        quoteFreshness: quote.freshness || "unknown"
      });
    }));
  }

  return Object.freeze({ summarize, classify, applyQuotes });
});
