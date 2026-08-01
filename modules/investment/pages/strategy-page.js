(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { escape, format } = dependencies;
    const cards = state.strategies.map(strategy => `<article class="investment-strategy-card"><header><div><p class="investment-eyebrow">DECISION RECORD</p><h2>${escape(strategy.title)}</h2></div><span>${escape(strategy.decision)}</span></header><div class="investment-reasoning"><div><strong>Evidence</strong><p>${escape(strategy.evidence)}</p></div><div><strong>Reason</strong><p>${escape(strategy.reason)}</p></div><div><strong>Decision</strong><p>${escape(strategy.decision)}</p></div></div><small>更新：${escape(format.date(strategy.updatedAt))}</small></article>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">STRATEGY</p><h1>策略與決策</h1><p>所有投資建議都遵循 Evidence → Reason → Decision。</p></div></div><div class="investment-strategy-list">${cards}</div></section>`;
  }

  return Object.freeze({ render });
});
