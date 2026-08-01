(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPortfolioPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const { format, calculation, positionCard, escape } = dependencies;
    const cards = state.positions.map(position => positionCard.render(position, { escape, format, classify: calculation.classify })).join("");
    const transactions = state.transactions.map(transaction => `<div class="investment-transaction-row"><time>${escape(transaction.tradeDate)}</time><strong>${escape(transaction.symbol)}</strong><span>${transaction.tradeType === "BUY" ? "買入" : "賣出"}</span><span>${format.number(transaction.quantity)} 股</span><b>${format.currency(transaction.netAmount, transaction.currency)}</b></div>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">PORTFOLIO</p><h1>${escape(state.portfolio?.name || "投資組合")}</h1><p>持股與交易資料目前由使用者 UUID 範圍內的 Mock Repository 提供。</p></div><span class="investment-pill">${escape(state.portfolio?.baseCurrency || "TWD")}</span></div><div class="investment-position-grid">${cards}</div><div class="investment-section-heading"><div><p class="investment-eyebrow">TRANSACTIONS</p><h2>近期交易</h2></div></div><div class="investment-table">${transactions || "<p>尚無交易</p>"}</div></section>`;
  }

  return Object.freeze({ render });
});
