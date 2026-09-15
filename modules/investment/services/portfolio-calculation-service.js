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

  return Object.freeze({ summarize, classify });
});
