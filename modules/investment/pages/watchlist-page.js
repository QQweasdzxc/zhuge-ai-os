(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentWatchlistPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const cards = state.watchlist.map(item => `<article class="investment-watch-card"><header><div><strong>${escape(item.symbol)}</strong><span>${escape(item.name)}</span></div><b>${escape(item.importance)}</b></header><dl><div><dt>市場</dt><dd>${escape(item.market)}</dd></div><div><dt>狀態</dt><dd>${escape(item.status)}</dd></div><div><dt>主題</dt><dd>${escape(item.theme)}</dd></div></dl><p>${escape(item.reason)}</p></article>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">觀察清單</p><h1>關注標的</h1><p>記錄值得持續追蹤的標的、主題與研究理由。</p></div><span class="investment-pill">${state.watchlist.length} 個標的</span></div><div class="investment-watch-grid">${cards || '<div class="investment-empty-state">目前尚未加入觀察標的。</div>'}</div></section>`;
  }

  return Object.freeze({ render });
});
