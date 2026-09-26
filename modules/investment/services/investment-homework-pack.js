(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentHomeworkPack = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * A read-only learning/observation projection over the existing Context Pack
   * and Analysis contracts. It never creates a Board task, Strategy Record,
   * score, order, or second source of Investment truth.
   */
  const CONTRACT = "zhuge-investment-homework-pack-v1";
  const STATUS = Object.freeze({
    READY: "READY",
    PARTIAL: "PARTIAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    NOT_SELECTED: "NOT_SELECTED"
  });

  const MISSING_LABELS = Object.freeze({
    latest_quote: "最新行情",
    usd_twd_benchmark: "USD／TWD 匯率",
    news_search: "新聞／事件 Evidence",
    historical_ohlc_or_indicators: "歷史 OHLC／技術指標",
    fundamental_evidence: "基本面 Evidence",
    relationship_evidence: "ETF 成分／產業／相關標的",
    market_phase: "市場階段",
    strategy_evidence: "策略 Evidence",
    additional_evidence: "其他可驗證資料"
  });

  function text(value, max = 500) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function unique(values) {
    return [...new Set(list(values).map(item => text(item)).filter(Boolean))];
  }

  function labelForMissing(value) {
    const key = text(value);
    return MISSING_LABELS[key] || key.replace(/_/g, " ");
  }

  function normalizeEvidence(item = {}) {
    return Object.freeze({
      type: text(item.type, 80) || "evidence",
      title: text(item.title, 240) || "未命名 Evidence",
      source: text(item.source || item.provider, 180) || "未知來源",
      sourceUrl: text(item.sourceUrl || item.source_url, 500),
      observedAt: text(item.observedAt || item.asOf || item.as_of, 80),
      freshness: text(item.freshness, 40) || "unknown",
      stale: item.stale === true,
      quality: text(item.quality, 80) || "unknown",
      available: item.available !== false,
      limitations: Object.freeze(list(item.limitations).map(value => text(value, 240)).filter(Boolean).slice(0, 4))
    });
  }

  function sectionMissing(analysis, keys) {
    return keys.flatMap(key => list(analysis?.[key]?.missing));
  }

  function statusFor(analysis, missing, scan) {
    if (!analysis && !scan) return STATUS.INSUFFICIENT_EVIDENCE;
    const statuses = [analysis?.status, scan?.status].map(value => text(value).toUpperCase()).filter(Boolean);
    if (statuses.includes("INSUFFICIENT_EVIDENCE") && !statuses.some(value => ["AVAILABLE", "READY", "PARTIAL"].includes(value))) {
      return STATUS.INSUFFICIENT_EVIDENCE;
    }
    if (missing.length || statuses.includes("PARTIAL")) return STATUS.PARTIAL;
    if (statuses.includes("NOT_SELECTED")) return STATUS.NOT_SELECTED;
    return STATUS.READY;
  }

  function buildContext(context = {}, options = {}) {
    const analysis = options.analysis || context.analysis || null;
    const scan = options.strategyScan || context.strategyScan || null;
    const evidence = list(context.evidence).map(normalizeEvidence).slice(0, 12);
    const missing = unique([
      ...list(context.missing),
      ...sectionMissing(analysis, ["marketPhase", "technical", "fundamental", "relationships"]),
      ...list(analysis?.decisionZones?.missing),
      ...list(analysis?.portfolioRisk?.missing),
      ...list(scan?.insufficientEvidence)
    ]);
    const supporting = unique([
      ...list(analysis?.strategySynthesis?.supportingFactors),
      ...list(scan?.supportingFactors)
    ]).slice(0, 6);
    const opposing = unique([
      ...list(analysis?.strategySynthesis?.opposingFactors),
      ...list(scan?.opposingFactors)
    ]).slice(0, 6);
    const conflicts = unique([
      ...list(analysis?.strategySynthesis?.conflicts),
      ...list(scan?.conflicts)
    ]).slice(0, 4);
    const watchConditions = unique([
      ...list(analysis?.strategySynthesis?.watchConditions),
      ...list(scan?.watchConditions)
    ]).slice(0, 8);
    const status = statusFor(analysis, missing, scan);
    const openItems = missing.map((item, index) => Object.freeze({
      id: `evidence-${index + 1}-${text(item).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "missing"}`,
      label: labelForMissing(item),
      status: "OPEN",
      reason: `目前缺少${labelForMissing(item)}；不以其他資料補猜。`,
      source: "zhuge-investment-context-pack-v1"
    }));
    const reviewItems = [
      ...supporting.map((item, index) => Object.freeze({ id: `support-${index + 1}`, label: "支持因素", status: "REVIEW", reason: item })),
      ...opposing.map((item, index) => Object.freeze({ id: `oppose-${index + 1}`, label: "反對因素", status: "REVIEW", reason: item })),
      ...conflicts.map((item, index) => Object.freeze({ id: `conflict-${index + 1}`, label: "策略衝突", status: "REVIEW", reason: item }))
    ];
    const nextItems = watchConditions.map((item, index) => Object.freeze({
      id: `watch-${index + 1}`,
      label: "接下來觀察",
      status: "WATCH",
      reason: item
    }));
    const homework = Object.freeze([...openItems, ...reviewItems, ...nextItems].slice(0, 20));
    const happened = text(
      analysis?.marketPhase?.summary
      || analysis?.technical?.summary
      || evidence.find(item => item.type === "market_quote")?.title
    ) || "目前沒有足夠 Evidence 描述發生了什麼。";
    const impact = text(analysis?.portfolioRisk?.summary)
      || "目前無法從既有 Evidence 判斷對持有部位的影響。";
    const next = watchConditions.length
      ? watchConditions.slice(0, 3).join("；")
      : missing.length
        ? `先補齊：${missing.slice(0, 3).map(labelForMissing).join("、")}。`
        : "目前沒有可驗證的下一步觀察條件。";
    return Object.freeze({
      contract: CONTRACT,
      symbol: text(context.symbol, 32).toUpperCase(),
      market: text(context.market, 16).toUpperCase(),
      generatedAt: text(context.generatedAt, 80),
      status,
      plainLanguage: Object.freeze({ happened, impact, next }),
      homework,
      missing: Object.freeze(missing.map(labelForMissing)),
      evidence: Object.freeze(evidence),
      strategyStatus: text(scan?.status || analysis?.strategyLibrary?.status).toUpperCase() || STATUS.NOT_SELECTED,
      evidenceOnly: true,
      readOnly: true,
      mutation: "none"
    });
  }

  function buildContexts(contexts, options = {}) {
    const rows = list(contexts).map(context => buildContext(context, options));
    return Object.freeze({ contract: CONTRACT, packs: Object.freeze(rows), generatedAt: new Date().toISOString(), readOnly: true, mutation: "none" });
  }

  return Object.freeze({ CONTRACT, STATUS, MISSING_LABELS, buildContext, buildContexts });
});
