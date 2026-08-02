(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return Object.freeze({
    id: "investment",
    name: "投資",
    description: "市場資訊、投資組合與決策紀錄",
    version: "0.2.0-sit.2",
    dataMode: "cloud",
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    pages: Object.freeze(["overview", "portfolio", "watchlist", "strategy", "settings"])
  });
});
