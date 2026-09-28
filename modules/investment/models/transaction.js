(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentTransaction = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    const rawTradeType = String(value.tradeType || value.trade_type || "").trim();
    const normalizedTradeType = {
      買入: "BUY",
      買進: "BUY",
      BUY: "BUY",
      賣出: "SELL",
      SELL: "SELL"
    }[rawTradeType.toUpperCase()] || rawTradeType.toUpperCase() || "UNKNOWN";
    return Object.freeze({
      id: String(value.id || ""),
      userId: String(value.userId || ""),
      portfolioId: String(value.portfolioId || ""),
      tradeDate: String(value.tradeDate || value.trade_date || ""),
      tradeType: normalizedTradeType,
      symbol: String(value.symbol || ""),
      name: String(value.name || ""),
      market: String(value.market || "TW").toUpperCase(),
      quantity: Number(value.quantity || 0),
      price: Number(value.price || 0),
      grossAmount: Number(value.grossAmount ?? value.gross_amount ?? 0),
      fee: Number(value.fee ?? 0),
      tax: Number(value.tax ?? 0),
      netAmount: Number(value.netAmount ?? value.net_amount ?? 0),
      currency: String(value.currency || "TWD").toUpperCase(),
      account: String(value.account || ""),
      source: String(value.source || ""),
      note: String(value.note || ""),
      idempotencyKey: String(value.idempotencyKey || value.idempotency_key || ""),
      createdAt: value.createdAt || value.created_at || null,
      updatedAt: value.updatedAt || value.updated_at || null
    });
  }

  return Object.freeze({ normalize });
});
