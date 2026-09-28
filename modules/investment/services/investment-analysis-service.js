(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentAnalysisService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-investment-analysis-v1";
  const STATUS = Object.freeze({
    AVAILABLE: "AVAILABLE",
    PARTIAL: "PARTIAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    NOT_SELECTED: "NOT_SELECTED",
    NOT_APPLICABLE: "NOT_APPLICABLE",
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

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
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
      "etf_component", "component", "industry", "industry_exposure", "sector", "related_stock", "related_symbol", "relationship"
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

  function strategySignalRecords(context, evidence, selectedIds) {
    const allowed = new Set(selectedIds);
    const candidates = [
      ...list(context?.strategyEvidence),
      ...list(evidence).flatMap(item => {
        const signal = item?.strategySignal || item?.strategy_signal;
        return signal && typeof signal === "object" ? [{ ...signal, source: item.source, observedAt: item.observedAt }] : [];
      })
    ];
    return candidates.map(item => {
      const id = text(item.strategyId || item.strategy_id || item.id);
      const raw = text(item.stance || item.direction || item.signal).toUpperCase();
      const stance = ["SUPPORT", "SUPPORTED", "BULLISH", "POSITIVE", "FAVOUR", "FAVOR"].includes(raw)
        ? "SUPPORT"
        : ["OPPOSE", "OPPOSED", "BEARISH", "NEGATIVE", "AGAINST"].includes(raw)
          ? "OPPOSE"
          : ["WATCH", "NEUTRAL", "MIXED"].includes(raw) ? "WATCH" : "UNKNOWN";
      if (!id || !allowed.has(id) || stance === "UNKNOWN") return null;
      return Object.freeze({
        strategyId: id,
        stance,
        reason: text(item.reason || item.summary || item.label) || "已取得方向性 Evidence。",
        source: text(item.source),
        observedAt: text(item.observedAt)
      });
    }).filter(Boolean);
  }

  function buildStrategySynthesis(context, matches, strategyLibrary, evidence) {
    const selectedIds = unique(list(context?.strategyIds));
    const catalogCount = typeof strategyLibrary?.list === "function" ? strategyLibrary.list().length : 0;
    if (!selectedIds.length) {
      return Object.freeze({
        status: STATUS.NOT_SELECTED,
        catalogCount,
        selectedIds: Object.freeze([]),
        supportingFactors: Object.freeze([]),
        opposingFactors: Object.freeze([]),
        watchConditions: Object.freeze([]),
        insufficientEvidence: Object.freeze([]),
        conflicts: Object.freeze([]),
        summary: "目前沒有指定要交叉比較的策略；不替使用者自動選策略或產生方向結論。"
      });
    }

    const signals = strategySignalRecords(context, evidence, selectedIds);
    const supportingFactors = Object.freeze(signals.filter(item => item.stance === "SUPPORT").map(item => `${item.strategyId}：${item.reason}`));
    const opposingFactors = Object.freeze(signals.filter(item => item.stance === "OPPOSE").map(item => `${item.strategyId}：${item.reason}`));
    const conflicts = supportingFactors.length && opposingFactors.length
      ? Object.freeze(["不同策略的方向性 Evidence 同時存在支持與反對，保留衝突，不替使用者選單一答案。"])
      : Object.freeze([]);
    const watchConditions = Object.freeze(matches
      .filter(item => item.status === STATUS.AVAILABLE)
      .map(item => `${item.name || item.id}：${item.description || "持續觀察該策略所需的 Evidence 是否延續。"}`));
    const insufficientEvidence = Object.freeze(matches
      .filter(item => item.status !== STATUS.AVAILABLE)
      .map(item => `${item.name || item.id}：${item.reason}`));
    const status = conflicts.length
      ? STATUS.PARTIAL
      : signals.length
        ? STATUS.AVAILABLE
        : matches.some(item => item.status === STATUS.AVAILABLE) ? STATUS.PARTIAL : STATUS.INSUFFICIENT_EVIDENCE;
    const summary = conflicts.length
      ? conflicts[0]
      : signals.length
        ? "已取得部分策略方向性 Evidence；請同時查看支持與反對因素。"
        : status === STATUS.PARTIAL
          ? "策略所需 Evidence 已部分取得，但目前沒有可驗證的方向性結論。"
          : "策略所需 Evidence 尚未完整，諸葛暫時不判斷。";
    return Object.freeze({
      status,
      catalogCount,
      selectedIds: Object.freeze(selectedIds),
      supportingFactors,
      opposingFactors,
      watchConditions,
      insufficientEvidence,
      conflicts,
      summary
    });
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
        limitations: Object.freeze(["本次 Context Pack 未指定 Strategy；不自動選擇策略或產生建議。"]),
        synthesis: buildStrategySynthesis(context, [], strategyLibrary, context.evidence)
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
        description: strategy.description,
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
      limitations: Object.freeze(["Strategy evidence readiness 不等於投資建議；User Decision 仍由使用者保留。"]),
      synthesis: buildStrategySynthesis(context, matches, strategyLibrary, context.evidence)
    });
  }

  function zoneValue(source, keys) {
    for (const key of keys) {
      const value = source?.[key];
      if (value === null || value === undefined || value === "") continue;
      if (typeof value === "object") {
        const explicit = value.value ?? value.label ?? value.range ?? value.description;
        if (explicit === null || explicit === undefined || explicit === "") continue;
        return Object.freeze({
          value: text(explicit),
          conditions: Object.freeze(list(value.conditions || value.watchConditions).map(item => text(item))),
          evidenceRefs: evidenceRefs(value.evidence || [])
        });
      }
      return Object.freeze({ value: text(value), conditions: Object.freeze([]), evidenceRefs: Object.freeze([]) });
    }
    return null;
  }

  function analyzeDecisionZones(context, sections) {
    const evidence = list(context.evidence);
    const zoneSources = [
      context?.decisionZones,
      ...evidence.map(item => item?.decisionZones || item?.strategyZones || item?.strategy_zones).filter(Boolean)
    ].filter(source => source && typeof source === "object");
    const buyPoint = zoneSources.map(source => zoneValue(source, ["buyPoint", "buy_point", "buy"])).find(Boolean) || null;
    const sellPoint = zoneSources.map(source => zoneValue(source, ["sellPoint", "sell_point", "sell"])).find(Boolean) || null;
    const strategyRange = zoneSources.map(source => zoneValue(source, ["strategyRange", "strategy_range", "range"])).find(Boolean) || null;
    const requirements = [
      ["market_phase", sections.marketPhase],
      ["technical_analysis", sections.technical],
      ["fundamental_analysis", sections.fundamental],
      ["strategy_evidence", sections.strategyLibrary]
    ];
    const missing = requirements
      .filter(([, item]) => item.status !== STATUS.AVAILABLE)
      .map(([id]) => id);
    const completeInputs = missing.length === 0;
    const hasAllExplicitZones = Boolean(buyPoint && sellPoint && strategyRange);
    const status = !completeInputs
      ? STATUS.INSUFFICIENT_EVIDENCE
      : hasAllExplicitZones ? STATUS.AVAILABLE : STATUS.PARTIAL;
    const zone = (item, label) => Object.freeze({
      label,
      status: item ? STATUS.AVAILABLE : (completeInputs ? STATUS.PARTIAL : STATUS.INSUFFICIENT_EVIDENCE),
      value: item?.value || null,
      conditions: item?.conditions || Object.freeze([]),
      evidenceRefs: item?.evidenceRefs || Object.freeze([])
    });
    return Object.freeze({
      id: "decision_zones",
      label: "買點／賣點／策略區間",
      status,
      summary: status === STATUS.AVAILABLE
        ? "Technical、Fundamental、Market Phase 與 Strategy Evidence 均有資料，且來源明確提供策略區間。"
        : completeInputs
          ? "組成分析 Evidence 已具備，但目前沒有完整且可驗證的買點、賣點與策略區間；諸葛不自行推導價位。"
          : "組成分析 Evidence 尚未完整，諸葛不產生買點、賣點或策略區間。",
      buyPoint: zone(buyPoint, "買點"),
      sellPoint: zone(sellPoint, "賣點"),
      strategyRange: zone(strategyRange, "策略區間"),
      missing: Object.freeze(missing.length ? missing : hasAllExplicitZones ? [] : ["explicit_decision_zone"]),
      limitations: Object.freeze([
        "不由單一最新價格、均線或新聞推導精確買賣點。",
        "這是 Evidence 研判輔助，不是下單指令。"
      ])
    });
  }

  function normalizeHolding(item) {
    const quantity = finite(item?.quantity);
    if (quantity === null || quantity <= 0 || String(item?.positionStatus || item?.position_status || "").toLowerCase() === "history") return null;
    const marketValue = finite(item?.marketValue ?? item?.market_value);
    return Object.freeze({
      symbol: text(item?.symbol).toUpperCase(),
      name: text(item?.name),
      market: text(item?.market).toUpperCase() || "UNKNOWN",
      currency: text(item?.currency).toUpperCase() || "UNKNOWN",
      quantity,
      marketValue,
      industry: text(item?.industry || item?.sector)
    });
  }

  function exposureRows(holdings, field) {
    const rows = new Map();
    for (const holding of holdings) {
      const key = text(holding[field]) || "UNKNOWN";
      const bucket = `${key}:${holding.currency}`;
      const current = rows.get(bucket) || { key, currency: holding.currency, value: 0 };
      current.value += holding.marketValue || 0;
      rows.set(bucket, current);
    }
    const totals = new Map();
    for (const row of rows.values()) totals.set(row.currency, (totals.get(row.currency) || 0) + row.value);
    return Array.from(rows.values()).map(row => Object.freeze({
      ...row,
      weight: totals.get(row.currency) ? row.value / totals.get(row.currency) : null
    }));
  }

  function analyzePortfolioRisk(context, options = {}) {
    const source = Array.isArray(options.portfolioPositions)
      ? options.portfolioPositions
      : Array.isArray(context?.portfolioContext?.positions) ? context.portfolioContext.positions : [];
    const holdings = source.map(normalizeHolding).filter(Boolean);
    if (!holdings.length) {
      return Object.freeze({
        id: "portfolio_risk",
        label: "我的持有曝險",
        status: STATUS.NOT_APPLICABLE,
        summary: "目前沒有讀到可對應的持有部位；不把研究標的誤當成你的持倉。",
        holding: Object.freeze({ isHeld: false, quantity: 0, marketValue: null }),
        concentration: Object.freeze({ byCurrency: Object.freeze([]), largest: null }),
        marketExposure: Object.freeze([]),
        industryExposure: Object.freeze([]),
        signals: Object.freeze([]),
        missing: Object.freeze([]),
        limitations: Object.freeze(["Portfolio Risk 只讀取 canonical positions，不重算持股、成本或損益。"])
      });
    }
    const priced = holdings.filter(item => item.marketValue !== null && item.marketValue >= 0);
    const missing = [];
    if (priced.length < holdings.length) missing.push("market_value");
    if (holdings.some(item => !item.industry)) missing.push("industry_exposure");
    const marketExposure = exposureRows(priced, "market");
    const industryExposure = exposureRows(priced.filter(item => item.industry), "industry");
    const largestByCurrency = Array.from(new Set(priced.map(item => item.currency))).flatMap(currency => {
      const rows = priced.filter(item => item.currency === currency);
      const total = rows.reduce((sum, item) => sum + (item.marketValue || 0), 0);
      const largest = rows.slice().sort((left, right) => (right.marketValue || 0) - (left.marketValue || 0))[0];
      return largest ? [{
        symbol: largest.symbol,
        name: largest.name,
        currency,
        value: largest.marketValue,
        weight: total ? largest.marketValue / total : null
      }] : [];
    }).map(item => Object.freeze(item));
    const signals = [];
    if (holdings.length === 1) signals.push("目前只有一檔持倉，單一標的曝險較集中。");
    for (const item of largestByCurrency) {
      if (item.weight !== null && item.weight >= 0.5 && holdings.length > 1) {
        signals.push(`${item.symbol} 約占 ${item.currency} 持倉市值 ${(item.weight * 100).toFixed(1)}%，屬主要集中曝險。`);
      }
    }
    const current = holdings.find(item => item.symbol === text(context?.symbol).toUpperCase()) || null;
    const status = !priced.length ? STATUS.INSUFFICIENT_EVIDENCE : missing.length ? STATUS.PARTIAL : STATUS.AVAILABLE;
    return Object.freeze({
      id: "portfolio_risk",
      label: "我的持有曝險",
      status,
      summary: current
        ? current.marketValue === null
          ? "這個標的在你的持倉中，但目前沒有可驗證市值，暫不計算集中度。"
          : `這個標的在你的持倉中；以下只呈現市場／產業曝險事實，不替你判定是否該買賣。`
        : "這個研究標的目前不在已讀取的持倉中；以下風險資訊只描述整體 Portfolio。",
      holding: Object.freeze({
        isHeld: Boolean(current),
        symbol: current?.symbol || text(context?.symbol).toUpperCase(),
        quantity: current?.quantity || 0,
        marketValue: current?.marketValue ?? null,
        currency: current?.currency || null
      }),
      concentration: Object.freeze({ byCurrency: Object.freeze(largestByCurrency), largest: largestByCurrency[0] || null }),
      marketExposure: Object.freeze(marketExposure),
      industryExposure: Object.freeze(industryExposure),
      signals: Object.freeze(signals),
      missing: Object.freeze(unique(missing)),
      limitations: Object.freeze([
        "市場與產業曝險以 canonical positions 已有欄位計算；沒有產業欄位時不猜測產業。",
        "不建立第二套 Portfolio、Position、Cost 或 P&L calculation。"
      ])
    });
  }

  function qualityScore(value) {
    const key = text(value).toLowerCase();
    return ({ official_open_data: 1, official: 1, fresh: 0.9, provider: 0.75, stale: 0.5, unknown: 0.25, unavailable: 0 })[key] ?? 0.25;
  }

  function freshnessScore(evidence) {
    if (!evidence.length) return 0;
    return evidence.reduce((sum, item) => {
      const key = text(item.freshness || item.quality).toLowerCase();
      return sum + (key === "fresh" ? 1 : key === "stale" ? 0.5 : key === "unknown" ? 0.25 : 0);
    }, 0) / evidence.length;
  }

  function consistencyScore(context, evidence) {
    if (!evidence.length) return 0;
    const symbol = text(context?.symbol).toUpperCase();
    const market = text(context?.market).toUpperCase();
    const scoped = evidence.filter(item => item.symbol || item.market);
    const mismatch = scoped.some(item => (item.symbol && text(item.symbol).toUpperCase() !== symbol) || (item.market && text(item.market).toUpperCase() !== market));
    const keys = evidence.map(item => [item.type, item.source, item.title, item.observedAt].join("|").toLowerCase());
    const duplicate = new Set(keys).size !== keys.length;
    return mismatch || duplicate ? 0.5 : 1;
  }

  function analyzeConfidence(context, sections, evidence) {
    if (!evidence.length) {
      return Object.freeze({
        id: "evidence_confidence",
        label: "Evidence 信心",
        status: STATUS.UNKNOWN,
        score: null,
        level: "UNKNOWN",
        factors: Object.freeze([]),
        reasons: Object.freeze(["目前沒有足夠 Evidence 形成可追溯的信心評估。"]),
        limitations: Object.freeze(["這是 Evidence 覆蓋度，不是獲利機率，也不是投資建議。"])
      });
    }
    const required = [sections.marketPhase, sections.technical, sections.fundamental, sections.relationships];
    if (sections.strategyLibrary.status !== STATUS.NOT_SELECTED) required.push(sections.strategyLibrary);
    const complete = required.filter(item => item.status === STATUS.AVAILABLE).length / Math.max(1, required.length);
    const freshness = freshnessScore(evidence);
    const providerQuality = evidence.reduce((sum, item) => sum + qualityScore(item.quality), 0) / evidence.length;
    const consistency = consistencyScore(context, evidence);
    const factors = [
      { id: "evidence_completeness", label: "Evidence 完整度", value: complete, score: Math.round(complete * 100), detail: `${required.filter(item => item.status === STATUS.AVAILABLE).length}/${required.length} 個分析區塊已有資料。` },
      { id: "freshness", label: "資料新鮮度", value: freshness, score: Math.round(freshness * 100), detail: "依每筆 Evidence 的 fresh／stale／unknown 標記計算。" },
      { id: "provider_quality", label: "Provider 品質", value: providerQuality, score: Math.round(providerQuality * 100), detail: "依 Evidence 的官方／Provider／stale／unknown 標記計算。" },
      { id: "data_consistency", label: "資料一致性", value: consistency, score: Math.round(consistency * 100), detail: consistency === 1 ? "標的、市場與 Evidence identity 一致，且沒有重複 Evidence。" : "Evidence identity 有不一致或重複，信心分數下調。" }
    ].map(item => Object.freeze(item));
    const score = Math.round((complete * 0.35 + freshness * 0.25 + providerQuality * 0.2 + consistency * 0.2) * 100);
    const level = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";
    return Object.freeze({
      id: "evidence_confidence",
      label: "Evidence 信心",
      status: complete === 1 && consistency === 1 ? STATUS.AVAILABLE : STATUS.PARTIAL,
      score,
      level,
      factors: Object.freeze(factors),
      reasons: Object.freeze(factors.map(item => `${item.label} ${item.score}/100：${item.detail}`)),
      limitations: Object.freeze(["這是 Evidence 覆蓋度，不是獲利機率，也不是投資建議。"])
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
    const decisionZones = analyzeDecisionZones(contextPack, { ...sections, strategyLibrary: strategy });
    const portfolioRisk = analyzePortfolioRisk(contextPack, options);
    const confidence = analyzeConfidence(contextPack, { ...sections, strategyLibrary: strategy }, evidence);
    const all = [sections.marketPhase, sections.technical, sections.fundamental, sections.relationships, strategy, decisionZones, portfolioRisk, confidence]
      .filter(item => ![STATUS.NOT_SELECTED, STATUS.NOT_APPLICABLE, STATUS.UNKNOWN].includes(item.status));
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
      strategySynthesis: strategy.synthesis,
      decisionZones,
      portfolioRisk,
      confidence,
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
