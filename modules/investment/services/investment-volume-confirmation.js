(function (root, factory) {
  const api = factory(root?.InvestmentStrategyBacktest);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentVolumeConfirmation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (strategyBacktest) {
  "use strict";

  /*
   * Evidence-only factor adapter for the existing Strategy Scanner and
   * Backtest contracts. It does not own positions, P&L, a score, or a
   * decision record. The thresholds are Zhuge configuration, not a claim
   * about the external research author's unstated definitions.
   */
  const CONTRACT = "volume_contraction_confirmation_v1";
  const STRATEGY_ID = "volume_contraction_confirmation";
  const STATUS = Object.freeze({
    AVAILABLE: "AVAILABLE",
    PARTIAL: "PARTIAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    INVALID_INPUT: "INVALID_INPUT"
  });
  const DEFAULT_CONFIG = Object.freeze({
    contraction: Object.freeze({
      previousDayRatioMax: 0.7,
      relativeVolumeMax: 0.7,
      ma5ToMa20Max: 0.95
    }),
    expansion: Object.freeze({
      previousDayRatioMin: 1.2,
      relativeVolumeMin: 1.2,
      ma5ToMa20Min: 1.0
    }),
    minVolumeWindow: 20,
    holdingHorizonBars: 5,
    feeBps: 10,
    slippageBps: 5,
    allowOverlap: false
  });
  const DEFAULT_SWEEP = Object.freeze({
    "contraction.previousDayRatioMax": Object.freeze([0.6, 0.7, 0.8]),
    "contraction.relativeVolumeMax": Object.freeze([0.6, 0.7, 0.8]),
    "contraction.ma5ToMa20Max": Object.freeze([0.85, 0.95, 1.0]),
    "expansion.previousDayRatioMin": Object.freeze([1.1, 1.2, 1.4]),
    "expansion.relativeVolumeMin": Object.freeze([1.1, 1.2, 1.4]),
    "expansion.ma5ToMa20Min": Object.freeze([0.9, 1.0, 1.1])
  });

  function text(value, max = 500) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function unique(value) {
    return [...new Set(list(value).map(item => text(item)).filter(Boolean))];
  }

  function clamp(value, fallback, minimum, maximum) {
    const parsed = number(value);
    return parsed === null ? fallback : Math.min(maximum, Math.max(minimum, parsed));
  }

  function cloneConfig(input = {}) {
    const raw = input.config && typeof input.config === "object" ? input.config : input;
    const contraction = raw.contraction && typeof raw.contraction === "object" ? raw.contraction : {};
    const expansion = raw.expansion && typeof raw.expansion === "object" ? raw.expansion : {};
    return {
      contraction: {
        previousDayRatioMax: clamp(contraction.previousDayRatioMax, DEFAULT_CONFIG.contraction.previousDayRatioMax, 0.01, 10),
        relativeVolumeMax: clamp(contraction.relativeVolumeMax, DEFAULT_CONFIG.contraction.relativeVolumeMax, 0.01, 10),
        ma5ToMa20Max: clamp(contraction.ma5ToMa20Max, DEFAULT_CONFIG.contraction.ma5ToMa20Max, 0.01, 10)
      },
      expansion: {
        previousDayRatioMin: clamp(expansion.previousDayRatioMin, DEFAULT_CONFIG.expansion.previousDayRatioMin, 0.01, 20),
        relativeVolumeMin: clamp(expansion.relativeVolumeMin, DEFAULT_CONFIG.expansion.relativeVolumeMin, 0.01, 20),
        ma5ToMa20Min: clamp(expansion.ma5ToMa20Min, DEFAULT_CONFIG.expansion.ma5ToMa20Min, 0.01, 20)
      },
      minVolumeWindow: Math.round(clamp(raw.minVolumeWindow, DEFAULT_CONFIG.minVolumeWindow, 5, 250)),
      holdingHorizonBars: Math.round(clamp(raw.holdingHorizonBars ?? raw.holding_horizon, DEFAULT_CONFIG.holdingHorizonBars, 1, 250)),
      feeBps: clamp(raw.feeBps ?? raw.fee_bps, DEFAULT_CONFIG.feeBps, 0, 1000),
      slippageBps: clamp(raw.slippageBps ?? raw.slippage_bps, DEFAULT_CONFIG.slippageBps, 0, 1000),
      allowOverlap: raw.allowOverlap === true
    };
  }

  function normalizeBars(rows) {
    return list(rows).map((row, index) => {
      const timestamp = text(row?.timestamp || row?.date || row?.asOf || row?.as_of, 80);
      const open = number(row?.open);
      const high = number(row?.high);
      const low = number(row?.low);
      const close = number(row?.close);
      const volume = number(row?.volume);
      if (!timestamp || open === null || close === null || volume === null || open <= 0 || close <= 0 || volume < 0) return null;
      return Object.freeze({ index, timestamp, open, high, low, close, volume });
    }).filter(Boolean).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function volumeWindow(bars, start, end) {
    const rows = bars.slice(start, end);
    if (!rows.length || rows.some(item => !Number.isFinite(item.volume))) return null;
    return rows.map(item => item.volume);
  }

  function volumeMetricsAt(bars, index, window) {
    if (index < window || index < 4) return null;
    const current = bars[index]?.volume;
    const previous = bars[index - 1]?.volume;
    const prior = volumeWindow(bars, index - window, index);
    const ma5 = volumeWindow(bars, index - 4, index + 1);
    const ma20 = volumeWindow(bars, index - window + 1, index + 1);
    if (![current, previous].every(value => Number.isFinite(value)) || !prior || !ma5 || !ma20) return null;
    const priorAverage = average(prior);
    const ma5Average = average(ma5);
    const ma20Average = average(ma20);
    if (!(priorAverage > 0) || !(previous > 0) || !(ma20Average > 0)) return null;
    return Object.freeze({
      volume: current,
      previousDayRatio: current / previous,
      relativeVolume: current / priorAverage,
      ma5ToMa20: ma5Average / ma20Average
    });
  }

  function contractionMatches(metrics, config) {
    return Boolean(metrics)
      && metrics.previousDayRatio <= config.contraction.previousDayRatioMax
      && metrics.relativeVolume <= config.contraction.relativeVolumeMax
      && metrics.ma5ToMa20 <= config.contraction.ma5ToMa20Max;
  }

  function expansionMatches(metrics, config) {
    return Boolean(metrics)
      && metrics.previousDayRatio >= config.expansion.previousDayRatioMin
      && metrics.relativeVolume >= config.expansion.relativeVolumeMin
      && metrics.ma5ToMa20 >= config.expansion.ma5ToMa20Min;
  }

  function patternFor(bar) {
    if (bar.close > bar.open) return "BULLISH_CONFIRMATION";
    if (bar.close < bar.open) return "BEARISH_BULL_TRAP";
    return "FLAT_CONFIRMATION";
  }

  function refFor(history, observedAt) {
    return Object.freeze({
      source: text(history?.source || history?.provider, 180) || "unknown",
      sourceUrl: text(history?.sourceUrl || history?.source_url, 500),
      observedAt: text(observedAt || history?.asOf || history?.as_of, 80),
      freshness: text(history?.freshness, 40) || "unknown",
      quality: text(history?.quality, 80) || "provider"
    });
  }

  function buildEvents(bars, config, metadata = {}) {
    const candidates = [];
    const confirmed = [];
    const flatConfirmations = [];
    const rejected = [];
    for (let contractionIndex = config.minVolumeWindow; contractionIndex < bars.length - 1; contractionIndex += 1) {
      const contractionMetrics = volumeMetricsAt(bars, contractionIndex, config.minVolumeWindow);
      if (!contractionMetrics) continue;
      if (!contractionMatches(contractionMetrics, config)) continue;
      const confirmationIndex = contractionIndex + 1;
      const confirmationMetrics = volumeMetricsAt(bars, confirmationIndex, config.minVolumeWindow);
      const pattern = patternFor(bars[confirmationIndex]);
      const candidate = Object.freeze({
        contractionIndex,
        confirmationIndex,
        contractionAt: bars[contractionIndex].timestamp,
        confirmationAt: bars[confirmationIndex].timestamp,
        contractionMetrics,
        confirmationMetrics,
        pattern
      });
      candidates.push(candidate);
      if (!expansionMatches(confirmationMetrics, config)) {
        rejected.push(Object.freeze({ ...candidate, reason: "下一交易日未達量增門檻。" }));
        continue;
      }
      if (pattern === "FLAT_CONFIRMATION") {
        flatConfirmations.push(candidate);
        continue;
      }
      const entryIndex = confirmationIndex + 1;
      const exitIndex = entryIndex + config.holdingHorizonBars - 1;
      const event = Object.freeze({
        confirmationIndex,
        entryIndex,
        exitIndex,
        symbol: text(metadata.symbol, 40).toUpperCase(),
        industry: text(metadata.industry, 160) || "unknown",
        strategyId: STRATEGY_ID,
        pattern,
        reason: pattern === "BULLISH_CONFIRMATION"
          ? "量縮後，下一交易日量增且收紅；訊號於該日收盤確認。"
          : "量縮後，下一交易日量增且收綠；訊號於該日收盤確認。",
        evidenceRefs: Object.freeze([
          refFor(metadata.history, bars[contractionIndex].timestamp),
          refFor(metadata.history, bars[confirmationIndex].timestamp)
        ])
      });
      confirmed.push(event);
    }
    return Object.freeze({ candidates: Object.freeze(candidates), confirmed: Object.freeze(confirmed), flatConfirmations: Object.freeze(flatConfirmations), rejected: Object.freeze(rejected) });
  }

  function emptyMetrics() {
    return Object.freeze({
      sampleCount: 0,
      upRate: null,
      downRate: null,
      flatRate: null,
      avgReturn: null,
      medianReturn: null,
      maxAdverseExcursion: null,
      maxDrawdown: null,
      holdingHorizonBars: null
    });
  }

  function metricProjection(value, holdingHorizonBars) {
    const metrics = value?.metrics || {};
    return Object.freeze({
      sampleCount: Number(metrics.sampleCount || 0),
      upRate: metrics.upRate ?? null,
      downRate: metrics.downRate ?? null,
      flatRate: metrics.flatRate ?? null,
      avgReturn: metrics.averageReturn ?? null,
      medianReturn: metrics.medianReturn ?? null,
      maxAdverseExcursion: metrics.maxAdverseExcursion ?? null,
      maxDrawdown: metrics.maxDrawdown ?? null,
      holdingHorizonBars: holdingHorizonBars ?? metrics.holdingHorizon ?? null
    });
  }

  function patternMetrics(trades, pattern, holdingHorizonBars, engine = strategyBacktest) {
    if (!engine?.summarizeTrades) return emptyMetrics();
    const selected = list(trades).filter(item => item.pattern === pattern);
    return metricProjection({ metrics: engine.summarizeTrades(selected, { holdingHorizon: holdingHorizonBars }) }, holdingHorizonBars);
  }

  function breakdown(trades, results = [], engine = strategyBacktest) {
    const group = (keyFor, rows = trades) => {
      const map = new Map();
      rows.forEach(item => {
        const key = text(keyFor(item)) || "unknown";
        const current = map.get(key) || [];
        current.push(item);
        map.set(key, current);
      });
      return Object.freeze(Array.from(map.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([key, values]) => {
        const metrics = engine?.summarizeTrades
          ? engine.summarizeTrades(values)
          : {};
        return Object.freeze({ key, sampleCount: values.length, upRate: metrics.upRate ?? null, downRate: metrics.downRate ?? null, flatRate: metrics.flatRate ?? null, avgReturn: metrics.averageReturn ?? null, medianReturn: metrics.medianReturn ?? null, maxAdverseExcursion: metrics.maxAdverseExcursion ?? null, maxDrawdown: metrics.maxDrawdown ?? null });
      }));
    };
    const bySymbol = results.length
      ? Object.freeze(results.map(item => Object.freeze({ key: item.symbol, sampleCount: item.metrics.sampleCount, upRate: item.metrics.upRate, downRate: item.metrics.downRate, flatRate: item.metrics.flatRate, avgReturn: item.metrics.avgReturn, medianReturn: item.metrics.medianReturn, maxAdverseExcursion: item.metrics.maxAdverseExcursion, maxDrawdown: item.metrics.maxDrawdown })))
      : group(item => item.symbol);
    return Object.freeze({
      bySymbol,
      byIndustry: group(item => item.industry),
      byYear: group(item => String(item.exitAt || item.entryAt || "").slice(0, 4))
    });
  }

  function evidenceFor(history, result, retrievedAt, config) {
    const freshness = text(history?.freshness, 40) || "unknown";
    const source = text(history?.source || history?.provider, 180) || "unknown";
    const sampleCount = Number(result?.metrics?.sampleCount || 0);
    return Object.freeze({
      type: "volume_confirmation",
      symbol: text(history?.symbol, 40).toUpperCase(),
      market: text(history?.market, 20).toUpperCase(),
      title: "量價確認／量進價弱",
      summary: sampleCount
        ? `依可驗證 OHLCV 歷史資料找到 ${sampleCount} 個完成樣本；這是研究 Evidence，不是買賣建議。`
        : "目前沒有足夠可驗證 OHLCV 樣本完成量價確認；諸葛暫時不判斷。",
      source,
      sourceUrl: text(history?.sourceUrl || history?.source_url, 500),
      observedAt: text(history?.asOf || history?.as_of, 80),
      retrievedAt: text(retrievedAt, 80),
      quality: history?.available === true ? "provider" : "unavailable",
      freshness,
      stale: history?.stale === true || freshness === "stale",
      facts: [
        `pattern=bullish:${result?.patternCounts?.bullish || 0}`,
        `pattern=bearish_bull_trap:${result?.patternCounts?.bearish || 0}`,
        `sample_count=${sampleCount}`,
        `holding_horizon_bars=${config.holdingHorizonBars}`,
        `fee_bps=${config.feeBps}`,
        `slippage_bps=${config.slippageBps}`
      ],
      limitations: [
        "量縮／量增門檻是 Zhuge 可設定研究參數，不宣稱為外部研究原始定義。",
        "訊號在第二根 K 棒收盤後才成立，進場使用其後下一根 K 棒開盤。",
        ...(history?.stale === true ? ["歷史資料已超過 freshness window。"] : []),
        ...(sampleCount ? [] : ["INSUFFICIENT_EVIDENCE：沒有完成且可合法計算的樣本。"])
      ]
    });
  }

  function runHistory(input = {}) {
    const history = input.history && typeof input.history === "object" ? input.history : input;
    const engine = input.strategyBacktest || strategyBacktest;
    const config = cloneConfig(input);
    const retrievedAt = text(input.retrievedAt || input.retrieved_at || history.retrievedAt || history.retrieved_at) || new Date().toISOString();
    const symbol = text(input.symbol || history.symbol, 40).toUpperCase();
    const market = text(input.market || history.market, 20).toUpperCase();
    const bars = normalizeBars(history.bars);
    const base = {
      contract: CONTRACT,
      strategyId: STRATEGY_ID,
      symbol,
      market,
      status: STATUS.INSUFFICIENT_EVIDENCE,
      available: history.available === true && bars.length > 0,
      mutation: "none",
      readOnly: true,
      source: text(history.source || history.provider, 180),
      provider: text(history.provider, 120),
      sourceUrl: text(history.sourceUrl || history.source_url, 500),
      asOf: text(history.asOf || history.as_of, 80),
      retrievedAt,
      freshness: text(history.freshness, 40) || "unknown",
      stale: history.stale === true,
      bars: { input: list(history.bars).length, usable: bars.length },
      thresholds: Object.freeze(config),
      methodology: Object.freeze({
        signal: "contraction day → next trading day volume expansion + close direction",
        bullishPattern: "BULLISH_CONFIRMATION = expansion confirmation bar closes above open",
        bearishPattern: "BEARISH_BULL_TRAP = expansion confirmation bar closes below open",
        entry: "next bar open after confirmation close",
        holdingHorizonBars: config.holdingHorizonBars,
        costs: Object.freeze({ feeBps: config.feeBps, slippageBps: config.slippageBps }),
        lookaheadGuard: "confirmation bar close is never used as entry; entry starts at the following bar open",
        overlap: config.allowOverlap ? "allowed" : "non_overlapping_samples",
        thresholdAuthority: "configurable Zhuge research parameter; external source did not define a canonical threshold"
      }),
      patternCounts: Object.freeze({ candidates: 0, bullish: 0, bearish: 0, flat: 0, incomplete: 0 }),
      metrics: emptyMetrics(),
      patterns: Object.freeze({ bullish: emptyMetrics(), bearish: emptyMetrics() }),
      breakdown: Object.freeze({ bySymbol: Object.freeze([]), byIndustry: Object.freeze([]), byYear: Object.freeze([]) }),
      events: Object.freeze([]),
      warnings: Object.freeze([])
    };
    if (!engine?.runTimed) return Object.freeze({ ...base, status: STATUS.INVALID_INPUT, warnings: Object.freeze(["既有 Strategy Backtest timed contract 不可用。"]) });
    if (bars.length < config.minVolumeWindow + 3) {
      const warnings = [`至少需要 ${config.minVolumeWindow + 3} 根含 OHLCV bars，才能完成量縮、確認、進場與 holding horizon 計算。`];
      const result = Object.freeze({ ...base, evidence: Object.freeze([]), warnings: Object.freeze(warnings) });
      return Object.freeze({ ...result, evidence: Object.freeze([evidenceFor(history, result, retrievedAt, config)]) });
    }
    const eventSet = buildEvents(bars, config, { symbol, industry: input.industry, history });
    const timed = engine.runTimed({
      strategyId: STRATEGY_ID,
      bars,
      events: eventSet.confirmed,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      holdingHorizon: config.holdingHorizonBars,
      allowOverlap: config.allowOverlap
    });
    const result = {
      ...base,
      status: timed.status === strategyBacktest.STATUS?.INVALID_INPUT ? STATUS.INVALID_INPUT : timed.status === "AVAILABLE" ? STATUS.AVAILABLE : timed.status === "PARTIAL" ? STATUS.PARTIAL : STATUS.INSUFFICIENT_EVIDENCE,
      patternCounts: Object.freeze({ candidates: eventSet.candidates.length, bullish: eventSet.confirmed.filter(item => item.pattern === "BULLISH_CONFIRMATION").length, bearish: eventSet.confirmed.filter(item => item.pattern === "BEARISH_BULL_TRAP").length, flat: eventSet.flatConfirmations.length, incomplete: eventSet.confirmed.filter(item => item.exitIndex >= bars.length).length }),
      metrics: metricProjection(timed, config.holdingHorizonBars),
      patterns: Object.freeze({ bullish: patternMetrics(timed.trades, "BULLISH_CONFIRMATION", config.holdingHorizonBars, engine), bearish: patternMetrics(timed.trades, "BEARISH_BULL_TRAP", config.holdingHorizonBars, engine) }),
      events: Object.freeze(timed.trades),
      warnings: Object.freeze(unique(timed.warnings)),
      breakdown: breakdown(timed.trades, [], engine)
    };
    result.evidence = Object.freeze([evidenceFor(history, result, retrievedAt, config)]);
    if (result.status === STATUS.AVAILABLE && (eventSet.confirmed.length !== timed.trades.length || eventSet.rejected.length)) result.status = STATUS.PARTIAL;
    return Object.freeze(result);
  }

  function setPath(config, path, value) {
    const [group, key] = String(path).split(".");
    if (!config[group] || !(key in config[group])) return config;
    return { ...config, [group]: { ...config[group], [key]: value } };
  }

  function runThresholdSweep(input = {}) {
    const baseConfig = cloneConfig(input);
    const axes = input.sweep && typeof input.sweep === "object" ? input.sweep : DEFAULT_SWEEP;
    const configs = [baseConfig];
    for (const [path, values] of Object.entries(axes)) {
      for (const value of list(values)) configs.push(setPath(baseConfig, path, number(value)));
    }
    const uniqueConfigs = [];
    const seen = new Set();
    for (const config of configs) {
      const key = JSON.stringify(config);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueConfigs.push(config);
    }
    const runs = uniqueConfigs.map(config => runHistory({ ...input, config, includeSweep: false }));
    const sampled = runs.filter(item => item.metrics.sampleCount > 0);
    const averages = sampled.map(item => item.metrics.avgReturn).filter(value => Number.isFinite(value));
    const sampleCounts = runs.map(item => item.metrics.sampleCount);
    return Object.freeze({
      contract: CONTRACT,
      strategyId: STRATEGY_ID,
      symbol: text(input.symbol || input.history?.symbol, 40).toUpperCase(),
      status: sampled.length ? "AVAILABLE" : STATUS.INSUFFICIENT_EVIDENCE,
      baseConfig: Object.freeze(baseConfig),
      runs: Object.freeze(runs.map(item => Object.freeze({
        thresholds: item.thresholds,
        status: item.status,
        sampleCount: item.metrics.sampleCount,
        avgReturn: item.metrics.avgReturn,
        medianReturn: item.metrics.medianReturn,
        upRate: item.metrics.upRate,
        downRate: item.metrics.downRate,
        flatRate: item.metrics.flatRate,
        maxAdverseExcursion: item.metrics.maxAdverseExcursion,
        maxDrawdown: item.metrics.maxDrawdown
      }))),
      stability: Object.freeze({
        runCount: runs.length,
        runsWithSamples: sampled.length,
        sampleCountRange: Object.freeze([Math.min(...sampleCounts), Math.max(...sampleCounts)]),
        averageReturnRange: Object.freeze(averages.length ? [Math.min(...averages), Math.max(...averages)] : [null, null]),
        conclusion: sampled.length > 1 ? "參數掃描結果保留全貌；不以單一最好看的參數宣稱穩健。" : "目前沒有足夠樣本比較參數穩健性。"
      }),
      readOnly: true,
      mutation: "none"
    });
  }

  function runUniverse(input = {}) {
    const histories = list(input.histories || input.datasets).map(item => item?.history || item).filter(Boolean);
    const results = histories.map(history => runHistory({ ...input, history, industry: history.industry || input.industry, includeSweep: false }));
    const trades = results.flatMap(item => item.events || []);
    const engine = input.strategyBacktest || strategyBacktest;
    const aggregateMetrics = engine?.summarizeTrades
      ? metricProjection({ metrics: engine.summarizeTrades(trades, { holdingHorizon: cloneConfig(input).holdingHorizonBars }) }, cloneConfig(input).holdingHorizonBars)
      : emptyMetrics();
    return Object.freeze({
      contract: CONTRACT,
      strategyId: STRATEGY_ID,
      status: results.some(item => item.status === STATUS.AVAILABLE || item.status === STATUS.PARTIAL) ? "AVAILABLE" : STATUS.INSUFFICIENT_EVIDENCE,
      universe: text(input.universe || input.universeName, 120) || "available_history_sample",
      coverage: Object.freeze({ requested: histories.length, available: results.filter(item => item.available).length, withSamples: results.filter(item => item.metrics.sampleCount > 0).length }),
      results: Object.freeze(results),
      metrics: aggregateMetrics,
      breakdown: breakdown(trades, results, engine),
      limitations: Object.freeze(["跨標的彙總是 event-study sample summary，不代表有固定資金配置的投資組合報酬。", "沒有可取得歷史資料的標的保留 INSUFFICIENT_EVIDENCE，不補猜。"]),
      readOnly: true,
      mutation: "none"
    });
  }

  return Object.freeze({ CONTRACT, STRATEGY_ID, STATUS, DEFAULT_CONFIG, DEFAULT_SWEEP, normalizeBars, volumeMetricsAt, runHistory, runThresholdSweep, runUniverse });
});
