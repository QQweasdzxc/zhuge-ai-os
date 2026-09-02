(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPosition = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const numeric = value => Number(value || 0);

  function numericOr(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : Number(value);
  }

  function normalize(value = {}) {
    const quantity = numeric(value.quantity);
    const averageCost = numeric(value.averageCost ?? value.avg_cost);
    const lastPrice = numeric(value.lastPrice ?? value.last_price);
    const investedCost = numericOr(value.investedCost ?? value.invested_cost, quantity * averageCost);
    const marketValue = numericOr(value.marketValue ?? value.market_value, quantity * lastPrice);
    const unrealizedPnl = numericOr(value.unrealizedPnl ?? value.unrealized_pnl, marketValue - investedCost);
    const unrealizedPercent = numericOr(value.unrealizedPercent ?? value.unrealized_pct, investedCost ? unrealizedPnl / investedCost * 100 : 0);
    const rawBrokerValues = value.rawBrokerValues ?? value.raw_broker_values;
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
      unrealizedPercent,
      snapshotId: String(value.snapshotId || value.snapshot_id || ""),
      snapshotAt: value.snapshotAt ?? value.snapshot_at ?? null,
      source: String(value.source || ""),
      marketValueSource: String(value.marketValueSource || value.market_value_source || ""),
      rawBrokerValues: rawBrokerValues && typeof rawBrokerValues === "object" ? Object.freeze({ ...rawBrokerValues }) : null
    });
  }

  return Object.freeze({ normalize });
});
