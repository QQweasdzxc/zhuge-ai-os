(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value = {}) {
    return Object.freeze({
      id: String(value.id || ""),
      userId: String(value.userId || ""),
      title: String(value.title || ""),
      evidence: String(value.evidence || ""),
      reason: String(value.reason || ""),
      decision: String(value.decision || "觀望"),
      updatedAt: String(value.updatedAt || new Date(0).toISOString())
    });
  }

  return Object.freeze({ normalize });
});
