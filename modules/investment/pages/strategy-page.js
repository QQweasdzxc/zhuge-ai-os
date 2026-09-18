(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { escape, format } = dependencies;
    const cards = state.strategies.map(strategy => `<article class="investment-strategy-card"><header><div><p class="investment-eyebrow">決策紀錄</p><h2>${escape(strategy.title)}</h2></div><span>${escape(strategy.decision)}</span></header><div class="investment-reasoning"><div><strong>依據</strong><p>${escape(strategy.evidence)}</p></div><div><strong>理由</strong><p>${escape(strategy.reason)}</p></div><div><strong>決策</strong><p>${escape(strategy.decision)}</p></div></div><small>更新：${escape(format.date(strategy.updatedAt))}</small></article>`).join("");
    const library = dependencies.strategyLibrary?.list?.() || [];
    const skills = library.map(skill => `<article class="investment-strategy-skill"><div><span>${escape(skill.category)}</span><strong>${escape(skill.name)}</strong></div><p>${escape(skill.description)}</p></article>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資策略</p><h1>策略與決策</h1><p>保留每次判斷的依據、理由與最後決策；策略庫提供諸葛研究時可組合的分析角度。</p></div></div><section class="investment-strategy-library"><div class="investment-panel-heading"><div><p class="investment-eyebrow">Zhuge Strategy Library · Phase 1</p><h2>諸葛策略庫</h2><p>先建立策略能力目錄；後續接上行情、新聞與 Evidence Context 後，由諸葛依問題選擇一種或多種策略交叉研究。</p></div><span class="investment-pill">${library.length} 種</span></div><div class="investment-strategy-skill-grid">${skills}</div></section><div class="investment-strategy-list">${cards || '<div class="investment-empty-state">目前尚無策略或決策紀錄。</div>'}</div></section>`;
  }

  return Object.freeze({ render });
});
