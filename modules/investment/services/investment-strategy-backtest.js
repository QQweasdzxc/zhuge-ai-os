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
        winRate: null,
        cumulativeReturn: null,
        maxDrawdown: null,
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
    const equity = [1];
    for (const trade of trades) equity.push(equity[equity.length - 1] * (1 + trade.return));
    let peak = equity[0];
    let maxDrawdown = 0;
    for (const value of equity) {
      peak = Math.max(peak, value);
      maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    }
    const wins = trades.filter(trade => trade.return > 0).length;
    result.trades = trades;
    result.metrics = {
      completedTrades: trades.length,
      winRate: trades.length ? wins / trades.length : null,
      cumulativeReturn: trades.length ? equity[equity.length - 1] - 1 : null,
      maxDrawdown: trades.length ? maxDrawdown : null,
      openPosition: Boolean(open)
    };
    result.warnings = unique(warnings);
    result.status = trades.length
      ? open || warnings.length ? STATUS.PARTIAL : STATUS.AVAILABLE
      : STATUS.INSUFFICIENT_EVIDENCE;
    return Object.freeze(result);
  }

  return Object.freeze({ CONTRACT, STATUS, normalizeBars, normalizeSignals, run });
});
