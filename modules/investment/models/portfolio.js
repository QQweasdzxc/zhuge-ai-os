(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPortfolio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    return Object.freeze({
      id: String(value.id || ""),
      userId: String(value.userId || ""),
      name: String(value.name || "核心投資組合"),
      baseCurrency: String(value.baseCurrency || "TWD"),
      isDefault: value.isDefault !== false
    });
  }

  return Object.freeze({ normalize });
});
