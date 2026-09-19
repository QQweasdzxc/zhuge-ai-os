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

  function renderMetric(id, label, value, note, state = "available", variant = "") {
    const variantClass = variant ? ` investment-command-kpi-${variant}` : "";
    return `<article class="investment-command-kpi${variantClass} ${state === "unavailable" ? "is-unavailable" : ""}" data-investment-kpi="${id}"><header><small>${label}</small><span>${state === "unavailable" ? "資料不足" : "Cloud Read-only"}</span></header>${value}<p>${note}</p></article>`;
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
    NOT_APPLICABLE: "目前不適用",
    UNKNOWN: "暫時無法判定"
  });

  const ANALYSIS_SECTION_LABELS = Object.freeze({
    marketPhase: "市場階段",
    technical: "行情與技術觀察",
    fundamental: "基本面",
    relationships: "產業／相關標的",
    strategyLibrary: "策略 Evidence",
    decisionZones: "買點／賣點／策略區間",
    portfolioRisk: "我的持有曝險",
    evidenceConfidence: "Evidence 信心"
  });

  const MISSING_LABELS = Object.freeze({
    latest_quote: "最新行情",
    usd_twd_benchmark: "USD/TWD 匯率",
    news_search: "新聞／搜尋資料",
    historical_ohlc_or_indicators: "歷史行情",
    fundamental_evidence: "基本面資料",
    relationship_evidence: "產業／相關標的資料",
    market_phase: "市場階段",
    strategy_evidence: "策略所需 Evidence",
    explicit_decision_zone: "明確策略區間資料",
    market_value: "持倉市值",
    industry_exposure: "產業曝險資料",
    additional_evidence: "更多分析 Evidence"
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

  function renderAnalysisList(title, items, escape, emptyText = "目前沒有可列出的項目。") {
    const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
    return `<div class="investment-analysis-factor-group"><strong>${escape(title)}</strong>${values.length ? `<ul>${values.map(item => `<li>${escape(item)}</li>`).join("")}</ul>` : `<p>${escape(emptyText)}</p>`}</div>`;
  }

  function renderAnalysisExtras(analysis, escape) {
    const zones = analysis?.decisionZones || {};
    const zoneRows = [zones.buyPoint, zones.sellPoint, zones.strategyRange].filter(Boolean).map(zone => {
      const status = sectionStatus(zone);
      const value = zone.value || (status === "INSUFFICIENT_EVIDENCE" ? "資料不足，不產生價格區間" : "尚未提供可驗證區間");
      const conditions = Array.isArray(zone.conditions) && zone.conditions.length ? `；觀察條件：${zone.conditions.join("、")}` : "";
      return `<div class="investment-analysis-detail-row"><span>${escape(zone.label || "策略區間")}</span><strong class="is-${escape(analysisStatusClass(status))}">${escape(value)}</strong><p>${escape(conditions || (status === "AVAILABLE" ? "由明確 Evidence 提供。" : "不由單一價格或指標自行推導。"))}</p></div>`;
    }).join("");
    const risk = analysis?.portfolioRisk || {};
    const concentration = Array.isArray(risk.concentration?.byCurrency) ? risk.concentration.byCurrency : [];
    const marketExposure = Array.isArray(risk.marketExposure) ? risk.marketExposure : [];
    const industryExposure = Array.isArray(risk.industryExposure) ? risk.industryExposure : [];
    const exposureMarkup = [...concentration, ...marketExposure, ...industryExposure].slice(0, 12).map(item => {
      const weight = item.weight === null || item.weight === undefined ? "未知" : `${(Number(item.weight) * 100).toFixed(1)}%`;
      return `<li>${escape(item.key || item.symbol || "曝險")}：${escape(weight)}${item.currency ? `（${escape(item.currency)}）` : ""}</li>`;
    }).join("");
    const confidence = analysis?.confidence || {};
    const confidenceSummary = confidence.score === null || confidence.score === undefined
      ? "目前沒有足夠 Evidence 形成可追溯信心評估。"
      : `${confidence.score}/100（${confidence.level || "UNKNOWN"}）；這是 Evidence 覆蓋度，不是獲利機率。`;
    const factors = Array.isArray(confidence.reasons) ? confidence.reasons : [];
    const synthesis = analysis?.strategySynthesis || analysis?.strategyLibrary?.synthesis || {};
    return `${zones.status ? `<div class="investment-analysis-detail-grid"><div class="investment-analysis-detail-row"><span>${escape(ANALYSIS_SECTION_LABELS.decisionZones)}</span><strong class="is-${escape(analysisStatusClass(zones.status))}">${escape(analysisStatusLabel(zones.status))}</strong><p>${escape(zones.summary || "不產生未經證明的買賣點。")}</p></div>${zoneRows}</div>` : ""}
      <div class="investment-analysis-extra-block">${risk.status ? `<div class="investment-analysis-detail-row"><span>${escape(ANALYSIS_SECTION_LABELS.portfolioRisk)}</span><strong class="is-${escape(analysisStatusClass(risk.status))}">${escape(analysisStatusLabel(risk.status))}</strong><p>${escape(risk.summary || "目前沒有可呈現的持有曝險。")}</p></div>` : ""}${exposureMarkup ? `<ul class="investment-analysis-exposure-list">${exposureMarkup}</ul>` : ""}${Array.isArray(risk.signals) && risk.signals.length ? renderAnalysisList("目前可觀察的風險訊號", risk.signals, escape) : ""}${Array.isArray(risk.missing) && risk.missing.length ? `<p class="investment-analysis-detail-empty">尚缺：${escape(risk.missing.join("、"))}</p>` : ""}</div>
      <div class="investment-analysis-extra-block"><div class="investment-analysis-detail-row"><span>${escape(ANALYSIS_SECTION_LABELS.evidenceConfidence)}</span><strong class="is-${escape(analysisStatusClass(confidence.status))}">${escape(confidenceSummary)}</strong><p>由 Evidence 完整度、新鮮度、Provider 品質與資料一致性形成。</p></div>${factors.length ? renderAnalysisList("信心依據", factors, escape) : ""}</div>
      <div class="investment-analysis-extra-block">${synthesis.status ? `<div class="investment-analysis-detail-row"><span>多策略綜合研判</span><strong class="is-${escape(analysisStatusClass(synthesis.status))}">${escape(analysisStatusLabel(synthesis.status))}</strong><p>${escape(synthesis.summary || "不替使用者選單一策略。")}</p></div>${renderAnalysisList("支持因素", synthesis.supportingFactors, escape)}${renderAnalysisList("反對因素", synthesis.opposingFactors, escape)}${renderAnalysisList("接下來觀察的條件", synthesis.watchConditions, escape)}${renderAnalysisList("資料不足", synthesis.insufficientEvidence, escape)}${renderAnalysisList("策略衝突", synthesis.conflicts, escape, "目前沒有偵測到方向衝突。")}` : ""}</div>`;
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
      ...sectionKeys.flatMap(key => Array.isArray(analysis?.[key]?.missing) ? analysis[key].missing : []),
      ...(Array.isArray(analysis?.decisionZones?.missing) ? analysis.decisionZones.missing : []),
      ...(Array.isArray(analysis?.portfolioRisk?.missing) ? analysis.portfolioRisk.missing : [])
    ]);
    const missingMarkup = missing.length
      ? `<div class="investment-analysis-missing"><strong>目前還缺少</strong><span>${escape(missing.map(missingLabel).join("、"))}</span><small>資料不足時不補猜結論。</small></div>`
      : `<div class="investment-analysis-missing is-complete"><strong>目前沒有已知缺口</strong><span>仍只呈現 Evidence，不自動產生買賣建議。</span></div>`;
    return `<div class="investment-analysis-detail-grid">${sections}</div>${missingMarkup}${renderAnalysisExtras(analysis, escape)}<div><strong class="investment-analysis-subheading">來源 Evidence</strong>${renderAnalysisEvidence(context?.evidence, escape)}</div>`;
  }

  function renderLiveAnalysisCards(state, escape, heading = "即時軍師分析") {
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
    return `<div class="investment-analysis-consumer" data-investment-analysis-consumer><div class="investment-analysis-consumer-heading"><div><strong>${escape(heading)}</strong><small>諸葛只整理已取得的 Evidence；資料不足時不補猜。</small></div><span>${analyses.length} 個標的</span></div><div class="investment-analysis-card-list">${cards}</div></div>`;
  }

  function renderResearchMeta(result, escape) {
    const context = Array.isArray(result?.contexts) ? result.contexts[0] : null;
    const analysis = Array.isArray(result?.analyses) ? result.analyses[0] : context?.analysis;
    if (!context && !analysis) return "";
    const sectionStatusText = section => {
      const status = String(section?.status || "UNKNOWN");
      return `${analysisStatusLabel(status)} (${status})`;
    };
    return `<div class="investment-research-meta" data-investment-research-evidence-meta><span>Context Pack：${escape(context?.contract || "UNKNOWN")}</span><span>Analysis：${escape(analysis?.contract || "UNKNOWN")}</span><span>基本面 Evidence：${escape(sectionStatusText(analysis?.fundamental))}</span><span>ETF／產業／相關 Evidence：${escape(sectionStatusText(analysis?.relationships))}</span></div>`;
  }

  function renderResearchSurface(state, escape) {
    const research = state.research || {};
    const request = research.request || {};
    const busy = research.status === "loading";
    const result = research.result;
    const resultMarkup = result
      ? renderLiveAnalysisCards({ ...state, intelligence: result }, escape, "標的研究結果")
      : research.status === "loading"
        ? `<div class="investment-panel-empty" data-investment-research-state="loading"><strong>正在整理標的 Evidence…</strong><small>依序取得行情、基本面、ETF／產業／相關標的與分析結果。</small></div>`
        : research.status === "error"
          ? `<div class="investment-panel-empty" data-investment-research-state="error"><strong>標的研究暫時無法讀取</strong><small>${escape(research.error || "目前沒有可用的研究結果，請稍後再試。")}</small></div>`
          : `<div class="investment-panel-empty" data-investment-research-state="idle"><strong>輸入代號開始研究</strong><small>例如 2330、0050 或 AAPL；資料不足時會明確顯示 INSUFFICIENT_EVIDENCE。</small></div>`;
    const status = research.status === "ready"
      ? "已讀回"
      : research.status === "loading"
        ? "讀取中"
        : research.status === "error"
          ? "讀取失敗"
          : "待查詢";
    return `<article id="investment-section-research" class="investment-command-panel investment-research-panel" data-investment-section="research"><header class="investment-panel-heading"><div><p class="investment-eyebrow">07 · 個股研究</p><h2>查詢一個標的</h2><p>沿用既有 Evidence → Context Pack → Analysis；不修改持倉、交易或策略紀錄。</p></div><span class="investment-panel-status ${research.status === "ready" ? "is-ready" : "is-pending"}">${status}</span></header><form class="investment-research-form" data-investment-research-form><label><span>股票／ETF 代號</span><input name="symbol" value="${escape(String(research.query || ""))}" placeholder="2330／0050／AAPL" autocomplete="off" maxlength="16" required ${busy ? "disabled" : ""}></label><label><span>市場</span><select name="market" ${busy ? "disabled" : ""}><option value="AUTO" ${!request.market ? "selected" : ""}>自動判定</option><option value="TW" ${request.market === "TW" ? "selected" : ""}>台股／ETF</option><option value="US" ${request.market === "US" ? "selected" : ""}>美股</option></select></label><button type="submit" ${busy ? "disabled" : ""}>${busy ? "查詢中…" : "開始研究"}</button></form>${renderResearchMeta(result, escape)}${resultMarkup}</article>`;
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

  function renderTodayPnl(state, escape, format) {
    const value = state.performance?.todayPnl ?? state.performance?.dailyPnl;
    const values = Array.isArray(value?.values) ? value.values : [];
    if (values.length) {
      return `<div class="investment-kpi-amounts">${values.map(item => `<span><b>${escape(String(item.value ?? "—"))}</b><small>${escape(String(item.currency || ""))}</small></span>`).join("")}</div>`;
    }
    if (Number.isFinite(Number(value))) {
      const currency = String(state.performance?.todayPnlCurrency || "TWD");
      const formatted = typeof format.currency === "function" ? format.currency(Number(value), currency) : `${currency} ${Number(value)}`;
      return `<div class="investment-kpi-amounts"><span><b>${escape(formatted)}</b><small>${escape(currency)}</small></span></div>`;
    }
    return `<div class="investment-kpi-unavailable"><strong>資料不足</strong><small>目前沒有 canonical 今日損益結果；不以未實現損益代替。</small></div>`;
  }

  function hasTodayPnlEvidence(state) {
    const value = state.performance?.todayPnl ?? state.performance?.dailyPnl;
    return Array.isArray(value?.values) && value.values.length || Number.isFinite(Number(value));
  }

  function renderWatchlistPreview(state, dependencies) {
    const escape = dependencies.escape;
    const format = dependencies.format || {};
    const items = Array.isArray(state.watchlist) ? state.watchlist.slice(0, 4) : [];
    const quotes = Array.isArray(state.intelligence?.quotes) ? state.intelligence.quotes : [];
    if (!items.length) {
      return `<div class="investment-panel-empty" data-investment-state="empty"><strong>目前沒有觀察股</strong><small>觀察股與實際持股分開保存；加入後會在這裡顯示變化與觀察原因。</small></div>`;
    }
    const cards = items.map(item => {
      const symbol = String(item.symbol || "").toUpperCase();
      const quote = quotes.find(row => String(row?.symbol || "").toUpperCase() === symbol && String(row?.market || "").toUpperCase() === String(item.market || "").toUpperCase());
      const hasQuote = quote?.available === true && Number.isFinite(Number(quote.price));
      const price = hasQuote && typeof format.number === "function" ? format.number(Number(quote.price)) : hasQuote ? String(quote.price) : "行情待讀回";
      const change = Number.isFinite(Number(quote?.changePercent))
        ? `${Number(quote.changePercent) >= 0 ? "+" : ""}${Number(quote.changePercent).toFixed(2)}%`
        : "變化待 Evidence";
      const freshness = quote?.freshness ? ` · ${quote.freshness}` : "";
      return `<article class="investment-watchlist-preview-card"><header><div><strong>${escape(symbol || "未命名標的")}</strong><small>${escape(item.name || item.market || "觀察標的")}</small></div><span>${escape(item.status || "觀察中")}</span></header><div class="investment-watchlist-preview-value"><b>${escape(price)}</b><small>${escape(change)}${escape(freshness)}</small></div><p>${escape(item.reason || item.theme || "尚未記錄觀察原因")}</p></article>`;
    }).join("");
    return `<div class="investment-watchlist-preview-grid">${cards}</div><p class="investment-readonly-note">只顯示已讀回的行情與觀察資料；沒有 Evidence 時保留「待讀回」，不補猜。</p>`;
  }

  function render(state, dependencies = {}) {
    const { format, calculation, escape } = dependencies;
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const summary = calculation.summarize(positions);
    const hasPositions = positions.some(position => position.positionStatus !== "history" && Number(position.quantity || 0) > 0);
    const hasTotalReturn = Boolean(state.performance?.totalReturn && Array.isArray(state.performance.totalReturn.values) && state.performance.totalReturn.values.length);
    const hasTodayPnl = hasTodayPnlEvidence(state);
    const hasTodayFocus = Array.isArray(state.todayFocus) && state.todayFocus.length > 0;
    const hasRealtime = (Array.isArray(state.intelligence?.quotes) && state.intelligence.quotes.some(quote => quote?.available)) || (Array.isArray(state.marketEvents) && state.marketEvents.length > 0);
    const positionCount = hasPositions ? `${summary.assetCount} 筆持倉已讀回` : "尚未讀回持倉";
    return `<section class="investment-command-center" data-investment-command-center data-investment-readonly="true">
      <div class="investment-page-heading"><div><p class="investment-eyebrow">Investment Command Center</p><h1>今日軍師</h1><p>先看持股、損益與需要注意的事。</p></div><div class="investment-command-heading-actions"><span class="investment-pill">Investment Cloud · 唯讀</span><button class="investment-refresh" type="button" data-investment-refresh>重新整理</button></div></div>

      <div class="investment-command-grid investment-command-grid-top investment-first-glance">
        <article id="investment-section-today-focus" class="investment-command-panel investment-focus-panel" data-investment-section="today-focus"><header class="investment-panel-heading"><div><p class="investment-eyebrow">01 · 需要注意的事</p><h2>今天有什麼要留意？</h2></div><span class="investment-panel-status ${hasTodayFocus ? "is-ready" : "is-pending"}">${hasTodayFocus ? "已有 Evidence" : "待建立"}</span></header>${renderTodayFocus(state, escape)}</article>
        <section class="investment-command-panel investment-glance-summary" data-investment-section="glance-summary"><header class="investment-panel-heading"><div><p class="investment-eyebrow">02 · 今日總覽</p><h2>我的投資今天怎麼樣？</h2><p>${positionCount}；不跨幣別硬湊單一數字。</p></div><span class="investment-panel-status ${hasPositions ? "is-ready" : "is-pending"}">${hasPositions ? "可計算" : "資料不足"}</span></header><div class="investment-glance-metrics">
          ${renderMetric("market-value", "目前市值", currencyValues(summary, "value", format, false, state.intelligence?.fx), "由最新可用行情更新既有持倉計算結果。", hasPositions ? "available" : "unavailable", "primary")}
          ${renderMetric("unrealized-pnl", "總損益／報酬率", currencyValues(summary, "pnl", format, true, state.intelligence?.fx), "依唯一 Investment Current Position calculation result。", hasPositions ? "available" : "unavailable", "primary")}
          ${renderMetric("today-pnl", "今日變化", renderTodayPnl(state, escape, format), "沒有 canonical 結果時保持資料不足。", hasTodayPnl ? "available" : "unavailable", "primary")}
        </div></section>
      </div>

      <article class="investment-command-panel investment-holdings-panel" data-investment-section="important-holdings"><header class="investment-panel-heading"><div><p class="investment-eyebrow">03 · 我的持股</p><h2>目前持有哪些？</h2><p>先看各持股賺賠；點擊個股再看完整研究。</p></div><button type="button" data-investment-route="portfolio">查看全部 →</button></header>${renderImportantHoldings(state, dependencies)}</article>

      <details class="investment-secondary-layer" data-investment-layer="accounting"><summary><span><strong>更多帳務資訊</strong><small>投入成本、已實現損益、總報酬</small></span><b aria-hidden="true">⌄</b></summary><div class="investment-secondary-layer-content"><section class="investment-kpi-section" data-investment-section="core-kpi"><header class="investment-panel-heading"><div><p class="investment-eyebrow">帳務明細</p><h2>完整投資數字</h2><p>保留原始幣別與既有 canonical calculation result。</p></div><span class="investment-panel-status ${hasPositions ? "is-ready" : "is-pending"}">${hasPositions ? "可計算" : "資料不足"}</span></header><div class="investment-kpi-grid">
        ${renderMetric("invested-cost", "總投入成本", currencyValues(summary, "cost", format, false, state.intelligence?.fx), "依目前已讀回的持倉成本計算；USD 同時顯示約 NT$。", hasPositions ? "available" : "unavailable")}
        ${renderMetric("realized-pnl", "已實現損益", currencyValues(summary, "realizedPnl", format, false, state.intelligence?.fx), "依交易紀錄與移動加權平均成本法計算；不倒推 Opening Baseline 以前的歷史交易。", positions.length ? "available" : "unavailable")}
        ${renderMetric("total-return", "總報酬", renderTotalReturn(state, escape), "目前不具備完整已實現損益與股利 Contract。", hasTotalReturn ? "available" : "unavailable")}
      </div></section></div></details>

      <details class="investment-secondary-layer" data-investment-layer="watchlist-market"><summary><span><strong>觀察股與市場情報</strong><small>觀察變化、行情、新聞與事件</small></span><b aria-hidden="true">⌄</b></summary><div class="investment-secondary-layer-content"><div class="investment-command-grid investment-command-grid-bottom">
        <article id="investment-section-watchlist" class="investment-command-panel investment-watchlist-preview-panel" data-investment-section="watchlist"><header class="investment-panel-heading"><div><p class="investment-eyebrow">04 · 諸葛觀察股</p><h2>與持股分開追蹤</h2><p>顯示觀察原因與已取得的近期變化。</p></div><button type="button" data-investment-route="portfolio" data-investment-focus="watchlist">查看全部 →</button></header>${renderWatchlistPreview(state, dependencies)}</article>
        <article id="investment-section-realtime" class="investment-command-panel investment-realtime-panel" data-investment-section="realtime"><header class="investment-panel-heading"><div><p class="investment-eyebrow">05 · 市場情報</p><h2>市場與事件</h2><p>行情、新聞與事件接通後才會呈現。</p></div><span class="investment-panel-status ${hasRealtime ? "is-ready" : "is-pending"}">${hasRealtime ? "已有可用資料" : "待接通"}</span></header>${renderRealtime(state, escape)}</article>
      </div></div></details>

      <details class="investment-secondary-layer" data-investment-layer="analysis"><summary><span><strong>問軍師與個股研究</strong><small>白話研判、Evidence 與深入分析</small></span><b aria-hidden="true">⌄</b></summary><div class="investment-secondary-layer-content"><article id="investment-section-advisor" class="investment-command-panel investment-advisor-panel" data-investment-section="advisor"><header class="investment-panel-heading"><div><p class="investment-eyebrow">06 · 問軍師</p><h2>投資決策區</h2><p>先看發生什麼、對你的影響與接下來觀察什麼；不替使用者下決定。</p></div><span class="investment-panel-status ${Array.isArray(state.intelligence?.analyses) && state.intelligence.analyses.length ? "is-ready" : "is-pending"}">${Array.isArray(state.intelligence?.analyses) && state.intelligence.analyses.length ? "即時 Evidence" : "等待 Evidence"}</span></header>${renderAdvisor(state, escape, format)}</article>${renderResearchSurface(state, escape)}</div></details>
    </section>`;
  }

  return Object.freeze({ render });
});
