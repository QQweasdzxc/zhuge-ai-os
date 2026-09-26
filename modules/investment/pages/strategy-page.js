(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function statusLabel(status) {
    return {
      READY: "資料足夠",
      PARTIAL: "部分資料",
      INSUFFICIENT_EVIDENCE: "資料不足",
      NOT_SELECTED: "尚未指定策略",
      UNKNOWN: "無法確認"
    }[String(status || "").toUpperCase()] || "尚未讀取";
  }

  function renderRuntimeReadiness(state = {}, dependencies = {}) {
    const escape = typeof dependencies.escape === "function" ? dependencies.escape : value => String(value == null ? "" : value);
    const intelligence = state.intelligence || {};
    const scans = Array.isArray(intelligence.strategyScans) ? intelligence.strategyScans : [];
    const packs = Array.isArray(intelligence.homeworkPacks) ? intelligence.homeworkPacks : [];
    const rows = scans.map((scan, index) => {
      const pack = packs[index] || {};
      const matches = Array.isArray(scan.matches) ? scan.matches : [];
      const missing = Array.isArray(scan.insufficientEvidence) ? scan.insufficientEvidence : [];
      return `<article class="investment-strategy-runtime-row" data-investment-strategy-runtime-symbol="${escape(scan.symbol || pack.symbol || "")}"><header><div><span class="investment-eyebrow">${escape(scan.market || pack.market || "")}</span><strong>${escape(scan.symbol || pack.symbol || "未命名標的")}</strong></div><span class="investment-strategy-runtime-status is-${escape(String(scan.status || "unknown").toLowerCase())}">${escape(statusLabel(scan.status))}</span></header><div class="investment-strategy-runtime-matches">${matches.length ? matches.map(item => `<span>${escape(item.name || item.id || "策略")}：${escape(statusLabel(item.status))}</span>`).join("") : "<span>目前沒有指定策略。</span>"}</div>${missing.length ? `<p class="investment-strategy-runtime-missing">${escape(missing.slice(0, 3).join("；"))}</p>` : `<p class="investment-strategy-runtime-missing">已沿用既有 Evidence；請查看標的研究中的「為什麼？」。</p>`}</article>`;
    }).join("");
    const empty = `<div class="investment-strategy-runtime-empty zhuge-state" data-zhuge-state="empty"><strong>尚未有即時策略掃描</strong><small>先從「個股研究」取得標的 Evidence；這裡只顯示既有 Context Pack 的唯讀整理。</small></div>`;
    return `<section class="investment-strategy-runtime" data-investment-strategy-runtime><div class="investment-panel-heading"><div><p class="investment-eyebrow">Runtime Evidence · Read-only</p><h2>目前研究中的策略狀態</h2><p>只讀取 Context Pack → Analysis → Strategy Scanner；不建立策略紀錄、不產生外部分數。</p></div><span class="investment-pill">${scans.length} 個標的</span></div>${rows || empty}</section>`;
  }

  function rate(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
  }

  function returnValue(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "—";
  }

  function volumeStatusLabel(status) {
    return {
      AVAILABLE: "已有完成樣本",
      PARTIAL: "部分樣本",
      INSUFFICIENT_EVIDENCE: "資料不足",
      INVALID_INPUT: "資料格式無法確認"
    }[String(status || "").toUpperCase()] || "尚未讀取";
  }

  function renderVolumeConfirmation(state = {}, dependencies = {}) {
    const escape = typeof dependencies.escape === "function" ? dependencies.escape : value => String(value == null ? "" : value);
    const rows = Array.isArray(state.intelligence?.volumeConfirmations) ? state.intelligence.volumeConfirmations : [];
    const markup = rows.map(item => {
      const metrics = item.metrics || {};
      const patterns = item.patternCounts || {};
      const evidence = Array.isArray(item.evidence) ? item.evidence[0] : {};
      const status = String(item.status || "INSUFFICIENT_EVIDENCE").toLowerCase();
      return `<article class="investment-volume-confirmation-row" data-investment-volume-confirmation-symbol="${escape(item.symbol || "")}"><header><div><span class="investment-eyebrow">${escape(item.market || "")} · ${escape(item.symbol || "未命名標的")}</span><strong>量價確認／量進價弱</strong></div><span class="investment-strategy-runtime-status is-${escape(status)}">${escape(volumeStatusLabel(item.status))}</span></header><div class="investment-volume-patterns"><span>量價確認：${escape(String(patterns.bullish || 0))}</span><span>量進價弱：${escape(String(patterns.bearish || 0))}</span><span>平盤：${escape(String(patterns.flat || 0))}</span></div><div class="investment-volume-metrics"><span>樣本 ${escape(String(metrics.sampleCount ?? 0))}</span><span>上漲 ${escape(rate(metrics.upRate))}</span><span>下跌 ${escape(rate(metrics.downRate))}</span><span>持有期 ${escape(String(metrics.holdingHorizonBars || "—"))} 根</span><span>平均 ${escape(returnValue(metrics.avgReturn))}</span><span>中位數 ${escape(returnValue(metrics.medianReturn))}</span><span>最大不利 ${escape(returnValue(metrics.maxAdverseExcursion))}</span></div><p class="investment-strategy-runtime-missing">${escape(item.warnings?.[0] || evidence?.limitations?.[0] || "訊號在確認 K 棒收盤後，從下一根 K 棒開盤計算；不產生買賣建議。")}</p><small class="investment-volume-source">${escape(evidence?.source || item.source || "來源未提供")} · as-of ${escape(evidence?.observedAt || item.asOf || "未知")} · retrieved ${escape(evidence?.retrievedAt || item.retrievedAt || "未知")} · ${escape(item.freshness || "unknown")}</small></article>`;
    }).join("");
    const empty = `<div class="investment-strategy-runtime-empty zhuge-state" data-zhuge-state="empty"><strong>尚未有量價確認樣本</strong><small>需要含成交量的歷史 OHLCV；資料不足時諸葛不補猜。</small></div>`;
    return `<section class="investment-volume-confirmation" data-investment-volume-confirmation><div class="investment-panel-heading"><div><p class="investment-eyebrow">Evidence Factor · Read-only</p><h2>量價確認／量進價弱</h2><p>量縮後觀察下一交易日是否量增及收盤方向；門檻可設定並保留來源。歷史樣本不是買賣建議。</p></div><span class="investment-pill">${rows.length} 個標的</span></div>${markup || empty}</section>`;
  }

  function render(state, dependencies = {}) {
    const { escape, format } = dependencies;
    const cards = state.strategies.map(strategy => `<article class="investment-strategy-card"><header><div><p class="investment-eyebrow">決策紀錄</p><h2>${escape(strategy.title)}</h2></div><span>${escape(strategy.decision)}</span></header><div class="investment-reasoning"><div><strong>依據</strong><p>${escape(strategy.evidence)}</p></div><div><strong>理由</strong><p>${escape(strategy.reason)}</p></div><div><strong>決策</strong><p>${escape(strategy.decision)}</p></div></div><small>更新：${escape(format.date(strategy.updatedAt))}</small></article>`).join("");
    const library = dependencies.strategyLibrary?.list?.() || [];
    const skills = library.map(skill => `<article class="investment-strategy-skill"><div><span>${escape(skill.category)}</span><strong>${escape(skill.name)}</strong></div><p>${escape(skill.description)}</p></article>`).join("");
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">投資策略</p><h1>策略與決策</h1><p>保留每次判斷的依據、理由與最後決策；策略庫提供諸葛研究時可組合的分析角度。</p></div></div>${renderRuntimeReadiness(state, dependencies)}${renderVolumeConfirmation(state, dependencies)}<section class="investment-strategy-library"><div class="investment-panel-heading"><div><p class="investment-eyebrow">Zhuge Strategy Library · Phase 1</p><h2>諸葛策略庫</h2><p>先建立策略能力目錄；後續接上行情、新聞與 Evidence Context 後，由諸葛依問題選擇一種或多種策略交叉研究。</p></div><span class="investment-pill">${library.length} 種</span></div><div class="investment-strategy-skill-grid">${skills}</div></section><div class="investment-strategy-list">${cards || '<div class="investment-empty-state">目前尚無策略或決策紀錄。</div>'}</div></section>`;
  }

  return Object.freeze({ render, renderRuntimeReadiness, renderVolumeConfirmation });
});
