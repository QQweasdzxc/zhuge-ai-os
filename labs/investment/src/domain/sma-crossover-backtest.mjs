const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => String(value ?? "").trim();

function normalizedBars(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    timestamp: text(row?.timestamp || row?.date || row?.asOf || row?.as_of),
    open: number(row?.open),
    high: number(row?.high),
    low: number(row?.low),
    close: number(row?.close),
    volume: number(row?.volume),
  })).filter(row => row.timestamp && row.open > 0 && row.close > 0);
}

function meanAt(values, index, window) {
  if (index + 1 < window) return null;
  const sample = values.slice(index + 1 - window, index + 1);
  if (sample.some(value => value === null)) return null;
  return sample.reduce((sum, value) => sum + value, 0) / window;
}

/** Build explicit close-confirmed SMA cross signals; the backtest engine fills at the next bar open. */
export function buildSmaCrossoverSignals(rows, { fastWindow = 5, slowWindow = 20, provider = "market history", sourceUrl = "" } = {}) {
  const bars = normalizedBars(rows);
  const fast = Number(fastWindow);
  const slow = Number(slowWindow);
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 2 || slow <= fast || slow > 200) {
    return Object.freeze({ status: "INVALID_INPUT", bars: Object.freeze(bars), signals: Object.freeze([]), fastWindow: fast, slowWindow: slow, reason: "快線必須至少 2 日，且慢線必須大於快線並不超過 200 日。" });
  }
  if (bars.length < slow + 1) {
    return Object.freeze({ status: "INSUFFICIENT_EVIDENCE", bars: Object.freeze(bars), signals: Object.freeze([]), fastWindow: fast, slowWindow: slow, reason: `至少需要 ${slow + 1} 根有效 OHLCV 才能確認一次交叉。` });
  }
  for (let index = 1; index < bars.length; index += 1) {
    const currentMs = Date.parse(bars[index].timestamp);
    const previousMs = Date.parse(bars[index - 1].timestamp);
    if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs) || currentMs <= previousMs) {
      return Object.freeze({ status: "INVALID_INPUT", bars: Object.freeze(bars), signals: Object.freeze([]), fastWindow: fast, slowWindow: slow, reason: "歷史 bars 必須使用有效且不重複的日期，並依日期由舊到新排列。" });
    }
  }
  const closes = bars.map(bar => bar.close);
  const signals = [];
  let inPosition = false;
  for (let index = slow; index < bars.length; index += 1) {
    const priorFast = meanAt(closes, index - 1, fast);
    const priorSlow = meanAt(closes, index - 1, slow);
    const currentFast = meanAt(closes, index, fast);
    const currentSlow = meanAt(closes, index, slow);
    if ([priorFast, priorSlow, currentFast, currentSlow].some(value => value === null)) continue;
    const crossedUp = priorFast <= priorSlow && currentFast > currentSlow;
    const crossedDown = priorFast >= priorSlow && currentFast < currentSlow;
    const action = !inPosition && crossedUp ? "ENTER" : inPosition && crossedDown ? "EXIT" : "";
    if (!action) continue;
    inPosition = action === "ENTER";
    signals.push(Object.freeze({
      action,
      barIndex: index,
      strategyId: `sma-${fast}-x-${slow}-close-confirmed-v1`,
      reason: `${bars[index].timestamp} 收盤確認 SMA${fast} ${action === "ENTER" ? "上穿" : "下穿"} SMA${slow}`,
      evidenceRefs: Object.freeze([{ source: provider, observedAt: bars[index].timestamp, freshness: "source-dated", sourceUrl }]),
    }));
  }
  return Object.freeze({
    status: signals.length ? "READY" : "NO_CROSSINGS",
    bars: Object.freeze(bars),
    signals: Object.freeze(signals),
    fastWindow: fast,
    slowWindow: slow,
    reason: signals.length ? "交叉訊號以收盤值確認，回測引擎於下一根 bar 開盤執行。" : "所選期間沒有完整的 SMA 交叉交易；沒有生成回測績效。",
  });
}

export function runSmaCrossoverBacktest(rows, engine, options = {}) {
  if (typeof engine?.run !== "function") throw new TypeError("既有 Investment Strategy Backtest engine 不可用。");
  const plan = buildSmaCrossoverSignals(rows, options);
  if (plan.status !== "READY") return Object.freeze({ plan, result: null });
  const result = engine.run({
    strategyId: `sma-${plan.fastWindow}-x-${plan.slowWindow}-close-confirmed-v1`,
    bars: plan.bars,
    signals: plan.signals,
    feeBps: options.feeBps ?? 0,
    slippageBps: options.slippageBps ?? 0,
    evidence: [{ source: options.provider || "market history", observedAt: plan.bars.at(-1)?.timestamp, freshness: "source-dated", sourceUrl: options.sourceUrl || "" }],
  });
  return Object.freeze({ plan, result, settings: Object.freeze({ feeBps: Number(options.feeBps ?? 0), slippageBps: Number(options.slippageBps ?? 0) }) });
}
