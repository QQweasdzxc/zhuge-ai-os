(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { escape, format } = dependencies;
    const cards = state.strategies.map(strategy => `<article class="investment-strategy-card"><header><div><p class="investment-eyebrow">決策紀錄</p><h2>${escape(strategy.title)}</h2></div><span>${escape(strategy.decision)}</span></header><div class="investment-reasoning"><div><strong>依據</strong><p>${escape(strategy.evidence)}</p></div><div><strong>理由</strong><p>${escape(strategy.reason)}</p></div><div><strong>決策</strong><p>${escape(strategy.decision)}</p></div></div><small>更新：${escape(format.date(strategy.updatedAt))}</small></article>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資策略</p><h1>策略與決策</h1><p>保留每次判斷的依據、理由與最後決策。</p></div></div><div class="investment-strategy-list">${cards || '<div class="investment-empty-state">目前尚無策略或決策紀錄。</div>'}</div></section>`;
  }

  return Object.freeze({ render });
});
