(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPortfolioPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const ivtk = dependencies.ivtk;
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資組合 · IVTK</p><h1>投資戰情板</h1><p>正式持倉以 Investment Cloud 為準，直接以共用 C Board 呈現。</p></div><span class="investment-pill">${escape(state.positions.length)} 檔目前持倉</span></div>${typeof ivtk?.renderBoard === "function" ? ivtk.renderBoard(state, dependencies) : '<div class="investment-empty-state">投資戰情板尚未就緒。</div>'}</section>`;
  }

  return Object.freeze({ render });
});
