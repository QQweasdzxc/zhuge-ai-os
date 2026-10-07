(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentHoldingCardPresentation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function currencySymbol(currency) {
    return String(currency || "TWD").toUpperCase() === "USD" ? "US$" : "NT$";
  }

  function formattedNumber(value, format, digits = 2) {
    if (!finite(value)) return "—";
    return typeof format?.number === "function"
      ? format.number(Number(value), digits)
      : Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function formattedMoney(value, currency, format) {
    if (!finite(value)) return "—";
    return typeof format?.currency === "function"
      ? format.currency(Number(value), currency)
      : `${currencySymbol(currency)} ${Number(value).toLocaleString("zh-TW", { maximumFractionDigits: currency === "USD" ? 2 : 0 })}`;
  }

  function signedMoney(value, currency, format) {
    if (!finite(value)) return "—";
    const amount = Math.abs(Number(value));
    const formatted = formattedMoney(amount, currency, format);
    return `${Number(value) > 0 ? "+" : Number(value) < 0 ? "−" : ""}${formatted}`;
  }

  function formattedPercent(value, format) {
    if (!finite(value)) return "—";
    if (typeof format?.percent === "function") return format.percent(Number(value));
    const amount = Number(value);
    return `${amount > 0 ? "+" : ""}${formattedNumber(amount, format, 2)}%`;
  }

  function formattedQuantity(value, format) {
    if (!finite(value)) return "—";
    const amount = Number(value);
    if (Number.isInteger(amount) && typeof format?.integer === "function") return format.integer(amount);
    if (!Number.isInteger(amount) && typeof format?.number === "function") return format.number(amount, 3);
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(amount);
  }

  function quoteDate(value, format) {
    if (!value || !Number.isFinite(Date.parse(value))) return "—";
    if (typeof format?.date === "function") return format.date(value);
    return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).format(new Date(value));
  }

  function eligibleOfficialHistory(history) {
    return history?.available === true
      && history?.provider === "twse-daily-history"
      && history?.source === "TWSE Daily Trading Open Data"
      && Array.isArray(history?.bars);
  }

  function renderSparkline(history) {
    const bars = eligibleOfficialHistory(history)
      ? history.bars.filter(bar => finite(bar?.close) && Number(bar.close) >= 0).slice(-20)
      : [];
    if (bars.length < 20) {
      return `<div class="investment-holding-trend investment-holding-trend-empty" data-holding-trend="unavailable" aria-label="近 20 日走勢尚無可用官方資料"><span>近 20 日</span><span>尚無行情</span></div>`;
    }
    const values = bars.map(bar => Number(bar.close));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * 116 + 2;
      const y = 25 - ((value - min) / (max - min)) * 21;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    const direction = values.at(-1) > values[0] ? "gain" : values.at(-1) < values[0] ? "loss" : "neutral";
    const asOf = quoteDate(history.asOf || bars.at(-1)?.asOf, null);
    return `<div class="investment-holding-trend" data-holding-trend="official" data-provider="twse-daily-history" aria-label="近 20 個交易日官方收盤走勢，資料截至 ${escapeHtml(asOf)}"><svg viewBox="0 0 120 28" preserveAspectRatio="none" role="img" aria-label="近 20 日收盤迷你走勢"><polyline class="investment-holding-sparkline ${direction}" points="${points}"></polyline><circle class="investment-holding-sparkline-point ${direction}" cx="118" cy="${Number(points.split(" ").at(-1).split(",")[1]).toFixed(2)}" r="1.7"></circle></svg><span>近 20 日</span><time>${escapeHtml(asOf)}</time></div>`;
  }

  function buildHoldingViewModel(row = {}, task = {}, history = null, format = {}) {
    const pnl = row.unrealized_pnl;
    const percent = row.unrealized_pct;
    const trend = finite(pnl) && Number(pnl) > 0 ? "gain" : finite(pnl) && Number(pnl) < 0 ? "loss" : "neutral";
    const asOf = row.effective_at || null;
    return Object.freeze({
      workCode: String(task.workCode || task.work_code || ""),
      sourceKind: String(row.source_kind || ""),
      sourceId: String(row.source_id || ""),
      symbol: String(row.symbol || ""),
      displayName: String(row.name || ""),
      currency: String(row.currency || "TWD"),
      lastPrice: finite(row.last_price) ? Number(row.last_price) : null,
      averageCost: finite(row.avg_cost) ? Number(row.avg_cost) : null,
      investedCost: finite(row.invested_cost) ? Number(row.invested_cost) : null,
      marketValue: finite(row.market_value) ? Number(row.market_value) : null,
      unrealizedPnl: finite(pnl) ? Number(pnl) : null,
      unrealizedPercent: finite(percent) ? Number(percent) : null,
      quoteAsOf: asOf,
      estimateSource: String(row.market_value_source || "來源未提供"),
      quantity: finite(row.quantity) ? Number(row.quantity) : null,
      trend,
      historyProvider: eligibleOfficialHistory(history) ? history.provider : "unavailable",
      historyBarCount: eligibleOfficialHistory(history) ? history.bars.filter(bar => finite(bar?.close)).slice(-20).length : 0,
      formatted: Object.freeze({
        lastPrice: formattedNumber(row.last_price, format, 2),
        price: finite(row.last_price) ? `${currencySymbol(row.currency)} ${formattedNumber(row.last_price, format, 2)}` : "—",
        averageCost: formattedNumber(row.avg_cost, format, 2),
        investedCost: formattedMoney(row.invested_cost, row.currency, format),
        quantity: formattedQuantity(row.quantity, format),
        marketValue: formattedMoney(row.market_value, row.currency, format),
        unrealizedPnl: signedMoney(pnl, row.currency, format),
        unrealizedPercent: formattedPercent(percent, format),
        quoteDate: quoteDate(asOf, format)
      })
    });
  }

  function renderHoldingContent(row = {}, task = {}, history = null, format = {}) {
    const model = buildHoldingViewModel(row, task, history, format);
    const escape = escapeHtml;
    const trendClass = model.trend;
    return `<div class="investment-holding-card" data-investment-holding-presentation="v2" data-investment-source-kind="${escape(model.sourceKind)}" data-investment-source-id="${escape(model.sourceId)}">
      <div class="investment-holding-heading"><h3 class="shared-task-card-title investment-holding-title"><span class="investment-holding-symbol">${escape(model.symbol || "—")}</span><span class="investment-holding-name">${escape(model.displayName || "名稱未提供")}</span></h3><span class="investment-holding-badge">已持有</span></div>
      <div class="investment-holding-hero"><strong class="investment-holding-price">${escape(model.formatted.price)}</strong><strong class="investment-holding-return ${trendClass}">${escape(model.formatted.unrealizedPercent)}</strong></div>
      <div class="investment-holding-card-bottom"><span class="investment-holding-freshness">持股資料時間 ${escape(model.formatted.quoteDate)} · 非即時行情</span><span class="investment-holding-code">${escape(model.workCode)}</span><button type="button" class="investment-holding-detail-trigger" data-investment-holding-detail-trigger aria-label="查看持股明細" aria-controls="investmentHoldingDetailPanel" aria-expanded="false"><span class="investment-holding-detail-trigger-label">明細</span><span aria-hidden="true">⌄</span></button></div>
    </div>`;
  }

  function summarizeCurrentPositions(rows = []) {
    const current = (Array.isArray(rows) ? rows : []).filter(row =>
      String(row?.position_status || row?.positionStatus || "") === "current"
      && Number.isFinite(Number(row?.quantity))
      && Number(row.quantity) > 0
    );
    const currencies = [...new Set(current.map(row => String(row.currency || "TWD").toUpperCase()))].sort();
    const groups = Object.fromEntries(currencies.map(currency => {
      const items = current.filter(row => String(row.currency || "TWD").toUpperCase() === currency);
      const metric = field => {
        const values = items.map(row => finite(row[field]) ? Number(row[field]) : null);
        const missing = values.filter(value => value === null).length;
        return Object.freeze({ value: values.length && missing === 0 ? values.reduce((sum, value) => sum + value, 0) : null, missingCount: missing });
      };
      const marketValue = metric("market_value");
      const investedCost = metric("invested_cost");
      const unrealizedPnl = metric("unrealized_pnl");
      const roi = investedCost.value !== null && investedCost.value > 0 && unrealizedPnl.value !== null
        ? unrealizedPnl.value / investedCost.value * 100
        : null;
      return [currency, Object.freeze({ count: items.length, marketValue, investedCost, unrealizedPnl, roi })];
    }));
    return Object.freeze({ count: current.length, currencies: Object.freeze(currencies), groups: Object.freeze(groups) });
  }

  function renderPortfolioHoldingContent(row = {}, task = {}, history = null, format = {}) {
    const model = buildHoldingViewModel(row, task, history, format);
    const escape = escapeHtml;
    const unavailable = model.lastPrice === null || model.marketValue === null || model.unrealizedPnl === null;
    return `<div class="investment-portfolio-holding" data-investment-holding-presentation="portfolio-v1" data-investment-source-kind="${escape(model.sourceKind)}" data-investment-source-id="${escape(model.sourceId)}">
      <div class="investment-portfolio-holding-heading"><h3 class="investment-portfolio-holding-title"><span>${escape(model.symbol || "—")}</span><span>${escape(model.displayName || "名稱未提供")}</span></h3><span class="investment-holding-badge">已持有</span></div>
      <div class="investment-portfolio-holding-hero"><strong>${escape(model.formatted.price)}</strong><strong class="${escape(model.trend)}">${escape(model.formatted.unrealizedPercent)}</strong></div>
      <div class="investment-portfolio-holding-market"><span>市值 <b>${escape(model.formatted.marketValue)}</b></span>${renderSparkline(history)}</div>
      <div class="investment-portfolio-holding-footer"><span class="investment-portfolio-holding-meta"><span>${escape(unavailable ? "尚無行情" : `收盤 ${model.formatted.quoteDate}`)}</span><span>損益 ${escape(model.formatted.unrealizedPnl)}</span><span class="investment-holding-code">${escape(model.workCode)}</span></span><button type="button" class="investment-holding-detail-trigger" data-investment-holding-detail-trigger aria-label="查看持股明細" aria-controls="investmentHoldingDetailPanel" aria-expanded="false"><span>明細</span><span aria-hidden="true">›</span></button></div>
    </div>`;
  }

  function renderHoldingDetail(row = {}, task = {}, history = null, format = {}) {
    const model = buildHoldingViewModel(row, task, history, format);
    const escape = escapeHtml;
    const trendClass = model.trend;
    return `<header class="investment-holding-detail-header"><div><h2 id="investmentHoldingDetailTitle"><span>${escape(model.symbol || "—")}</span> ${escape(model.displayName || "名稱未提供")}</h2><span class="investment-holding-badge">已持有</span></div><button type="button" class="investment-holding-detail-close" data-investment-holding-detail-close aria-label="關閉持股明細">×</button></header>
      <p class="investment-holding-detail-quantity">持有 <strong>${escape(model.formatted.quantity)}</strong> 股 <span class="investment-holding-code">${escape(model.workCode)}</span></p>
      <dl class="investment-holding-detail-metrics"><div><dt>平均成本 / 股</dt><dd>${escape(model.formatted.averageCost)}</dd></div><div><dt>投入成本</dt><dd>${escape(model.formatted.investedCost)}</dd></div><div><dt>目前價格</dt><dd>${escape(model.formatted.price)}</dd></div><div><dt>目前市值</dt><dd>${escape(model.formatted.marketValue)}</dd></div><div class="${trendClass}"><dt>未實現損益</dt><dd>${escape(model.formatted.unrealizedPnl)}</dd></div><div class="${trendClass}"><dt>損益率</dt><dd>${escape(model.formatted.unrealizedPercent)}</dd></div></dl>
      <section class="investment-holding-detail-trend" aria-label="近 20 日行情"><h3>近 20 日行情</h3>${renderSparkline(history)}</section>
      <footer class="investment-holding-detail-footer"><span>持股資料時間：${escape(model.formatted.quoteDate)}</span><span>資料來源：${escape(model.estimateSource)}</span><span>非即時行情</span></footer>`;
  }

  return Object.freeze({
    buildHoldingViewModel,
    renderHoldingContent,
    summarizeCurrentPositions,
    renderPortfolioHoldingContent,
    renderHoldingDetail,
    renderSparkline,
    eligibleOfficialHistory
  });
});
