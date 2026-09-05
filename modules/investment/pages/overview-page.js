(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentOverviewPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CURRENCY_GROUPS = Object.freeze([
    Object.freeze(["TWD", "tw"]),
    Object.freeze(["USD", "us"])
  ]);

  function currencyAmount(value, currency, format) {
    const numeric = Number(value || 0);
    return `${numeric >= 0 ? "+" : "-"}${format.currency(Math.abs(numeric), currency)}`;
  }

  function currencyValues(summary, field, format, includePercent = false) {
    const groups = CURRENCY_GROUPS
      .map(([currency, key]) => [currency, summary[key]])
      .filter(([, group]) => group && group.count > 0);
    if (!groups.length) {
      return `<div class="investment-kpi-unavailable"><strong>尚無持倉資料</strong><small>目前沒有可供計算的 Cloud 持倉資料。</small></div>`;
    }
    return `<div class="investment-kpi-amounts">${groups.map(([currency, group]) => `<span><b>${field === "pnl" ? currencyAmount(group[field], currency, format) : format.currency(group[field], currency)}</b>${includePercent ? `<small>${format.percent(group.roi)}</small>` : `<small>${currency}</small>`}</span>`).join("")}</div>`;
  }

  function renderMetric(id, label, value, note, state = "available") {
    return `<article class="investment-command-kpi ${state === "unavailable" ? "is-unavailable" : ""}" data-investment-kpi="${id}"><header><small>${label}</small><span>${state === "unavailable" ? "資料不足" : "Cloud Read-only"}</span></header>${value}<p>${note}</p></article>`;
  }

  function renderTotalReturn(state, escape) {
    const totalReturn = state.performance?.totalReturn;
    if (totalReturn && typeof totalReturn === "object" && Array.isArray(totalReturn.values) && totalReturn.values.length) {
      return `<div class="investment-kpi-amounts">${totalReturn.values.map(item => `<span><b>${escape(String(item.value ?? "—"))}</b><small>${escape(String(item.currency || ""))}</small></span>`).join("")}</div>`;
    }
    return `<div class="investment-kpi-unavailable"><strong>資料尚未完整</strong><small>目前缺少已實現損益與股利資料，不推估總報酬。</small></div>`;
  }

  function renderTodayFocus(state, escape) {
    const items = Array.isArray(state.todayFocus) ? state.todayFocus.filter(Boolean).slice(0, 3) : [];
    if (!items.length) {
      return `<div class="investment-panel-empty" data-investment-state="pending"><strong>目前沒有可驗證的今日重點</strong><small>待 Price／News／Event Intelligence 建立後，這裡只顯示有 Evidence 的投資事項。</small></div>`;
    }
    return `<div class="investment-focus-list">${items.map(item => `<article><span>${escape(String(item.type || "投資事項"))}</span><strong>${escape(String(item.title || "未命名事項"))}</strong><p>${escape(String(item.summary || "尚無說明"))}</p></article>`).join("")}</div>`;
  }

  function renderRealtime(state, escape) {
    const events = Array.isArray(state.marketEvents) ? state.marketEvents.filter(Boolean).slice(0, 4) : [];
    if (!events.length) {
      return `<div class="investment-panel-empty" data-investment-state="pending"><strong>即時情報尚未接通</strong><small>目前尚未有 Price／News／Event Engine 資料；這裡不顯示猜測或假行情。</small></div>`;
    }
    return `<div class="investment-event-list">${events.map(event => `<article><header><span>${escape(String(event.type || "市場事件"))}</span><time>${escape(String(event.occurredAt || ""))}</time></header><strong>${escape(String(event.title || "未命名事件"))}</strong><p>${escape(String(event.summary || "尚無摘要"))}</p></article>`).join("")}</div>`;
  }

  function renderAdvisor(state, escape, format) {
    const records = Array.isArray(state.strategies) ? state.strategies.filter(Boolean).slice(0, 2) : [];
    const flow = [
      ["Evidence", "可驗證資料"],
      ["Reason", "推理與脈絡"],
      ["Observation / Risk / Opportunity", "觀察、風險與機會"],
      ["Suggestion", "建議"],
      ["User Decision", "由使用者決定"]
    ];
    const recordsMarkup = records.length
      ? `<div class="investment-advisor-records">${records.map(record => `<article><header><strong>${escape(record.title || "投資策略")}</strong><span>${escape(record.decision || "觀望")}</span></header><div><small>Evidence</small><p>${escape(record.evidence || "尚無 Evidence")}</p></div><div><small>Reason</small><p>${escape(record.reason || "尚無推理紀錄")}</p></div><small>更新：${escape(format.date(record.updatedAt))}</small></article>`).join("")}</div>`
      : `<div class="investment-panel-empty" data-investment-state="pending"><strong>目前沒有可供分析的 Evidence</strong><small>沒有可信資料時，諸葛先生不產生 Recommendation；User Decision 永遠保留給使用者。</small></div>`;
    return `<div class="investment-advisor-flow">${flow.map(([title, description], index) => `<div class="investment-advisor-step"><b>${index + 1}</b><span><strong>${title}</strong><small>${description}</small></span></div>`).join("")}</div>${recordsMarkup}`;
  }

  function renderImportantHoldings(state, dependencies) {
    const positions = (Array.isArray(state.positions) ? state.positions : [])
      .slice()
      .sort((left, right) => Math.abs(Number(right.unrealizedPnl || 0)) - Math.abs(Number(left.unrealizedPnl || 0)))
      .slice(0, 4);
    if (!positions.length) {
      return `<div class="investment-panel-empty" data-investment-state="empty"><strong>目前尚無持股資料</strong><small>待 Investment Cloud 讀回可用的 Portfolio／Opening Position 後，這裡會顯示重點持股。</small></div>`;
    }
    return `<div class="investment-position-grid">${positions.map(position => dependencies.positionCard.render(position, {
      escape: dependencies.escape,
      format: dependencies.format,
      classify: dependencies.calculation.classify
    })).join("")}</div><p class="investment-readonly-note">目前依未實現損益絕對值列出重點，僅供資訊整理，不代表 AI 投資建議。</p>`;
  }

  function render(state, dependencies = {}) {
    const { format, calculation, escape } = dependencies;
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const summary = calculation.summarize(positions);
    const hasPositions = positions.length > 0;
    const hasTotalReturn = Boolean(state.performance?.totalReturn && Array.isArray(state.performance.totalReturn.values) && state.performance.totalReturn.values.length);
    const positionCount = hasPositions ? `${positions.length} 筆持倉已讀回` : "尚未讀回持倉";
    return `<section class="investment-command-center" data-investment-command-center data-investment-readonly="true">
      <div class="investment-page-heading"><div><p class="investment-eyebrow">Investment Command Center</p><h1>投資首頁</h1><p>先看今天值得注意的事，再看投資狀況與持股變化。</p></div><div class="investment-command-heading-actions"><span class="investment-pill">資料來源：Investment Cloud（唯讀）</span><button class="investment-refresh" type="button" data-investment-refresh>重新整理</button></div></div>

      <div class="investment-command-grid investment-command-grid-top">
        <article class="investment-command-panel investment-focus-panel" data-investment-section="today-focus"><header class="investment-panel-heading"><div><p class="investment-eyebrow">01 · 今日軍令</p><h2>今天我的投資發生什麼事情？</h2><p>只呈現有可信資料支撐的事項。</p></div><span class="investment-panel-status is-pending">待建立</span></header>${renderTodayFocus(state, escape)}</article>
        <article class="investment-command-panel investment-advisor-panel" data-investment-section="advisor"><header class="investment-panel-heading"><div><p class="investment-eyebrow">05 · 諸葛先生</p><h2>投資決策區</h2><p>Evidence → Reason → Decision；不替使用者下決定。</p></div><span class="investment-panel-status is-pending">可信資料優先</span></header>${renderAdvisor(state, escape, format)}</article>
      </div>

      <section class="investment-kpi-section" data-investment-section="core-kpi"><header class="investment-panel-heading"><div><p class="investment-eyebrow">02 · 投資核心 KPI</p><h2>我現在的投資狀況如何？</h2><p>${positionCount}；不跨幣別硬湊單一數字。</p></div><span class="investment-panel-status ${hasPositions ? "is-ready" : "is-pending"}">${hasPositions ? "可計算" : "資料不足"}</span></header><div class="investment-kpi-grid">
        ${renderMetric("invested-cost", "總投入成本", currencyValues(summary, "cost", format), "依目前已讀回的持倉成本計算。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("market-value", "目前市值", currencyValues(summary, "value", format), "依目前已讀回的持倉市值計算。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("unrealized-pnl", "未實現損益", currencyValues(summary, "pnl", format, true), "依 Cloud 持倉的 unrealized_pnl 計算。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("total-return", "總報酬", renderTotalReturn(state, escape), "目前不具備完整已實現損益與股利 Contract。", hasTotalReturn ? "available" : "unavailable")}
      </div></section>

      <div class="investment-command-grid investment-command-grid-bottom">
        <article class="investment-command-panel investment-holdings-panel" data-investment-section="important-holdings"><header class="investment-panel-heading"><div><p class="investment-eyebrow">03 · 重要持股</p><h2>哪些持股值得先看？</h2><p>先用可解釋的持倉資料整理，不假裝是 AI 判斷。</p></div><button type="button" data-investment-route="portfolio">查看全部 →</button></header>${renderImportantHoldings(state, dependencies)}</article>
        <article class="investment-command-panel investment-realtime-panel" data-investment-section="realtime"><header class="investment-panel-heading"><div><p class="investment-eyebrow">04 · 即時情報</p><h2>市場與事件</h2><p>行情、新聞與事件接通後才會呈現。</p></div><span class="investment-panel-status is-pending">待接通</span></header>${renderRealtime(state, escape)}</article>
      </div>
    </section>`;
  }

  return Object.freeze({ render });
});
