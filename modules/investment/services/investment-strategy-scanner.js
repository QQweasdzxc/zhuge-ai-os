(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyScanner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  /*
   * This is an evidence-readiness projection over the existing Analysis
   * contract. It is deliberately not a score engine, portfolio engine, or
   * second source of Strategy truth. The Analysis service remains responsible
   * for evidence-bounded interpretation and conflict synthesis.
   */
  const CONTRACT = "zhuge-investment-strategy-scanner-v1";
  const STATUS = Object.freeze({
    READY: "READY",
    PARTIAL: "PARTIAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    NOT_SELECTED: "NOT_SELECTED",
    UNKNOWN: "UNKNOWN"
  });
  const REQUIRED_EVIDENCE = Object.freeze({
    bull_trend: ["technical_analysis", "market_phase"],
    ma_golden_cross: ["technical_analysis"],
    volume_breakout: ["technical_analysis"],
    hot_theme: ["news_evidence", "relationships"],
    event_driven: ["news_evidence"],
    growth_quality: ["fundamental_analysis"],
    expectation_repricing: ["fundamental_analysis", "market_phase"],
    shrink_pullback: ["technical_analysis"],
    bottom_volume: ["technical_analysis"],
    dragon_head: ["technical_analysis", "market_phase"],
    one_yang_three_yin: ["technical_analysis"],
    box_oscillation: ["technical_analysis"],
    chan_theory: ["technical_analysis"],
    wave_theory: ["technical_analysis"],
    emotion_cycle: ["news_evidence", "market_phase"]
  });

  function text(value, max = 500) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function unique(value) {
    return [...new Set(list(value).map(item => String(item)))];
  }

  function requirementFor(strategy = {}) {
    return Object.freeze((REQUIRED_EVIDENCE[strategy.id] || ["evidence"]).slice());
  }

  function sectionStatus(analysis, context, requirement) {
    const keys = Object.freeze({
      market_phase: "marketPhase",
      technical_analysis: "technical",
      fundamental_analysis: "fundamental",
      relationships: "relationships"
    });
    if (requirement === "news_evidence") {
      return list(context?.evidence).some(item => ["news", "event", "social"].includes(text(item?.type).toLowerCase()))
        ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE";
    }
    const key = keys[requirement] || requirement;
    const section = analysis?.[key];
    if (section?.status) return text(section.status).toUpperCase();
    if (requirement === "evidence") return Number(analysis?.evidenceCount || 0) > 0 ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE";
    return "INSUFFICIENT_EVIDENCE";
  }

  function normalizeResultStatus(matches, selected) {
    if (!selected.length) return STATUS.NOT_SELECTED;
    if (!matches.length) return STATUS.INSUFFICIENT_EVIDENCE;
    const ready = matches.filter(item => item.status === STATUS.READY).length;
    if (ready === matches.length) return STATUS.READY;
    if (ready > 0 || matches.some(item => item.status === STATUS.PARTIAL)) return STATUS.PARTIAL;
    return STATUS.INSUFFICIENT_EVIDENCE;
  }

  function scanContext(context = {}, options = {}) {
    const analysisService = options.analysisService || root?.InvestmentAnalysisService;
    const strategyLibrary = options.strategyLibrary || root?.InvestmentStrategyLibrary;
    const selected = unique(context.strategyIds);
    const analysis = options.analysis || (analysisService?.analyzeContextPack
      ? analysisService.analyzeContextPack(context, { strategyLibrary })
      : null);
    if (!selected.length) {
      return Object.freeze({
        contract: CONTRACT,
        symbol: text(context.symbol).toUpperCase(),
        market: text(context.market).toUpperCase(),
        status: STATUS.NOT_SELECTED,
        selectedIds: Object.freeze([]),
        matches: Object.freeze([]),
        supportingFactors: Object.freeze([]),
        opposingFactors: Object.freeze([]),
        watchConditions: Object.freeze([]),
        insufficientEvidence: Object.freeze(["目前沒有指定策略；不替使用者自動選策略。"]),
        evidenceOnly: true,
        mutation: "none"
      });
    }
    const get = typeof strategyLibrary?.get === "function" ? strategyLibrary.get : () => null;
    const existingMatches = new Map(list(analysis?.strategyLibrary?.matches).map(item => [text(item.id), item]));
    const matches = selected.map(id => {
      const strategy = get(id);
      if (!strategy) {
        return Object.freeze({ id, name: id, status: STATUS.UNKNOWN, requiredEvidence: Object.freeze(["strategy_definition"]), availableEvidence: Object.freeze([]), missing: Object.freeze(["strategy_definition"]), reason: "Strategy Library 沒有此正式定義。" });
      }
      const requiredEvidence = requirementFor(strategy);
      const availableEvidence = requiredEvidence.filter(item => sectionStatus(analysis, context, item) === "AVAILABLE");
      const missing = requiredEvidence.filter(item => !availableEvidence.includes(item));
      const sourceMatch = existingMatches.get(id);
      const status = !missing.length
        ? STATUS.READY
        : availableEvidence.length
          ? STATUS.PARTIAL
          : STATUS.INSUFFICIENT_EVIDENCE;
      return Object.freeze({
        id: strategy.id,
        name: strategy.name,
        category: strategy.category,
        status,
        requiredEvidence: Object.freeze(requiredEvidence),
        availableEvidence: Object.freeze(availableEvidence),
        missing: Object.freeze(missing),
        evidenceRefs: Object.freeze(sourceMatch?.evidenceRefs || []),
        reason: status === STATUS.READY
          ? "策略所需 Evidence 已具備，可交由既有 Analysis Contract 解讀。"
          : status === STATUS.PARTIAL
            ? "策略所需 Evidence 僅部分具備；不產生完整方向結論。"
            : "策略所需 Evidence 不足，諸葛暫時不判斷。"
      });
    });
    const synthesis = analysis?.strategySynthesis || {};
    return Object.freeze({
      contract: CONTRACT,
      symbol: text(context.symbol).toUpperCase(),
      market: text(context.market).toUpperCase(),
      status: normalizeResultStatus(matches, selected),
      selectedIds: Object.freeze(selected),
      matches: Object.freeze(matches),
      supportingFactors: Object.freeze(list(synthesis.supportingFactors).map(item => text(item))),
      opposingFactors: Object.freeze(list(synthesis.opposingFactors).map(item => text(item))),
      watchConditions: Object.freeze(list(synthesis.watchConditions).map(item => text(item))),
      insufficientEvidence: Object.freeze([
        ...list(synthesis.insufficientEvidence).map(item => text(item)),
        ...matches.flatMap(item => item.missing.map(key => `${item.name || item.id}：缺少 ${key}`))
      ]),
      conflicts: Object.freeze(list(synthesis.conflicts).map(item => text(item))),
      evidenceOnly: true,
      mutation: "none"
    });
  }

  function scanContexts(contexts, analyses = [], options = {}) {
    const rows = list(contexts).map((context, index) => scanContext(context, { ...options, analysis: analyses[index] || context.analysis }));
    return Object.freeze({ contract: CONTRACT, scans: Object.freeze(rows), generatedAt: new Date().toISOString(), mutation: "none" });
  }

  return Object.freeze({ CONTRACT, STATUS, REQUIRED_EVIDENCE, requirementFor, scanContext, scanContexts });
});
