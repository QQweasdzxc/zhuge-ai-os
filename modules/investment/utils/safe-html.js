(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentSafeHtml = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escape(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;"
    })[character]);
  }

  return Object.freeze({ escape });
});
