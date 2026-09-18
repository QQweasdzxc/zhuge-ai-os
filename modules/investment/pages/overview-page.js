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

  function currencyValues(summary, field, format, includePercent = false, fx = null) {
    const groups = CURRENCY_GROUPS
      .map(([currency, key]) => [currency, summary[key]])
      .filter(([, group]) => group && group.count > 0);
    if (!groups.length) {
      return `<div class="investment-kpi-unavailable"><strong>尚無持倉資料</strong><small>目前沒有可供計算的 Cloud 持倉資料。</small></div>`;
    }
    return `<div class="investment-kpi-amounts">${groups.map(([currency, group]) => {
      const value = field === "pnl" || field === "realizedPnl" ? currencyAmount(group[field], currency, format) : format.currency(group[field], currency);
      const approximate = currency === "USD"
        ? fx?.available
          ? `<small>約 ${format.currency(Number(group[field] || 0) * Number(fx.rate), "TWD")}</small>`
          : `<small>約 NT$：匯率暫不可用</small>`
        : "";
      return `<span><b>${value}</b>${includePercent ? `<small>${format.percent(group.roi)}</small>` : `<small>${currency}</small>`}${approximate}</span>`;
    }).join("")}</div>`;
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
    const intelligence = state.intelligence || {};
    const quotes = Array.isArray(intelligence.quotes) ? intelligence.quotes.filter(Boolean).slice(0, 6) : [];
    const events = Array.isArray(state.marketEvents) ? state.marketEvents.filter(Boolean).slice(0, 4) : [];
    if (!quotes.length && !events.length) {
      return `<div class="investment-panel-empty" data-investment-state="pending"><strong>即時情報尚未接通</strong><small>目前尚未有 Price／News／Event Engine 資料；這裡不顯示猜測或假行情。</small></div>`;
    }
    const quoteMarkup = quotes.length
      ? `<div class="investment-quote-grid">${quotes.map(quote => `<article class="investment-quote-card ${quote.available ? "is-available" : "is-unavailable"}"><header><strong>${escape(String(quote.symbol || ""))}</strong><span>${escape(String(quote.market || ""))}</span></header><b>${quote.available ? escape(String(quote.price)) : "目前不可用"}</b><small>${escape(String(quote.currency || ""))} · ${escape(String(quote.source || quote.provider || "無來源"))}</small><small>${quote.asOf ? `as-of ${escape(String(quote.asOf))}` : "尚無 as-of 時間"} · ${escape(String(quote.freshness || "unknown"))}</small></article>`).join("")}</div>`
      : "";
    const eventMarkup = events.length
      ? `<div class="investment-event-list">${events.map(event => `<article><header><span>${escape(String(event.type || "市場事件"))}</span><time>${escape(String(event.occurredAt || event.observedAt || ""))}</time></header><strong>${escape(String(event.title || "未命名事件"))}</strong><p>${escape(String(event.summary || "尚無摘要"))}</p><small>${escape(String(event.source || "無來源"))} · ${escape(String(event.freshness || "unknown"))}</small></article>`).join("")}</div>`
      : `<div class="investment-panel-empty" data-investment-state="pending"><strong>新聞／搜尋目前不可用</strong><small>未取得可驗證的 Provider evidence；不顯示猜測資料。</small></div>`;
    return `${quoteMarkup}${eventMarkup}`;
  }

  const ANALYSIS_STATUS_LABELS = Object.freeze({
    AVAILABLE: "已有可驗證資料",
    PARTIAL: "部分資料可用",
    INSUFFICIENT_EVIDENCE: "資料還不夠",
    NOT_SELECTED: "尚未指定分析角度",
    UNKNOWN: "暫時無法判定"
  });

  const ANALYSIS_SECTION_LABELS = Object.freeze({
    marketPhase: "市場階段",
    technical: "行情與技術觀察",
    fundamental: "基本面",
    relationships: "產業／相關標的",
    strategyLibrary: "策略 Evidence"
  });

  const MISSING_LABELS = Object.freeze({
    latest_quote: "最新行情",
    usd_twd_benchmark: "USD/TWD 匯率",
    news_search: "新聞／搜尋資料",
    historical_ohlc_or_indicators: "歷史行情",
    fundamental_evidence: "基本面資料",
    relationship_evidence: "產業／相關標的資料",
    market_phase: "市場階段"
  });

  function analysisStatusLabel(status) {
    return ANALYSIS_STATUS_LABELS[String(status || "UNKNOWN")] || "暫時無法判定";
  }

  function analysisStatusClass(status) {
    return String(status || "UNKNOWN").toLowerCase().replace(/_/g, "-");
  }

  function uniqueStrings(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean)));
  }

  function missingLabel(value) {
    const raw = String(value || "").trim();
    return MISSING_LABELS[raw] || raw.replace(/_/g, " ");
  }

  function sectionStatus(section) {
    return String(section?.status || "UNKNOWN");
  }

  function phaseLabel(phase) {
    return {
      OPEN: "交易中",
      PRE_OPEN: "開盤前",
      POST_CLOSE: "收盤後",
      CLOSED: "已收盤",
      UNKNOWN: "未知"
    }[String(phase || "").toUpperCase()] || String(phase || "未知");
  }

  function symbolName(state, symbol) {
    const normalized = String(symbol || "").toUpperCase();
    const rows = [
      ...(Array.isArray(state.positions) ? state.positions : []),
      ...(Array.isArray(state.watchlist) ? state.watchlist : [])
    ];
    const row = rows.find(item => String(item?.symbol || "").toUpperCase() === normalized);
    return String(row?.name || normalized || "未命名標的");
  }

  function contextForAnalysis(contexts, analysis) {
    const symbol = String(analysis?.symbol || "").toUpperCase();
    return (Array.isArray(contexts) ? contexts : []).find(item => String(item?.symbol || "").toUpperCase() === symbol) || {};
  }

  function positionForSymbol(state, symbol) {
    const normalized = String(symbol || "").toUpperCase();
    return (Array.isArray(state.positions) ? state.positions : []).find(item => String(item?.symbol || "").toUpperCase() === normalized && Number(item?.quantity || 0) > 0) || null;
  }

  function renderAnalysisEvidence(evidence, escape) {
    const items = (Array.isArray(evidence) ? evidence : []).filter(Boolean).slice(0, 12);
    if (!items.length) return `<p class="investment-analysis-detail-empty">目前沒有可展開的 Evidence。</p>`;
    return `<div class="investment-analysis-evidence-list">${items.map(item => {
      const freshness = String(item.freshness || item.quality || "unknown");
      const freshnessLabel = item.stale === true || freshness === "stale" ? "較舊資料" : freshness === "fresh" ? "新鮮資料" : freshness;
      const facts = Array.isArray(item.facts) && item.facts.length
        ? `<small class="investment-analysis-facts">${escape(item.facts.slice(0, 8).join(" · "))}</small>`
        : "";
      return `<article><header><strong>${escape(item.title || item.type || "Evidence")}</strong><span>${escape(freshnessLabel)}</span></header><p>${escape(item.summary || "已取得來源資料，但沒有額外摘要。")}</p><small>${escape(item.source || "來源未提供")} · ${escape(item.observedAt || "as-of 未提供")}</small>${facts}</article>`;
    }).join("")}</div>`;
  }

  function renderAnalysisDetail(analysis, context, escape) {
    const sectionKeys = ["marketPhase", "technical", "fundamental", "relationships", "strategyLibrary"];
    const sections = sectionKeys.map(key => {
      const section = analysis?.[key] || {};
      const status = sectionStatus(section);
      const label = ANALYSIS_SECTION_LABELS[key];
      const detail = section.summary || (status === "INSUFFICIENT_EVIDENCE" ? "目前資料還不夠，諸葛暫時不判斷。" : "狀態已回報，但沒有額外說明。");
      return `<div class="investment-analysis-detail-row"><span>${escape(label)}</span><strong class="is-${escape(analysisStatusClass(status))}">${escape(analysisStatusLabel(status))}</strong><p>${escape(detail)}</p></div>`;
    }).join("");
    const missing = uniqueStrings([
      ...(Array.isArray(context?.missing) ? context.missing : []),
      ...sectionKeys.flatMap(key => Array.isArray(analysis?.[key]?.missing) ? analysis[key].missing : [])
    ]);
    const missingMarkup = missing.length
      ? `<div class="investment-analysis-missing"><strong>目前還缺少</strong><span>${escape(missing.map(missingLabel).join("、"))}</span><small>資料不足時不補猜結論。</small></div>`
      : `<div class="investment-analysis-missing is-complete"><strong>目前沒有已知缺口</strong><span>仍只呈現 Evidence，不自動產生買賣建議。</span></div>`;
    return `<div class="investment-analysis-detail-grid">${sections}</div>${missingMarkup}<div><strong class="investment-analysis-subheading">來源 Evidence</strong>${renderAnalysisEvidence(context?.evidence, escape)}</div>`;
  }

  function renderLiveAnalysisCards(state, escape) {
    const intelligence = state.intelligence || {};
    const contexts = Array.isArray(intelligence.contexts) ? intelligence.contexts : [];
    const analyses = Array.isArray(intelligence.analyses) && intelligence.analyses.length
      ? intelligence.analyses
      : contexts.map(item => item.analysis).filter(Boolean);
    if (!analyses.length) return "";
    const cards = analyses.filter(Boolean).slice(0, 6).map(analysis => {
      const context = contextForAnalysis(contexts, analysis);
      const symbol = String(analysis.symbol || context.symbol || "").toUpperCase();
      const quote = (Array.isArray(context.evidence) ? context.evidence : []).find(item => item?.type === "market_quote");
      const news = (Array.isArray(context.evidence) ? context.evidence : []).filter(item => item?.type === "news");
      const position = positionForSymbol(state, symbol);
      const freshness = quote?.stale === true || quote?.freshness === "stale" ? "較舊但可追溯" : quote?.available ? "最新可用" : "目前沒有行情";
      const happened = quote?.available
        ? `${symbol} 有${freshness}行情${quote.price !== undefined && quote.price !== null ? `（${quote.price} ${quote.currency || ""}）` : ""}。`
        : `${symbol} 目前沒有可驗證的最新行情。`;
      const marketPhase = context.marketPhase?.phase;
      const happenedWithPhase = marketPhase ? `${happened} 市場目前為「${phaseLabel(marketPhase)}」。` : happened;
      const impact = position
        ? `這是你目前的持有標的；資料會用來補充既有持有損益的閱讀脈絡，不會改寫交易或持倉。`
        : `目前沒有讀到你的持有部位，先作研究參考，不替你做投資決定。`;
      const missing = uniqueStrings([
        ...(Array.isArray(context.missing) ? context.missing : []),
        ...(Array.isArray(analysis.limitations) && sectionStatus(analysis) === "INSUFFICIENT_EVIDENCE" ? ["additional_evidence"] : [])
      ]);
      const observe = missing.length
        ? `接下來觀察${missing.map(missingLabel).join("、")}是否補齊；目前資料還不夠，諸葛暫時不判斷。`
        : news.length
          ? `接下來觀察行情與${news.length}筆消息 Evidence 是否持續更新；目前不自動產生買賣建議。`
          : "接下來觀察行情與資料更新；目前不自動產生買賣建議。";
      const status = String(analysis.status || "UNKNOWN");
      return `<article class="investment-analysis-card" data-investment-analysis-symbol="${escape(symbol)}"><header><div><span class="investment-analysis-market">${escape(analysis.market || context.market || "")}</span><h3>${escape(symbolName(state, symbol))} <small>${escape(symbol)}</small></h3></div><span class="investment-analysis-status is-${escape(analysisStatusClass(status))}">${escape(analysisStatusLabel(status))}</span></header><div class="investment-analysis-summary"><div><strong>發生什麼？</strong><p>${escape(happenedWithPhase)}</p></div><div><strong>對我有什麼影響？</strong><p>${escape(impact)}</p></div><div><strong>接下來觀察什麼？</strong><p>${escape(observe)}</p></div></div><details class="investment-analysis-why"><summary>為什麼？<span>查看資料來源與限制</span></summary>${renderAnalysisDetail(analysis, context, escape)}</details></article>`;
    }).join("");
    return `<div class="investment-analysis-consumer" data-investment-analysis-consumer><div class="investment-analysis-consumer-heading"><div><strong>即時軍師分析</strong><small>諸葛只整理已取得的 Evidence；資料不足時不補猜。</small></div><span>${analyses.length} 個標的</span></div><div class="investment-analysis-card-list">${cards}</div></div>`;
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
    const liveMarkup = renderLiveAnalysisCards(state, escape);
    const recordsMarkup = records.length
      ? `<div class="investment-advisor-records"><div class="investment-analysis-consumer-heading"><div><strong>已保存的決策紀錄</strong><small>保留既有 Strategy Decision Record；即時 Analysis 不會自動寫入。</small></div></div>${records.map(record => `<article><header><strong>${escape(record.title || "投資策略")}</strong><span>${escape(record.decision || "觀望")}</span></header><div><small>Evidence</small><p>${escape(record.evidence || "尚無 Evidence")}</p></div><div><small>Reason</small><p>${escape(record.reason || "尚無推理紀錄")}</p></div><small>更新：${escape(format.date(record.updatedAt))}</small></article>`).join("")}</div>`
      : "";
    const emptyMarkup = liveMarkup || recordsMarkup
      ? ""
      : `<div class="investment-panel-empty" data-investment-state="pending"><strong>目前沒有可供分析的 Evidence</strong><small>沒有可信資料時，諸葛先生不產生 Recommendation；User Decision 永遠保留給使用者。</small></div>`;
    return `<div class="investment-advisor-flow">${flow.map(([title, description], index) => `<div class="investment-advisor-step"><b>${index + 1}</b><span><strong>${title}</strong><small>${description}</small></span></div>`).join("")}</div>${liveMarkup}${recordsMarkup}${emptyMarkup}`;
  }

  function renderImportantHoldings(state, dependencies) {
    const positions = (Array.isArray(state.positions) ? state.positions : [])
      .filter(position => position.positionStatus !== "history" && Number(position.quantity || 0) > 0)
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
    const hasPositions = positions.some(position => position.positionStatus !== "history" && Number(position.quantity || 0) > 0);
    const hasTotalReturn = Boolean(state.performance?.totalReturn && Array.isArray(state.performance.totalReturn.values) && state.performance.totalReturn.values.length);
    const positionCount = hasPositions ? `${summary.assetCount} 筆持倉已讀回` : "尚未讀回持倉";
    return `<section class="investment-command-center" data-investment-command-center data-investment-readonly="true">
      <div class="investment-page-heading"><div><p class="investment-eyebrow">Investment Command Center</p><h1>投資首頁</h1><p>先看今天值得注意的事，再看投資狀況與持股變化。</p></div><div class="investment-command-heading-actions"><span class="investment-pill">資料來源：Investment Cloud（唯讀）</span><button class="investment-refresh" type="button" data-investment-refresh>重新整理</button></div></div>

      <div class="investment-command-grid investment-command-grid-top">
        <article class="investment-command-panel investment-focus-panel" data-investment-section="today-focus"><header class="investment-panel-heading"><div><p class="investment-eyebrow">01 · 今日軍令</p><h2>今天我的投資發生什麼事情？</h2><p>只呈現有可信資料支撐的事項。</p></div><span class="investment-panel-status is-pending">待建立</span></header>${renderTodayFocus(state, escape)}</article>
        <article class="investment-command-panel investment-advisor-panel" data-investment-section="advisor"><header class="investment-panel-heading"><div><p class="investment-eyebrow">05 · 諸葛先生</p><h2>投資決策區</h2><p>先看發生什麼、對你的影響與接下來觀察什麼；不替使用者下決定。</p></div><span class="investment-panel-status ${Array.isArray(state.intelligence?.analyses) && state.intelligence.analyses.length ? "is-ready" : "is-pending"}">${Array.isArray(state.intelligence?.analyses) && state.intelligence.analyses.length ? "即時 Evidence" : "等待 Evidence"}</span></header>${renderAdvisor(state, escape, format)}</article>
      </div>

      <section class="investment-kpi-section" data-investment-section="core-kpi"><header class="investment-panel-heading"><div><p class="investment-eyebrow">02 · 投資核心 KPI</p><h2>我現在的投資狀況如何？</h2><p>${positionCount}；不跨幣別硬湊單一數字。</p></div><span class="investment-panel-status ${hasPositions ? "is-ready" : "is-pending"}">${hasPositions ? "可計算" : "資料不足"}</span></header><div class="investment-kpi-grid">
        ${renderMetric("invested-cost", "總投入成本", currencyValues(summary, "cost", format, false, state.intelligence?.fx), "依目前已讀回的持倉成本計算；USD 同時顯示約 NT$，不改變原始幣別。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("market-value", "目前市值", currencyValues(summary, "value", format, false, state.intelligence?.fx), "由最新可用行情更新既有持倉計算結果；USD 同時顯示約 NT$。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("unrealized-pnl", "我的損益／未實現損益", currencyValues(summary, "pnl", format, true, state.intelligence?.fx), "依唯一 Investment Current Position calculation result 計算。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("realized-pnl", "已實現損益", currencyValues(summary, "realizedPnl", format, false, state.intelligence?.fx), "依交易紀錄與移動加權平均成本法計算；不倒推 Opening Baseline 以前的歷史交易。", positions.length ? "available" : "unavailable")}
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
