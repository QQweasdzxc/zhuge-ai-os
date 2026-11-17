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

  function finiteOrNull(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function valueOr(primary, fallback) {
    return primary === null || primary === undefined || primary === "" ? fallback : primary;
  }

  function normalize(value = {}) {
    const quantity = numeric(value.quantity);
    const averageCost = numeric(value.averageCost ?? value.avg_cost);
    // Missing quotes stay null instead of collapsing to 0: a 0 price fabricated
    // marketValue 0 and a fake -100% unrealized loss on position cards.
    const lastPrice = finiteOrNull(value.lastPrice ?? value.last_price);
    const investedCost = numeric(valueOr(value.investedCost ?? value.invested_cost, quantity * averageCost));
    const suppliedMarketValue = finiteOrNull(value.marketValue ?? value.market_value);
    const marketValue = suppliedMarketValue !== null ? suppliedMarketValue : (lastPrice !== null ? quantity * lastPrice : null);
    const suppliedPnl = finiteOrNull(value.unrealizedPnl ?? value.unrealized_pnl);
    const unrealizedPnl = suppliedPnl !== null ? suppliedPnl : (marketValue !== null ? marketValue - investedCost : null);
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
      venue: String(value.venue || "").toUpperCase(),
      historicalValuation: value.historicalValuation && typeof value.historicalValuation === "object" ? Object.freeze({ ...value.historicalValuation }) : null,
      venueResolution: value.venueResolution && typeof value.venueResolution === "object" ? Object.freeze({ ...value.venueResolution }) : null,
      assetType: String(value.assetType || value.asset_type || "position"),
      account: String(value.account || ""),
      source: String(value.source || ""),
      quantity,
      averageCost,
      lastPrice,
      investedCost,
      marketValue,
      unrealizedPnl,
      unrealizedPercent: suppliedPercent === null ? (unrealizedPnl !== null && investedCost ? unrealizedPnl / investedCost * 100 : null) : numeric(suppliedPercent),
      priceAvailable: lastPrice !== null,
      realizedPnl: numeric(value.realizedPnl ?? value.realized_pnl),
      everHeld: value.everHeld === true || value.ever_held === true || quantity > 0,
      positionStatus: String(value.positionStatus || value.position_status || (quantity > 0 ? "current" : "unknown")),
      baselineAt: value.baselineAt || value.baseline_at || null,
      calculationSource: String(value.calculationSource || value.calculation_source || ""),
      marketValueSource: String(value.marketValueSource || value.market_value_source || ""),
      rawBrokerValues: rawBrokerValues && typeof rawBrokerValues === "object" ? Object.freeze({ ...rawBrokerValues }) : {},
      note: String(value.note || ""),
      snapshotId: String(value.snapshotId || value.snapshot_id || ""),
      snapshotAt: value.snapshotAt ?? value.snapshot_at ?? null
    });
  }

  return Object.freeze({ normalize });
});
