function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function ema(values, period) {
  if (values.length < period) return [];
  const factor = 2 / (period + 1);
  const result = new Array(period - 1).fill(null);
  let current = average(values.slice(0, period));
  result.push(current);
  for (let i = period; i < values.length; i++) {
    current = values[i] * factor + current * (1 - factor);
    result.push(current);
  }
  return result;
}

const last = (values) => values.length ? values.at(-1) : null;

export function calculateIndicators(bars) {
  const clean = Array.isArray(bars) ? bars.filter((bar) => Number.isFinite(bar.close)) : [];
  const closes = clean.map((bar) => bar.close);
  const volumes = clean.map((bar) => bar.volume).filter(Number.isFinite);
  const enoughHistory = closes.length >= 26;
  const sma = (period) => closes.length >= period ? average(closes.slice(-period)) : null;

  let rsi14 = null;
  if (closes.length >= 15) {
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const delta = closes[i] - closes[i - 1];
      if (delta > 0) gains += delta;
      else losses -= delta;
    }
    if (losses === 0) rsi14 = gains === 0 ? 50 : 100;
    else {
      const rs = (gains / 14) / (losses / 14);
      rsi14 = 100 - 100 / (1 + rs);
    }
  }

  let kd = null;
  if (clean.length >= 9 && clean.slice(-9).every((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low))) {
    let k = 50;
    let d = 50;
    for (let i = Math.max(8, clean.length - 14); i < clean.length; i++) {
      const window = clean.slice(i - 8, i + 1);
      const high = Math.max(...window.map((bar) => bar.high));
      const low = Math.min(...window.map((bar) => bar.low));
      const rsv = high === low ? 50 : ((clean[i].close - low) / (high - low)) * 100;
      k = (2 / 3) * k + (1 / 3) * rsv;
      d = (2 / 3) * d + (1 / 3) * k;
    }
    kd = { k, d, period: 9, initialization: "K=50 / D=50" };
  }

  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdLine = closes.map((_, index) => fast[index] == null || slow[index] == null ? null : fast[index] - slow[index]);
  const validMacd = macdLine.filter(Number.isFinite);
  const signal = ema(validMacd, 9);
  const macdValue = last(macdLine);
  const signalValue = last(signal);
  const macd = macdValue == null || signalValue == null ? null : {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
    periods: "12 / 26 / 9",
  };

  let bollinger20 = null;
  if (closes.length >= 20) {
    const window = closes.slice(-20);
    const mid = average(window);
    const variance = average(window.map((value) => (value - mid) ** 2));
    const deviation = Math.sqrt(variance);
    bollinger20 = { lower: mid - 2 * deviation, middle: mid, upper: mid + 2 * deviation, period: 20, deviations: 2 };
  }

  return {
    asOf: clean.at(-1)?.date ?? null,
    barsUsed: clean.length,
    sma5: sma(5),
    sma20: sma(20),
    rsi14,
    kd,
    macd,
    bollinger20,
    volume: volumes.length ? { latest: volumes.at(-1), average5: volumes.length >= 5 ? average(volumes.slice(-5)) : null } : null,
    status: enoughHistory ? "AVAILABLE" : "PARTIAL",
    errorCode: enoughHistory ? null : "HISTORY_TOO_SHORT",
    note: "由實際官方日 OHLCV 計算；使用未還原價格，僅供研究，不構成交易建議。",
  };
}
