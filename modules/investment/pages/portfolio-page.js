(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPortfolioPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { format, calculation, positionCard, escape } = dependencies;
    const cards = state.positions.map(position => positionCard.render(position, { escape, format, classify: calculation.classify })).join("");
    const tradeLabel = value => ({ BUY: "買入", SELL: "賣出", "買進": "買進", "賣出": "賣出", "期初庫存": "期初庫存", "定期定額": "定期定額", "現金股利": "現金股利", "股票股利": "股票股利", "費用": "費用", "調整": "調整" }[value] || value || "交易");
    const transactions = state.transactions.map(transaction => `<div class="investment-transaction-row"><time>${escape(transaction.tradeDate)}</time><strong>${escape(transaction.symbol)}</strong><span>${escape(tradeLabel(transaction.tradeType))}</span><span>${format.number(transaction.quantity)} 股</span><b>${format.currency(transaction.netAmount, transaction.currency)}</b></div>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資組合</p><h1>${escape(state.portfolio?.name || "投資組合")}</h1><p>查看目前持股、成本、市值與近期交易。</p></div><span class="investment-pill">基準幣別 ${escape(state.portfolio?.baseCurrency || "TWD")}</span></div><div class="investment-position-grid">${cards || '<div class="investment-empty-state">目前尚無持股資料。</div>'}</div><div class="investment-section-heading"><div><p class="investment-eyebrow">交易紀錄</p><h2>近期交易</h2></div></div><div class="investment-table">${transactions || '<div class="investment-empty-state">目前尚無交易紀錄。</div>'}</div></section>`;
  }

  return Object.freeze({ render });
});
