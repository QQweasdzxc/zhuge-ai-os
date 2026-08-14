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
    const tw = normalized.filter(position => position.currency === "TWD");
    const us = normalized.filter(position => position.currency === "USD");
    const summarizeCurrency = items => {
      const cost = total(items, "investedCost");
      const value = total(items, "marketValue");
      const pnl = total(items, "unrealizedPnl");
      return Object.freeze({ count: items.length, cost, value, pnl, roi: cost ? pnl / cost * 100 : 0 });
    };
    return Object.freeze({
      assetCount: normalized.length,
      tw: summarizeCurrency(tw),
      us: summarizeCurrency(us)
    });
  }

  function classify(position = {}) {
    return numeric(position.unrealizedPnl) >= 0 ? "gain" : "loss";
  }

  return Object.freeze({ summarize, classify });
});
