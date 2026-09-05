(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPositionCard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(position, dependencies = {}) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const classify = dependencies.classify;
    const trend = classify(position);
    return `<article class="investment-position-card ${trend}">
      <header><div><strong>${escape(position.symbol)}</strong><span>${escape(position.name)}</span></div><div class="investment-price"><small>目前價</small><b>${format.number(position.lastPrice)}</b><em>${position.market === "US" ? "🇺🇸" : "🇹🇼"}</em></div></header>
      <div class="investment-metrics"><div><small>股數</small><b>${format.number(position.quantity).replace(/\.00$/, "")}</b></div><div><small>均價</small><b>${format.number(position.averageCost)}</b></div><div><small>成本</small><b>${format.number(position.investedCost)}</b></div><div><small>市值</small><b>${format.number(position.marketValue)}</b></div></div>
      <footer><span>${escape(position.currency)}</span><b>${format.signed(position.unrealizedPnl)} / ${format.percent(position.unrealizedPercent)}</b></footer>
    </article>`;
  }

  return Object.freeze({ render });
});
