(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPortfolioPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const ivtk = dependencies.ivtk;
    return typeof ivtk?.renderBoard === "function"
      ? ivtk.renderBoard(state, dependencies)
      : '<section class="empty-golden-master"><div class="investment-empty-state">Investment C Board 尚未就緒。</div></section>';
  }

  return Object.freeze({ render });
});
