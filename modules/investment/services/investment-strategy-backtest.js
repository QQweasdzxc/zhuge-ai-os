(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyBacktest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * A deterministic, read-only methodology contract. It evaluates caller-
   * supplied, evidence-backed signals against normalized historical bars. It
   * does not generate signals, choose a strategy, or write a decision record.
   */
  const CONTRACT = "zhuge-investment-strategy-backtest-v1";
  const STATUS = Object.freeze({
    AVAILABLE: "AVAILABLE",
    PARTIAL: "PARTIAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    INVALID_INPUT: "INVALID_INPUT"
  });

  function text(value, max = 500) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function unique(values) {
    return [...new Set(list(values).map(item => text(item)).filter(Boolean))];
  }

  function evidenceRef(value = {}) {
    return Object.freeze({
      source: text(value.source || value.provider, 180) || "unknown",
      observedAt: text(value.observedAt || value.asOf || value.as_of, 80),
      freshness: text(value.freshness, 40) || "unknown",
      sourceUrl: text(value.sourceUrl || value.source_url, 500)
    });
  }

  function normalizeBars(rows) {
    return list(rows).map((row, index) => {
      const timestamp = text(row?.timestamp || row?.date || row?.asOf || row?.as_of, 80);
      const open = number(row?.open);
      const high = number(row?.high);
      const low = number(row?.low);
      const close = number(row?.close);
      const volume = number(row?.volume);
      if (!timestamp || open === null || close === null || open <= 0 || close <= 0) return null;
      return Object.freeze({ index, timestamp, open, high, low, close, volume });
    }).filter(Boolean);
  }

  function normalizeSignals(rows) {
    return list(rows).map((row, index) => {
      const action = text(row?.action || row?.side, 20).toUpperCase();
      const barIndex = Number.isInteger(row?.barIndex) ? row.barIndex : Number(row?.bar_index);
      const strategyId = text(row?.strategyId || row?.strategy_id, 100);
      if (!Number.isInteger(barIndex) || barIndex < 0 || !["ENTER", "EXIT"].includes(action)) return Object.freeze({ index, valid: false, action, barIndex });
      return Object.freeze({
        index,
        valid: true,
        action,
        barIndex,
        strategyId,
        reason: text(row?.reason || row?.summary, 300),
        evidenceRefs: Object.freeze(list(row?.evidenceRefs || row?.evidence_refs).map(evidenceRef).slice(0, 4))
      });
    });
  }

  function baseResult(input, status, warnings = []) {
    return {
      contract: CONTRACT,
      status,
      strategyId: text(input.strategyId || input.strategy_id, 100),
      bars: { input: list(input.bars).length, usable: 0 },
      signals: { input: list(input.signals).length, usable: 0 },
      trades: [],
      metrics: {
        completedTrades: 0,
        sampleCount: 0,
        winRate: null,
        upRate: null,
        downRate: null,
        flatRate: null,
        averageReturn: null,
        medianReturn: null,
        cumulativeReturn: null,
        maxDrawdown: null,
        maxAdverseExcursion: null,
        openPosition: false
      },
      warnings: unique(warnings),
      evidence: Object.freeze(list(input.evidence).slice(0, 8).map(evidenceRef)),
      methodology: Object.freeze({
        execution: "next_bar_open",
        lookaheadGuard: "signals are evaluated only on a later bar open",
        costs: "fee_bps and slippage_bps are applied to fills",
        signalAuthority: "caller-supplied evidence-backed signals only"
      }),
      readOnly: true,
      mutation: "none"
    };
  }

  function median(values) {
    const sorted = values.slice().sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function summarizeTrades(trades, options = {}) {
    const returns = trades.map(trade => Number(trade.return)).filter(Number.isFinite);
    const wins = returns.filter(value => value > 0).length;
    const losses = returns.filter(value => value < 0).length;
    const flats = returns.length - wins - losses;
    const equity = [1];
    for (const trade of trades) equity.push(equity[equity.length - 1] * (1 + trade.return));
    let peak = equity[0];
    let maxDrawdown = 0;
    for (const value of equity) {
      peak = Math.max(peak, value);
      maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    }
    const maes = trades.map(trade => Number(trade.maxAdverseExcursion)).filter(Number.isFinite);
    return {
      completedTrades: trades.length,
      sampleCount: trades.length,
      winRate: returns.length ? wins / returns.length : null,
      upRate: returns.length ? wins / returns.length : null,
      downRate: returns.length ? losses / returns.length : null,
      flatRate: returns.length ? flats / returns.length : null,
      averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      medianReturn: median(returns),
      cumulativeReturn: returns.length ? equity[equity.length - 1] - 1 : null,
      maxDrawdown: returns.length ? maxDrawdown : null,
      maxAdverseExcursion: maes.length ? Math.min(...maes) : null,
      holdingHorizon: options.holdingHorizon ?? null,
      openPosition: Boolean(options.openPosition)
    };
  }

  function run(input = {}) {
    const bars = normalizeBars(input.bars);
    const signals = normalizeSignals(input.signals);
    const result = baseResult(input, STATUS.INSUFFICIENT_EVIDENCE);
    result.bars.usable = bars.length;
    result.signals.usable = signals.filter(item => item.valid).length;
    if (bars.length < 2) {
      result.warnings.push("至少需要兩根含 open/close 的歷史 bars；不以單一價格回測。");
      return Object.freeze(result);
    }
    if (!signals.length) {
      result.warnings.push("沒有 caller-supplied signal；不自行產生策略訊號。");
      return Object.freeze(result);
    }
    if (signals.some(item => !item.valid)) {
      result.status = STATUS.INVALID_INPUT;
      result.warnings.push("存在無效 signal；action 必須是 ENTER／EXIT，且必須指定 barIndex。");
      return Object.freeze(result);
    }
    const feeBps = Math.min(1000, Math.max(0, number(input.feeBps ?? input.fee_bps) ?? 0));
    const slippageBps = Math.min(1000, Math.max(0, number(input.slippageBps ?? input.slippage_bps) ?? 0));
    const feeRate = feeBps / 10000;
    const slippageRate = slippageBps / 10000;
    let open = null;
    const warnings = [];
    const trades = [];
    for (const signal of signals.slice().sort((left, right) => left.barIndex - right.barIndex || left.index - right.index)) {
      if (signal.barIndex >= bars.length) {
        warnings.push(`signal ${signal.index} 超出 bars 範圍，已忽略。`);
        continue;
      }
      const executionIndex = signal.barIndex + 1;
      if (executionIndex >= bars.length) {
        warnings.push(`signal ${signal.index} 沒有下一根 bar 可執行，已忽略。`);
        continue;
      }
      const executionBar = bars[executionIndex];
      const fill = signal.action === "ENTER"
        ? executionBar.open * (1 + slippageRate)
        : executionBar.open * (1 - slippageRate);
      if (!(fill > 0)) {
        warnings.push(`signal ${signal.index} 的執行價格無效，已忽略。`);
        continue;
      }
      if (signal.action === "ENTER") {
        if (open) {
          warnings.push(`signal ${signal.index} 在已有持倉時再次 ENTER，已忽略。`);
          continue;
        }
        open = { signal, executionIndex, timestamp: executionBar.timestamp, price: fill };
        continue;
      }
      if (!open) {
        warnings.push(`signal ${signal.index} 在沒有持倉時 EXIT，已忽略。`);
        continue;
      }
      const netReturn = ((fill * (1 - feeRate)) / (open.price * (1 + feeRate))) - 1;
      trades.push(Object.freeze({
        strategyId: signal.strategyId || open.signal.strategyId,
        entrySignalIndex: open.signal.index,
        exitSignalIndex: signal.index,
        entryAt: open.timestamp,
        exitAt: executionBar.timestamp,
        entryPrice: open.price,
        exitPrice: fill,
        return: netReturn,
        evidenceRefs: Object.freeze([...open.signal.evidenceRefs, ...signal.evidenceRefs].slice(0, 8))
      }));
      open = null;
    }
    if (open) warnings.push("回測期間結束時仍有未平倉 signal；未把未實現結果當成已實現交易。");
    result.trades = trades;
    result.metrics = summarizeTrades(trades, { openPosition: open });
    result.warnings = unique(warnings);
    result.status = trades.length
      ? open || warnings.length ? STATUS.PARTIAL : STATUS.AVAILABLE
      : STATUS.INSUFFICIENT_EVIDENCE;
    return Object.freeze(result);
  }

  function normalizeTimedEvents(rows) {
    return list(rows).map((row, index) => {
      const confirmationIndex = Number.isInteger(row?.confirmationIndex)
        ? row.confirmationIndex
        : Number(row?.confirmation_index);
      const entryIndex = Number.isInteger(row?.entryIndex) ? row.entryIndex : Number(row?.entry_index);
      const exitIndex = Number.isInteger(row?.exitIndex) ? row.exitIndex : Number(row?.exit_index);
      const pattern = text(row?.pattern || row?.direction, 80);
      const valid = Number.isInteger(confirmationIndex) && confirmationIndex >= 0
        && Number.isInteger(entryIndex) && entryIndex > confirmationIndex
        && Number.isInteger(exitIndex) && exitIndex >= entryIndex;
      return Object.freeze({
        index,
        valid,
        confirmationIndex,
        entryIndex,
        exitIndex,
        pattern,
        symbol: text(row?.symbol, 40).toUpperCase(),
        industry: text(row?.industry, 160) || "unknown",
        strategyId: text(row?.strategyId || row?.strategy_id, 100),
        reason: text(row?.reason || row?.summary, 300),
        evidenceRefs: Object.freeze(list(row?.evidenceRefs || row?.evidence_refs).map(evidenceRef).slice(0, 8))
      });
    });
  }

  function runTimed(input = {}) {
    const bars = normalizeBars(input.bars);
    const events = normalizeTimedEvents(input.events);
    const result = baseResult(input, STATUS.INSUFFICIENT_EVIDENCE);
    result.bars.usable = bars.length;
    result.signals = { input: events.length, usable: events.filter(item => item.valid).length };
    result.methodology = Object.freeze({
      execution: "confirmation_close_then_next_bar_open",
      lookaheadGuard: "confirmation is known only after confirmation bar close; entry uses the following bar open",
      exit: "holding_horizon_bars uses the entry bar as bar 1 and exits at that bar close",
      costs: "fee_bps and slippage_bps are applied to entry and exit fills",
      signalAuthority: "caller-supplied evidence-backed events only"
    });
    if (bars.length < 2) {
      result.warnings.push("至少需要兩根含 open/close 的歷史 bars；不以單一價格回測。");
      return Object.freeze(result);
    }
    if (!events.length) {
      result.warnings.push("沒有 caller-supplied event；不自行產生策略訊號。");
      return Object.freeze(result);
    }
    if (events.some(item => !item.valid)) {
      result.status = STATUS.INVALID_INPUT;
      result.warnings.push("存在無效 timed event；confirmationIndex < entryIndex <= exitIndex 是必要條件。");
      return Object.freeze(result);
    }
    const feeBps = Math.min(1000, Math.max(0, number(input.feeBps ?? input.fee_bps) ?? 0));
    const slippageBps = Math.min(1000, Math.max(0, number(input.slippageBps ?? input.slippage_bps) ?? 0));
    const feeRate = feeBps / 10000;
    const slippageRate = slippageBps / 10000;
    const warnings = [];
    const trades = [];
    let lastExitIndex = -1;
    for (const event of events.slice().sort((left, right) => left.entryIndex - right.entryIndex || left.index - right.index)) {
      if (event.exitIndex >= bars.length || event.entryIndex >= bars.length) {
        warnings.push(`event ${event.index} 沒有足夠 bars 完成 holding horizon，已忽略。`);
        continue;
      }
      if (event.entryIndex <= lastExitIndex && input.allowOverlap !== true) {
        warnings.push(`event ${event.index} 與前一樣本重疊；allowOverlap=false，已忽略。`);
        continue;
      }
      const entryBar = bars[event.entryIndex];
      const exitBar = bars[event.exitIndex];
      const entryPrice = entryBar.open * (1 + slippageRate);
      const exitPrice = exitBar.close * (1 - slippageRate);
      if (!(entryPrice > 0) || !(exitPrice > 0)) {
        warnings.push(`event ${event.index} 的 entry/exit price 無效，已忽略。`);
        continue;
      }
      const netReturn = ((exitPrice * (1 - feeRate)) / (entryPrice * (1 + feeRate))) - 1;
      const lows = bars.slice(event.entryIndex, event.exitIndex + 1).map(item => item.low).filter(value => Number.isFinite(value) && value > 0);
      const maxAdverseExcursion = lows.length ? Math.min(...lows.map(low => low / entryPrice - 1)) : null;
      trades.push(Object.freeze({
        strategyId: event.strategyId || text(input.strategyId, 100),
        pattern: event.pattern,
        symbol: event.symbol,
        industry: event.industry,
        confirmationAt: bars[event.confirmationIndex].timestamp,
        entryAt: entryBar.timestamp,
        exitAt: exitBar.timestamp,
        confirmationIndex: event.confirmationIndex,
        entryIndex: event.entryIndex,
        exitIndex: event.exitIndex,
        entryPrice,
        exitPrice,
        return: netReturn,
        maxAdverseExcursion,
        evidenceRefs: event.evidenceRefs
      }));
      lastExitIndex = event.exitIndex;
    }
    result.trades = trades;
    result.metrics = summarizeTrades(trades, {
      holdingHorizon: input.holdingHorizon ?? input.holding_horizon,
      openPosition: false
    });
    result.methodology = Object.freeze({
      ...result.methodology,
      feeBps,
      slippageBps,
      overlap: input.allowOverlap === true ? "allowed" : "non_overlapping_samples"
    });
    result.warnings = unique(warnings);
    result.status = trades.length
      ? warnings.length ? STATUS.PARTIAL : STATUS.AVAILABLE
      : STATUS.INSUFFICIENT_EVIDENCE;
    return Object.freeze(result);
  }

  return Object.freeze({ CONTRACT, STATUS, normalizeBars, normalizeSignals, normalizeTimedEvents, summarizeTrades, run, runTimed });
});
