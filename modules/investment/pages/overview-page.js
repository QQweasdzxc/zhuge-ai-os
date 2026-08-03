(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentOverviewPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { format, calculation, positionCard, escape } = dependencies;
    const summary = calculation.summarize(state.positions);
    const preview = state.positions.slice(0, 4).map(position => positionCard.render(position, {
      escape,
      format,
      classify: calculation.classify
    })).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資摘要</p><h1>投資首頁</h1><p>快速掌握投資組合、持股表現與近期決策。</p></div><button type="button" class="investment-refresh" data-investment-refresh>重新整理</button></div>
      <div class="investment-kpi-grid"><article><small>資產檔數</small><b>${summary.assetCount} 檔</b></article><article><small>台股市值</small><b>${format.currency(summary.tw.value, "TWD")}</b></article><article class="${summary.tw.pnl >= 0 ? "gain" : "loss"}"><small>台股損益</small><b>${format.signed(summary.tw.pnl)} / ${format.percent(summary.tw.roi)}</b></article><article><small>美股市值</small><b>${format.currency(summary.us.value, "USD")}</b></article></div>
      <article class="investment-decision"><div><span>投資提醒</span><strong>先確認資料，再做每一項投資決策</strong><p>所有資訊僅供個人整理與決策參考，不代表投資建議。</p></div><span class="investment-decision-badge">慎</span></article>
      <div class="investment-section-heading"><div><p class="investment-eyebrow">投資組合預覽</p><h2>目前持股</h2></div><button type="button" data-investment-route="portfolio">查看全部 →</button></div><div class="investment-position-grid">${preview || '<div class="investment-empty-state">目前尚無持股資料。</div>'}</div>
    </section>`;
  }

  return Object.freeze({ render });
});
