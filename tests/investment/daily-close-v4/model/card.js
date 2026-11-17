(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentPositionCard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function taipeiDateTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
  }

  const FRESHNESS_TEXT = { fresh: "即時", stale: "非即時", unknown: "時效未知" };

  function render(position, dependencies = {}) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const classify = dependencies.classify;
    const hasPrice = finite(position.lastPrice);
    const hasValue = finite(position.marketValue);
    const hasPnl = finite(position.unrealizedPnl) && finite(position.unrealizedPercent);
    const trend = hasPnl ? classify(position) : "is-unpriced";
    // Live quotes show their own as-of; anything else with a stored price or
    // value is a broker snapshot and must be labeled with its snapshot date so
    // an old price freshly loaded never reads as a new quote.
    const freshnessText = FRESHNESS_TEXT[position.quoteFreshness] || position.quoteFreshness || "";
    const quoteStamp = position.quoteType === "daily_close" && position.quoteAsOf
      ? `<small class="investment-quote-stamp">盤後收盤 <span style="white-space:nowrap">${escape(String(position.quoteAsOf).replace(/-/g, "/"))}</span> <span style="white-space:nowrap">· 非即時</span></small>`
      : position.quoteAsOf
      ? `<small class="investment-quote-stamp">報價 ${escape(taipeiDateTime(position.quoteAsOf))}${freshnessText ? ` · ${escape(freshnessText)}` : ""}</small>`
      : (position.snapshotAt || position.effectiveAt
        ? `<small class="investment-quote-stamp">快照 ${escape(String(format.date ? format.date(position.snapshotAt || position.effectiveAt) : (position.snapshotAt || position.effectiveAt)))} · 暫無新報價</small>`
        : (!hasPrice ? `<small class="investment-quote-stamp">暫無報價</small>` : ""));
    return `<article class="investment-position-card ${trend}">
      <header><div><strong>${escape(position.symbol)}</strong><span>${escape(position.name)}</span></div><div class="investment-price"><small>目前價</small><b>${hasPrice ? format.number(position.lastPrice) : "暫無報價"}</b><em>${position.market === "US" ? "🇺🇸" : "🇹🇼"}</em></div></header>
      <div class="investment-metrics"><div><small>股數</small><b>${format.number(position.quantity).replace(/\.00$/, "")}</b></div><div><small>均價</small><b>${format.number(position.averageCost)}</b></div><div><small>成本</small><b>${format.number(position.investedCost)}</b></div><div><small>市值</small><b>${hasValue ? format.number(position.marketValue) : "—"}</b></div></div>
      <footer><span>${escape(position.currency)}</span><b>${hasPnl ? `${format.signed(position.unrealizedPnl)} / ${format.percent(position.unrealizedPercent)}` : "損益待報價更新"}</b>${quoteStamp}</footer>
    </article>`;
  }

  return Object.freeze({ render });
});
