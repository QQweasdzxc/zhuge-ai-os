(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(options = {}) {
    const validPages = new Set(options.pages || ["overview"]);
    let state = Object.freeze({
      status: "idle",
      activePage: validPages.has(options.activePage) ? options.activePage : "overview",
      identity: null,
      portfolio: null,
      positions: [],
      transactions: [],
      watchlist: [],
      strategies: [],
      settings: null,
      error: null,
      loadedAt: null
    });
    const listeners = new Set();

    function emit() {
      listeners.forEach(listener => listener(state));
    }

    function update(patch = {}) {
      state = Object.freeze({ ...state, ...patch });
      emit();
      return state;
    }

    return Object.freeze({
      getState: () => state,
      update,
      setActivePage: page => validPages.has(page) ? update({ activePage: page }) : state,
      subscribe(listener) {
        if (typeof listener !== "function") throw new TypeError("Store listener must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  return Object.freeze({ create });
});
