(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentWatchlistItem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    return Object.freeze({
      id: String(value.id || value.symbol || ""),
      userId: String(value.userId || ""),
      symbol: String(value.symbol || ""),
      name: String(value.name || ""),
      market: String(value.market || "TW").toUpperCase(),
      status: String(value.status || "觀察中"),
      theme: String(value.theme || value.researchTheme || ""),
      reason: String(value.reason || ""),
      importance: String(value.importance || "P2")
    });
  }

  return Object.freeze({ normalize });
});
