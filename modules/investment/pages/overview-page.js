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
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">AI 戰情官</p><h1>投資戰情首頁</h1><p>先以 Mock Data 驗證 Investment Runtime、Shared Identity 與 Module Flow。</p></div><button type="button" class="investment-refresh" data-investment-refresh>重新整理</button></div>
      <div class="investment-kpi-grid"><article><small>資產檔數</small><b>${summary.assetCount} 檔</b></article><article><small>台股市值</small><b>${format.currency(summary.tw.value, "TWD")}</b></article><article class="${summary.tw.pnl >= 0 ? "gain" : "loss"}"><small>台股損益</small><b>${format.signed(summary.tw.pnl)} / ${format.percent(summary.tw.roi)}</b></article><article><small>美股市值</small><b>${format.currency(summary.us.value, "USD")}</b></article></div>
      <article class="investment-decision"><div><span>今日軍令</span><strong>守中帶攻，保留現金等待價格確認</strong><p>Evidence → Reason → Decision。此為 SIT Mock 建議，不連接 Production 資料或交易。</p></div><span class="investment-decision-badge">守</span></article>
      <div class="investment-section-heading"><div><p class="investment-eyebrow">PORTFOLIO PREVIEW</p><h2>核心持股</h2></div><button type="button" data-investment-route="portfolio">查看全部 →</button></div><div class="investment-position-grid">${preview}</div>
    </section>`;
  }

  return Object.freeze({ render });
});
