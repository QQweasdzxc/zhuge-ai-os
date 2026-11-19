(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentHoldingsSimpleList = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function taipeiDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  }

  function taipeiDateTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
  }

  // Three clocks stay separate: quote as-of (price time), broker snapshot date,
  // and intelligence.loadedAt (read-back time). Same contract as overview-page.
  function renderDataLine(state, positions, escape) {
    if (state.intelligence?.status !== "ready") return "";
    const quotes = Array.isArray(state.intelligence?.quotes) ? state.intelligence.quotes.filter(quote => quote?.available && quote.asOf && positions.some(p => p.symbol === quote.symbol && p.market === quote.market && (!quote.currency || p.currency === quote.currency) && (quote.quoteType !== "daily_close" || p.venue === quote.venue))) : [];
    const parts = [];
    if (quotes.length) {
      const asOfValues = quotes.map(quote => String(quote.asOf)).sort();
      const min = taipeiDate(asOfValues[0]);
      const max = taipeiDate(asOfValues[asOfValues.length - 1]);
      const label = quotes.every(quote => quote.quoteType === "daily_close") ? "盤後收盤資料" : "報價資料";
      parts.push(`${label} ${min === max ? min : `${min} 至 ${max}`}（${quotes.length} 檔）`);
    }
    const snapshots = positions.filter(position => position.liveQuoteAvailable === false && finite(position.marketValue));
    if (snapshots.length) {
      const dates = Array.from(new Set(snapshots.map(position => taipeiDate(position.snapshotAt || position.effectiveAt || "未知日期"))));
      parts.push(`券商快照 ${dates.join("、")}（${snapshots.length} 檔）`);
    }
    const unpriced = positions.filter(position => !finite(position.marketValue));
    if (unpriced.length) parts.push(`${unpriced.length} 檔暫無報價未計入`);
    if (state.intelligence?.loadedAt) parts.push(`資料讀回 ${taipeiDateTime(state.intelligence.loadedAt)}`);
    if (!parts.length) return "";
    return `<p class="investment-quote-asof">${parts.map(part => escape(part)).join(" · ")}（台灣時間）</p>`;
  }

  function renderCurrencyGlance(summary, state, positions, dependencies, currency) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const tw = (currency === "USD" ? summary?.us : summary?.tw) || { count: 0, cost: 0, value: 0, pnl: 0, roi: null, unpricedCount: 0, pricedCount: 0, pricedCost: 0 };
    const has = tw.count > 0;
    const closedOnly = !has && positions.some(p => p.currency === currency && p.positionStatus === "history");
    const hasUnpriced = tw.unpricedCount > 0;
    const hasPriced = tw.pricedCount > 0;
    const roiText = tw.roi === null || tw.roi === undefined ? "報酬率待報價" : format.percent(tw.roi);
    const pnlClass = !hasPriced ? "" : tw.pnl >= 0 ? "is-gain" : "is-loss";
    // 全部投入成本與已估值部位分開：有缺價檔時，市值/損益只與「已估值部位成本」
    // 同口徑，三個數字可直接相減；全部成本獨立標示，不讓不同口徑的總額並排看似相等。
    const costCard = hasUnpriced
      ? `<article class="investment-command-kpi"><header><small>全部投入成本</small></header><div class="investment-kpi-amounts"><span><b>${format.currency(tw.cost, currency)}</b><small>${tw.count} 檔 · 含 ${tw.unpricedCount} 檔暫無報價</small></span></div></article>`
      : `<article class="investment-command-kpi"><header><small>總投入成本</small></header><div class="investment-kpi-amounts"><span><b>${has || closedOnly ? format.currency(tw.cost, currency) : "尚無資料"}</b></span></div></article>`;
    const valueLabel = hasUnpriced ? `已估值部位市值（${tw.pricedCount} 檔）` : "目前市值";
    const pnlLabel = hasUnpriced ? "已估值部位未實現損益" : "未實現損益";
    const pnlSub = hasPriced ? (hasUnpriced ? `成本 ${format.currency(tw.pricedCost, currency)} 計 · ${roiText}` : roiText) : "";
    return `<section class="investment-simple-glance" data-investment-section="simple-glance">
      <div class="investment-simple-kpis">
        ${costCard}
        <article class="investment-command-kpi"><header><small>${valueLabel}</small></header><div class="investment-kpi-amounts"><span><b>${hasPriced || closedOnly ? format.currency(tw.value, currency) : "尚無資料"}</b></span></div></article>
        <article class="investment-command-kpi ${pnlClass}"><header><small>${pnlLabel}</small></header><div class="investment-kpi-amounts"><span><b>${hasPriced || closedOnly ? `${tw.pnl >= 0 ? "+" : "-"}${format.currency(Math.abs(tw.pnl), currency)}` : "尚無資料"}</b><small>${pnlSub}</small></span></div></article>
      </div>${renderDataLine(state, positions.filter(p => p.currency === currency && p.positionStatus !== "history" && Number(p.quantity) > 0), escape)}
    </section>`;
  }

  function renderGlance(summary, state, positions, dependencies) {
    const currencies = ["TWD", "USD"].filter(currency => positions.some(p => p.currency === currency));
    if (!currencies.length) currencies.push("TWD");
    return currencies.map(currency => `<div data-investment-currency="${currency}">${currencies.length > 1 ? `<h2>${currency} 原幣總覽</h2>` : ""}${renderCurrencyGlance(summary, state, positions, dependencies, currency)}<p class="investment-realized-summary">已實現損益 <strong>${dependencies.format.signed((currency === "TWD" ? summary.tw : summary.us).realizedPnl)} ${currency}</strong><small> 自持股基準起、依可核算交易累計，含已平倉；不含基準前交易與股利，非完整歷年報酬。</small></p></div>`).join("");
  }

  function renderRow(position, dependencies) {
    const escape = dependencies.escape;
    const format = dependencies.format;
    const historical = position.positionStatus === "history";
    const positionKey = String(position.sourceId || position.id || `${position.market}:${position.symbol}:${position.currency}`);
    const hasValue = finite(position.marketValue);
    const hasPnl = finite(position.unrealizedPnl) && finite(position.unrealizedPercent);
    const pnlClass = !hasPnl ? "is-unpriced" : Number(position.unrealizedPnl) >= 0 ? "is-gain" : "is-loss";
    const freshnessText = { fresh: "即時", stale: "非即時", unknown: "時效未知" }[position.quoteFreshness] || position.quoteFreshness || "";
    const stamp = position.quoteType === "daily_close" && position.quoteAsOf
      ? `盤後收盤 <span style="white-space:nowrap">${escape(taipeiDate(position.quoteAsOf))}</span> <span style="white-space:nowrap">· 非即時</span>`
      : position.quoteAsOf
      ? `報價 ${escape(taipeiDateTime(position.quoteAsOf))}${freshnessText ? ` · ${escape(freshnessText)}` : ""}`
      : (position.snapshotAt || position.effectiveAt
        ? `快照 ${escape(taipeiDate(position.snapshotAt || position.effectiveAt))} · 暫無新報價`
        : "暫無報價");
    const pnlText = historical ? `已實現 ${format.signed(position.realizedPnl)} ${position.currency}` : hasPnl ? `${format.signed(position.unrealizedPnl)} / ${format.percent(position.unrealizedPercent)}` : "損益待報價更新";
    return `<details class="investment-simple-row ${pnlClass}" data-investment-symbol="${escape(position.symbol)}">
      <summary><span class="investment-simple-name"><strong>${escape(position.symbol)}</strong><small>${escape(position.name)}</small></span><span class="investment-simple-value">${historical ? "已平倉" : hasValue ? escape(format.currency(position.marketValue, position.currency)) : "—"}</span><span class="investment-simple-pnl">${escape(pnlText)}</span></summary>
      <dl class="investment-simple-detail"><div><dt>股數</dt><dd>${escape(format.number(position.quantity).replace(/\.00$/, ""))}</dd></div><div><dt>平均成本</dt><dd>${escape(format.number(position.averageCost))}</dd></div><div><dt>投入成本</dt><dd>${escape(format.currency(position.investedCost, position.currency))}</dd></div><div><dt>目前價</dt><dd>${finite(position.lastPrice) ? escape(format.number(position.lastPrice)) : "暫無報價"}</dd></div><div><dt>核算基準</dt><dd>${escape(position.baselineAt ? taipeiDate(position.baselineAt) : "啟用後可核算交易")}</dd></div><div><dt>已實現損益</dt><dd>${escape(format.signed(position.realizedPnl))} ${escape(position.currency)}</dd></div><div><dt>資料時間</dt><dd>${stamp}</dd></div></dl>
      <p class="investment-simple-more"><button type="button" data-investment-stock-action="buy" data-investment-position-key="${escape(positionKey)}">${historical ? "登記再買入" : "登記加碼"}</button>${historical ? "" : `<button type="button" data-investment-stock-action="sell" data-investment-position-key="${escape(positionKey)}">登記減碼／平倉</button>`}<button type="button" data-investment-stock-action="history" data-investment-position-key="${escape(positionKey)}">變動紀錄 →</button></p><p class="investment-quote-asof">登記實際成交，不會代你向券商下單；平倉請在賣出登記填全部在手股數。已實現只計基準起可核算期間。</p>
    </details>`;
  }

  function render(state, dependencies = {}) {
    const calculation = dependencies.calculation;
    const allPositions = Array.isArray(state.positions) ? state.positions : [];
    const current = allPositions.filter(position => position.positionStatus !== "history" && Number(position.quantity || 0) > 0);
    const history = allPositions.filter(position => position.positionStatus === "history");
    const historical = dependencies.holdingsView === "history";
    const positions = historical ? history : current;
    const summary = calculation.summarize(allPositions);
    const rows = positions.length ? positions.map(position => renderRow(position, dependencies)).join("")
      : `<div class="investment-panel-empty"><strong>${historical ? "目前尚無已平倉股票" : "目前尚無持股資料"}</strong><small>${historical ? "全數賣出後在此保留；原交易不刪除。" : "待 Investment Cloud 讀回後自動顯示；已平倉可切換查看。"}</small></div>`;
    return `<section class="investment-simple-overview" data-investment-simple-overview data-investment-readonly="true">
      ${state.intelligence?.quality?.dailyClose?.error === 'DAILY_SOURCE_AAL2_REQUIRED' ? '<p class="investment-quote-asof investment-auth-required" role="status">讀取盤後行情需要本次安全驗證；持股與投入成本仍保留。這不是來源或日期錯誤。</p><button type="button" class="investment-refresh" data-investment-read-step-up>驗證並讀取行情與應收款</button>' : state.intelligence?.quality?.dailyClose?.error ? '<p class="investment-quote-asof investment-source-unavailable" role="status">盤後行情尚未通過來源與日期驗證，暫不列入估值；持股與投入成本仍保留。</p>' : ''}
      ${renderGlance(summary, state, allPositions, dependencies)}
      <section class="investment-simple-holdings" data-investment-section="simple-holdings"><header class="investment-panel-heading"><div><h2>${historical ? "已平倉股票" : "我的持股"}</h2><p>點開個股登記增減、查看股數與變動紀錄。</p></div></header><div class="investment-holdings-switch" role="group" aria-label="持股狀態"><button type="button" data-investment-holdings-view="current" aria-pressed="${!historical}">在手 ${current.length}</button><button type="button" data-investment-holdings-view="history" aria-pressed="${historical}">已平倉 ${history.length}</button><button type="button" data-investment-new-buy>＋ 登記買入</button></div>${rows}</section>
    </section>`;
  }

  return Object.freeze({ render, renderGlance, renderRow, renderDataLine });
});
