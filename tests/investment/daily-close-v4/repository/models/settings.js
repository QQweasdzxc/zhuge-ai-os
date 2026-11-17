(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    return Object.freeze({
      userId: String(value.userId || ""),
      baseCurrency: String(value.baseCurrency || "TWD"),
      privacyMode: value.privacyMode !== false,
      gainColor: "red",
      lossColor: "green",
      dataMode: String(value.dataMode || "cloud")
    });
  }

  return Object.freeze({ normalize });
});
