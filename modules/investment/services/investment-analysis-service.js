(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentAnalysisService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-investment-analysis-v1";
  const STATUS = Object.freeze({
    AVAILABLE: "AVAILABLE",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    NOT_SELECTED: "NOT_SELECTED",
    UNKNOWN: "UNKNOWN"
  });

  function text(value) {
    return String(value ?? "").trim();
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean).map(String)));
  }

  function evidenceMatches(evidence, types) {
    const wanted = new Set(types);
    return list(evidence).filter(item => wanted.has(text(item.type).toLowerCase()));
  }

  function evidenceRefs(evidence) {
    return Object.freeze(list(evidence).map((item, index) => Object.freeze({
      index,
      type: text(item.type) || "unknown",
      title: text(item.title),
      source: text(item.source),
      sourceUrl: text(item.sourceUrl),
      observedAt: text(item.observedAt),
      freshness: text(item.freshness) || "unknown",
      quality: text(item.quality) || "unknown"
    })));
  }

  function section(id, label, status, options = {}) {
    return Object.freeze({
      id,
      label,
      status,
      summary: text(options.summary),
      evidenceRefs: evidenceRefs(options.evidence),
      observations: Object.freeze(list(options.observations).map(item => text(item))),
      missing: Object.freeze(unique(options.missing || [])),
      limitations: Object.freeze(unique(options.limitations || []))
    });
  }

  function explicitMarketPhase(context) {
    const source = context?.marketPhase && typeof context.marketPhase === "object"
      ? context.marketPhase
      : {};
    const phase = text(source.phase || source.status || source.value).toUpperCase();
    if (!phase || ["UNKNOWN", "UNAVAILABLE", "NOT_CONFIGURED"].includes(phase)) return null;
    return { phase, source };
  }

  function analyzeMarketPhase(context, evidence) {
    const explicit = explicitMarketPhase(context);
    if (explicit) {
      return section("market_phase", "Market Phase", STATUS.AVAILABLE, {
        summary: `Market phase evidence: ${explicit.phase}.`,
        evidence: explicit.source.evidence || [],
        observations: [explicit.phase, explicit.source.source, explicit.source.asOf].filter(Boolean),
        limitations: explicit.source.limitations || []
      });
    }
    const marketEvidence = evidenceMatches(evidence, ["market_quote"]);
    return section("market_phase", "Market Phase", STATUS.INSUFFICIENT_EVIDENCE, {
      summary: marketEvidence.length
        ? "已有最新可用行情，但 Context Pack 沒有交易時段／市場階段證據。"
        : "Context Pack 沒有可用的 Market Phase 證據。",
      evidence: marketEvidence,
      missing: ["market_phase"],
      limitations: ["最新行情時間不能單獨證明交易所目前處於開盤、盤前或收盤階段。"]
    });
  }

  function analyzeTechnical(evidence) {
    const technicalEvidence = evidenceMatches(evidence, [
      "technical", "technical_analysis", "ohlc", "candle", "market_history", "indicator"
    ]);
    if (!technicalEvidence.length) {
      return section("technical_analysis", "Technical Analysis", STATUS.INSUFFICIENT_EVIDENCE, {
        summary: "目前只有 latest quote／新聞 Evidence，尚未有 OHLC、歷史序列或技術指標 Evidence。",
        missing: ["historical_ohlc_or_indicators"],
        limitations: ["不以單一最新價格冒充均線、量價、RSI、MACD 或型態分析。"]
      });
    }
    return section("technical_analysis", "Technical Analysis", STATUS.AVAILABLE, {
      summary: "已取得可供技術分析的 Evidence；本層只投影可驗證觀察，不自行產生交易建議。",
      evidence: technicalEvidence,
      observations: technicalEvidence.flatMap(item => list(item.facts)).slice(0, 20),
      limitations: technicalEvidence.flatMap(item => list(item.limitations))
    });
  }

  function analyzeFundamental(evidence) {
    const fundamentalEvidence = evidenceMatches(evidence, [
      "fundamental", "financial_statement", "valuation", "earnings", "company_profile"
    ]);
    if (!fundamentalEvidence.length) {
      return section("fundamental_analysis", "Fundamental Analysis", STATUS.INSUFFICIENT_EVIDENCE, {
        summary: "目前 Context Pack 沒有財報、估值、獲利或公司基本資料 Evidence。",
        missing: ["fundamental_evidence"],
        limitations: ["不以新聞摘要或最新價格推論基本面品質、估值或成長性。"]
      });
    }
    return section("fundamental_analysis", "Fundamental Analysis", STATUS.AVAILABLE, {
      summary: "已取得可供基本面分析的 Evidence；保留來源與限制，不直接產生 Recommendation。",
      evidence: fundamentalEvidence,
      observations: fundamentalEvidence.flatMap(item => list(item.facts)).slice(0, 20),
      limitations: fundamentalEvidence.flatMap(item => list(item.limitations))
    });
  }

  function analyzeRelationships(evidence) {
    const relationshipEvidence = evidenceMatches(evidence, [
      "etf_component", "component", "industry", "sector", "related_stock", "relationship"
    ]);
    if (!relationshipEvidence.length) {
      return section("relationships", "ETF / Components / Industry / Related Stocks", STATUS.INSUFFICIENT_EVIDENCE, {
        summary: "目前 Context Pack 沒有 ETF 成分、產業或相關標的關係 Evidence。",
        missing: ["relationship_evidence"],
        limitations: ["不從標的名稱或新聞文字猜測 ETF 成分、產業歸屬或相關股票。"]
      });
    }
    return section("relationships", "ETF / Components / Industry / Related Stocks", STATUS.AVAILABLE, {
      summary: "已取得可供關聯研究的 Evidence；關係資料仍以來源標示為準。",
      evidence: relationshipEvidence,
      observations: relationshipEvidence.flatMap(item => list(item.facts)).slice(0, 20),
      limitations: relationshipEvidence.flatMap(item => list(item.limitations))
    });
  }

  function strategyRequirement(strategy) {
    const category = text(strategy?.category);
    if (["技術", "量價", "型態", "結構", "趨勢"].includes(category)) return "technical_analysis";
    if (category === "基本面") return "fundamental_analysis";
    if (["事件", "情緒"].includes(category)) return "news_evidence";
    return "evidence";
  }

  function analyzeStrategies(context, sections, strategyLibrary) {
    const selectedIds = unique(list(context?.strategyIds));
    if (!selectedIds.length) {
      return Object.freeze({
        id: "strategy_library",
        label: "Strategy Library × Evidence",
        status: STATUS.NOT_SELECTED,
        selectedIds: Object.freeze([]),
        matches: Object.freeze([]),
        evidenceRefs: Object.freeze([]),
        missing: Object.freeze([]),
        limitations: Object.freeze(["本次 Context Pack 未指定 Strategy；不自動選擇策略或產生建議。"])
      });
    }

    const get = typeof strategyLibrary?.get === "function" ? strategyLibrary.get : () => null;
    const newsEvidence = list(context.evidence).filter(item => ["news", "event", "social"].includes(text(item.type).toLowerCase()));
    const matches = selectedIds.map(id => {
      const strategy = get(id);
      if (!strategy) {
        return Object.freeze({ id, status: STATUS.UNKNOWN, requiredEvidence: "strategy_definition", evidenceRefs: Object.freeze([]), reason: "Strategy Library 沒有此 ID 的正式定義。" });
      }
      const requiredEvidence = strategyRequirement(strategy);
      const source = requiredEvidence === "technical_analysis"
        ? sections.technical
        : requiredEvidence === "fundamental_analysis"
          ? sections.fundamental
          : requiredEvidence === "news_evidence"
            ? section("news_evidence", "News Evidence", newsEvidence.length ? STATUS.AVAILABLE : STATUS.INSUFFICIENT_EVIDENCE, { evidence: newsEvidence })
            : section("evidence", "Evidence", list(context.evidence).length ? STATUS.AVAILABLE : STATUS.INSUFFICIENT_EVIDENCE, { evidence: context.evidence });
      return Object.freeze({
        id: strategy.id,
        name: strategy.name,
        category: strategy.category,
        status: source.status === STATUS.AVAILABLE ? STATUS.AVAILABLE : STATUS.INSUFFICIENT_EVIDENCE,
        requiredEvidence,
        evidenceRefs: source.evidenceRefs,
        reason: source.status === STATUS.AVAILABLE
          ? "已取得該策略所需的 Evidence，可供後續分析。"
          : "所需 Evidence 尚未完整，不產生策略結論。"
      });
    });
    const refs = matches.flatMap(item => item.evidenceRefs || []);
    return Object.freeze({
      id: "strategy_library",
      label: "Strategy Library × Evidence",
      status: matches.some(item => item.status === STATUS.AVAILABLE) ? STATUS.AVAILABLE : STATUS.INSUFFICIENT_EVIDENCE,
      selectedIds: Object.freeze(selectedIds),
      matches: Object.freeze(matches),
      evidenceRefs: evidenceRefs(refs),
      missing: Object.freeze(matches.filter(item => item.status !== STATUS.AVAILABLE).map(item => `${item.id}:${item.requiredEvidence}`)),
      limitations: Object.freeze(["Strategy evidence readiness 不等於投資建議；User Decision 仍由使用者保留。"])
    });
  }

  function analyzeContextPack(contextPack = {}, options = {}) {
    const evidence = list(contextPack.evidence);
    const sections = {
      marketPhase: analyzeMarketPhase(contextPack, evidence),
      technical: analyzeTechnical(evidence),
      fundamental: analyzeFundamental(evidence),
      relationships: analyzeRelationships(evidence)
    };
    const strategy = analyzeStrategies(contextPack, sections, options.strategyLibrary);
    const all = [sections.marketPhase, sections.technical, sections.fundamental, sections.relationships, strategy];
    const available = all.filter(item => item.status === STATUS.AVAILABLE).length;
    const status = !text(contextPack.symbol)
      ? STATUS.UNKNOWN
      : available > 0
        ? "PARTIAL"
        : STATUS.INSUFFICIENT_EVIDENCE;
    return Object.freeze({
      contract: CONTRACT,
      generatedAt: new Date().toISOString(),
      symbol: text(contextPack.symbol).toUpperCase(),
      market: text(contextPack.market).toUpperCase(),
      status,
      evidenceCount: evidence.length,
      marketPhase: sections.marketPhase,
      technical: sections.technical,
      fundamental: sections.fundamental,
      relationships: sections.relationships,
      strategyLibrary: strategy,
      limitations: Object.freeze(unique(all.flatMap(item => item.limitations || [])))
    });
  }

  function enrichContextPack(contextPack = {}, options = {}) {
    if (!contextPack || typeof contextPack !== "object") return contextPack;
    return Object.freeze({
      ...contextPack,
      analysis: analyzeContextPack(contextPack, options)
    });
  }

  return Object.freeze({ CONTRACT, STATUS, analyzeContextPack, enrichContextPack });
});
