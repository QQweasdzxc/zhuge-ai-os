(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPosition = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const numeric = value => Number(value || 0);

  function normalize(value = {}) {
    const quantity = numeric(value.quantity);
    const averageCost = numeric(value.averageCost ?? value.avg_cost);
    const lastPrice = numeric(value.lastPrice ?? value.last_price);
    const investedCost = numeric(value.investedCost ?? value.invested_cost) || quantity * averageCost;
    const marketValue = numeric(value.marketValue ?? value.market_value) || quantity * lastPrice;
    const unrealizedPnl = numeric(value.unrealizedPnl ?? value.unrealized_pnl) || marketValue - investedCost;
    return Object.freeze({
      id: String(value.id || value.symbol || ""),
      userId: String(value.userId || ""),
      portfolioId: String(value.portfolioId || ""),
      symbol: String(value.symbol || ""),
      name: String(value.name || ""),
      market: String(value.market || "TW").toUpperCase(),
      currency: String(value.currency || "TWD").toUpperCase(),
      quantity,
      averageCost,
      lastPrice,
      investedCost,
      marketValue,
      unrealizedPnl,
      unrealizedPercent: investedCost ? unrealizedPnl / investedCost * 100 : 0
    });
  }

  return Object.freeze({ normalize });
});
