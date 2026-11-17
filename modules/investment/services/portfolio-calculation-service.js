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
      // cost is factual and always totals every holding; value/pnl/roi pair over
      // the SAME priced subset so a missing quote can never fabricate a loss
      // (full cost minus partial market value).
      const priced = items.filter(item => item.marketValue !== null && item.marketValue !== undefined && Number.isFinite(Number(item.marketValue)));
      const cost = total(items, "investedCost");
      const pricedCost = total(priced, "investedCost");
      const value = total(priced, "marketValue");
      const pnl = total(priced, "unrealizedPnl");
      const unpricedCount = items.length - priced.length;
      return Object.freeze({ count: items.length, cost, value, pnl, realizedPnl: 0, roi: pricedCost ? pnl / pricedCost * 100 : null, unpricedCount, pricedCount: priced.length, pricedCost });
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

  function quotePrice(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function applyQuotes(positions = [], quotes = []) {
    const dailyQuoteMap = new Map((Array.isArray(quotes) ? quotes : []).filter(q => q?.quoteType === "daily_close" && q.available && quotePrice(q.price) !== null).map(q => [`${q.market}:${q.symbol}:${q.venue}:${q.currency}`, q]));
    const quoteMap = new Map((Array.isArray(quotes) ? quotes : []).filter(q => q?.quoteType !== "daily_close")
      .filter(quote => quote?.available && quotePrice(quote.price) !== null)
      .map(quote => [`${String(quote.market || "").toUpperCase()}:${String(quote.symbol || "").toUpperCase()}`, quote]));
    return Object.freeze((Array.isArray(positions) ? positions : []).map(position => {
      const key = `${String(position.market || "").toUpperCase()}:${String(position.symbol || "").toUpperCase()}`;
      const quote = dailyQuoteMap.get(`${key}:${position.venue || ""}:${position.currency}`) || quoteMap.get(key);
      if (!quote || (quote.quoteType === "daily_close" && (!position.venue || quote.venue !== position.venue || quote.currency !== position.currency))) return Object.freeze({ ...position, liveQuoteAvailable: false });
      const quantity = numeric(position.quantity);
      const investedCost = numeric(position.investedCost);
      const marketValue = quantity * quotePrice(quote.price);
      const unrealizedPnl = marketValue - investedCost;
      return Object.freeze({
        ...position,
        lastPrice: quotePrice(quote.price),
        marketValue,
        unrealizedPnl,
        unrealizedPercent: investedCost ? unrealizedPnl / investedCost * 100 : 0,
        marketValueSource: quote.provider || quote.source || position.marketValueSource,
        quoteType: quote.quoteType || "",
        quoteVenue: quote.venue || "",
        quoteDelayed: quote.delayed === true,
        quoteProvider: quote.provider || "",
        quoteSource: quote.source || "",
        quoteAsOf: quote.asOf || null,
        quoteFreshness: quote.freshness || "unknown",
        liveQuoteAvailable: true
      });
    }));
  }

  return Object.freeze({ summarize, classify, applyQuotes });
});
