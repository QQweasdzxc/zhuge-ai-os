(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentTransaction = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    return Object.freeze({
      id: String(value.id || ""),
      userId: String(value.userId || ""),
      portfolioId: String(value.portfolioId || ""),
      tradeDate: String(value.tradeDate || value.trade_date || ""),
      tradeType: String(value.tradeType || value.trade_type || "BUY").toUpperCase(),
      symbol: String(value.symbol || ""),
      name: String(value.name || ""),
      quantity: Number(value.quantity || 0),
      price: Number(value.price || 0),
      netAmount: Number(value.netAmount ?? value.net_amount ?? 0),
      currency: String(value.currency || "TWD").toUpperCase(),
      note: String(value.note || "")
    });
  }

  return Object.freeze({ normalize });
});
