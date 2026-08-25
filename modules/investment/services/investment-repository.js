(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentRepositoryContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REQUIRED_METHODS = Object.freeze([
    "loadPortfolio",
    "loadPositions",
    "loadTransactions",
    "loadWatchlist",
    "loadStrategies",
    "loadSettings"
  ]);

  function assertRepository(repository) {
    for (const method of REQUIRED_METHODS) {
      if (!repository || typeof repository[method] !== "function") {
        throw new TypeError(`Investment repository is missing ${method}().`);
      }
    }
    return repository;
  }

  return Object.freeze({ REQUIRED_METHODS, assertRepository });
});
