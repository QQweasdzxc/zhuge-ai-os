(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentWatchlistPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value == null ? "" : value));
    const ivtk = dependencies.ivtk;
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">觀察清單 · IVTK</p><h1>觀察名單</h1><p>此相容入口直接顯示 IVTK 的觀察名單工作區，不維持第二套清單 UI。</p></div><span class="investment-pill">${escape(state.watchlist.length)} 個標的</span></div>${typeof ivtk?.renderBoard === "function" ? ivtk.renderBoard(state, dependencies, { onlyWorkspaceKey: "ivtk-watchlist" }) : '<div class="investment-empty-state">觀察名單尚未就緒。</div>'}</section>`;
  }

  return Object.freeze({ render });
});
