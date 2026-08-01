(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return Object.freeze({
    id: "investment",
    name: "Investment",
    description: "市場資訊、投資組合與決策紀錄",
    version: "0.1.0-sit.1",
    dataMode: "mock",
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    pages: Object.freeze(["overview", "portfolio", "watchlist", "strategy", "settings"])
  });
});
