(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPosition = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function numeric(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function valueOr(primary, fallback) {
    return primary === null || primary === undefined || primary === "" ? fallback : primary;
  }

  function normalize(value = {}) {
    const quantity = numeric(value.quantity);
    const averageCost = numeric(value.averageCost ?? value.avg_cost);
    const lastPrice = numeric(value.lastPrice ?? value.last_price);
    const investedCost = numeric(valueOr(value.investedCost ?? value.invested_cost, quantity * averageCost));
    const marketValue = numeric(valueOr(value.marketValue ?? value.market_value, quantity * lastPrice));
    const unrealizedPnl = numeric(valueOr(value.unrealizedPnl ?? value.unrealized_pnl, marketValue - investedCost));
    const suppliedPercent = valueOr(value.unrealizedPercent ?? value.unrealized_pct ?? value.returnRate ?? value.return_rate, null);
    const rawBrokerValues = value.rawBrokerValues ?? value.raw_broker_values;
    return Object.freeze({
      id: String(value.id || value.sourceId || value.source_id || value.symbol || ""),
      userId: String(value.userId || ""),
      portfolioId: String(value.portfolioId || ""),
      sourceKind: String(value.sourceKind || value.source_kind || ""),
      sourceId: String(value.sourceId || value.source_id || value.id || ""),
      sourceSnapshotId: String(value.sourceSnapshotId || value.source_snapshot_id || ""),
      effectiveAt: value.effectiveAt || value.effective_at || null,
      symbol: String(value.symbol || ""),
      name: String(value.name || ""),
      market: String(value.market || "TW").toUpperCase(),
      currency: String(value.currency || "TWD").toUpperCase(),
      assetType: String(value.assetType || value.asset_type || "position"),
      account: String(value.account || ""),
      source: String(value.source || ""),
      quantity,
      averageCost,
      lastPrice,
      investedCost,
      marketValue,
      unrealizedPnl,
      unrealizedPercent: suppliedPercent === null ? (investedCost ? unrealizedPnl / investedCost * 100 : 0) : numeric(suppliedPercent),
      marketValueSource: String(value.marketValueSource || value.market_value_source || ""),
      rawBrokerValues: rawBrokerValues && typeof rawBrokerValues === "object" ? Object.freeze({ ...rawBrokerValues }) : {},
      note: String(value.note || ""),
      snapshotId: String(value.snapshotId || value.snapshot_id || ""),
      snapshotAt: value.snapshotAt ?? value.snapshot_at ?? null
    });
  }

  return Object.freeze({ normalize });
});
