const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = value => finite(value) ? Number(value) : null;

function row(id, label, observation, available, source) {
  return Object.freeze({ id, label, observation, status: available ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE", source });
}

function validOhlc(bar) {
  const open = number(bar?.open), high = number(bar?.high), low = number(bar?.low), close = number(bar?.close);
  if ([open, high, low, close].some(value => value === null) || high < low
    || high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return { open, high, low, close, range: high - low, body: Math.abs(close - open) };
}

function latestCandleShape(bar) {
  const candle = validOhlc(bar);
  if (!candle || candle.range <= 0) return { text: "完整 OHLC 範圍不足", available: false };
  const { open, high, low, close, range, body } = candle;
  const upperShadow = high - Math.max(open, close);
  const lowerShadow = Math.min(open, close) - low;
  const bodyShare = body / range;
  const labels = [];
  if (bodyShare <= 0.1) labels.push("十字線外觀");
  if (body > 0 && lowerShadow >= body * 2 && upperShadow <= body * 0.35 && bodyShare <= 0.4) labels.push("長下影錘頭外觀");
  if (body > 0 && upperShadow >= body * 2 && lowerShadow <= body * 0.35 && bodyShare <= 0.4) labels.push("長上影射擊之星外觀");
  if (bodyShare >= 0.9) labels.push("長實體 K 棒");
  if (upperShadow / range >= 0.6) labels.push("長上影");
  if (lowerShadow / range >= 0.6) labels.push("長下影");
  return {
    text: labels.length ? labels.join("；") : "未符合本矩陣的單根 K 棒外觀條件",
    available: true,
  };
}

function twoCandleRelationship(bars) {
  if (bars.length < 2) return { text: "至少需要兩根完整 OHLC K 線", available: false };
  const [previous, current] = bars.slice(-2).map(validOhlc);
  if (!previous || !current) return { text: "前兩根 K 線 OHLC 不完整或高低價順序無效", available: false };
  const priorBullish = previous.close > previous.open;
  const priorBearish = previous.close < previous.open;
  const currentBullish = current.close > current.open;
  const currentBearish = current.close < current.open;
  const previousBodyLow = Math.min(previous.open, previous.close);
  const previousBodyHigh = Math.max(previous.open, previous.close);
  const currentBodyLow = Math.min(current.open, current.close);
  const currentBodyHigh = Math.max(current.open, current.close);
  const previousMidpoint = (previous.open + previous.close) / 2;
  const labels = [];
  if (priorBearish && currentBullish && current.open <= previous.close && current.close >= previous.open) labels.push("符合多方吞噬條件");
  if (priorBullish && currentBearish && current.open >= previous.close && current.close <= previous.open) labels.push("符合空方吞噬條件");
  if (priorBearish && currentBullish && currentBodyLow > previousBodyLow && currentBodyHigh < previousBodyHigh) labels.push("符合多方母子線外觀");
  if (priorBullish && currentBearish && currentBodyLow > previousBodyLow && currentBodyHigh < previousBodyHigh) labels.push("符合空方母子線外觀");
  if (priorBearish && currentBullish && current.open < previous.close && current.close > previousMidpoint && current.close < previous.open) labels.push("符合貫穿線條件");
  if (priorBullish && currentBearish && current.open > previous.close && current.close < previousMidpoint && current.close > previous.open) labels.push("符合烏雲蓋頂條件");
  if (current.high <= previous.high && current.low >= previous.low) labels.push("內包 K 棒");
  if (current.high >= previous.high && current.low <= previous.low) labels.push("外包 K 棒");
  return {
    text: labels.length ? labels.join("；") : "未符合本矩陣的雙 K 棒關係條件",
    available: true,
  };
}

function threeCandleRelationship(bars) {
  if (bars.length < 3) return { text: "至少需要三根完整 OHLC K 線", available: false };
  const [first, middle, latest] = bars.slice(-3).map(validOhlc);
  if (!first || !middle || !latest || [first, middle, latest].some(candle => candle.range <= 0)) {
    return { text: "最近三根 K 線 OHLC 不完整、高低價順序無效或區間為零", available: false };
  }
  const firstShare = first.body / first.range;
  const middleShare = middle.body / middle.range;
  const firstBearish = first.close < first.open;
  const firstBullish = first.close > first.open;
  const latestBullish = latest.close > latest.open;
  const latestBearish = latest.close < latest.open;
  const midpoint = (first.open + first.close) / 2;
  const labels = [];
  if (firstBearish && firstShare >= 0.6 && middleShare <= 0.3 && latestBullish && latest.close >= midpoint) {
    labels.push("符合晨星外觀條件");
  }
  if (firstBullish && firstShare >= 0.6 && middleShare <= 0.3 && latestBearish && latest.close <= midpoint) {
    labels.push("符合夜星外觀條件");
  }
  const firstBodyLow = Math.min(first.open, first.close);
  const firstBodyHigh = Math.max(first.open, first.close);
  const middleBodyLow = Math.min(middle.open, middle.close);
  const middleBodyHigh = Math.max(middle.open, middle.close);
  const latestBodyLow = Math.min(latest.open, latest.close);
  const latestBodyHigh = Math.max(latest.open, latest.close);
  if ([first, middle, latest].every(candle => candle.close > candle.open)
    && latest.close > middle.close && middle.close > first.close
    && middle.open >= firstBodyLow && middle.open <= firstBodyHigh
    && latest.open >= middleBodyLow && latest.open <= middleBodyHigh) labels.push("三根連續上漲實體外觀");
  if ([first, middle, latest].every(candle => candle.close < candle.open)
    && latest.close < middle.close && middle.close < first.close
    && middle.open >= firstBodyLow && middle.open <= firstBodyHigh
    && latest.open >= middleBodyLow && latest.open <= middleBodyHigh) labels.push("三根連續下跌實體外觀");
  return {
    text: labels.length ? labels.join("；") : "未符合本矩陣的三 K 棒外觀條件",
    available: true,
  };
}

/** Deterministic descriptive observations; never emits a trade action or composite score. */
export function buildTechnicalSignalMatrix(bars = [], indicators = {}) {
  const history = Array.isArray(bars) ? bars : [];
  const latest = history.at(-1) || {};
  const sma5 = number(indicators.sma5), sma20 = number(indicators.sma20);
  const rsi = number(indicators.rsi14);
  const macd = number(indicators.macd?.macd), macdSignal = number(indicators.macd?.signal);
  const close = number(latest.close);
  const upper = number(indicators.bollinger20?.upper), lower = number(indicators.bollinger20?.lower);
  const latestVolume = number(latest.volume), averageVolume = number(indicators.volume?.average5);
  const trend = sma5 == null || sma20 == null ? "需要 MA5 與 MA20 歷史樣本"
    : sma5 > sma20 ? "MA5 高於 MA20"
      : sma5 < sma20 ? "MA5 低於 MA20" : "MA5 與 MA20 相同";
  const rsiText = rsi == null ? "RSI(14) 歷史樣本不足"
    : rsi >= 70 ? `RSI(14) ${rsi.toFixed(2)} · 高區觀察`
      : rsi <= 30 ? `RSI(14) ${rsi.toFixed(2)} · 低區觀察`
        : `RSI(14) ${rsi.toFixed(2)} · 中段`;
  const macdText = macd == null || macdSignal == null ? "MACD 歷史樣本不足"
    : macd > macdSignal ? "MACD 線高於訊號線"
      : macd < macdSignal ? "MACD 線低於訊號線" : "MACD 線與訊號線相同";
  const bollingerText = close == null || upper == null || lower == null ? "收盤價或布林上下軌不足"
    : close > upper ? "收盤價高於布林上軌"
      : close < lower ? "收盤價低於布林下軌" : "收盤價位於布林通道內";
  const volumeText = latestVolume == null || averageVolume == null ? "近 5 日量能樣本不足"
    : latestVolume > averageVolume ? "最新量高於近 5 日均量"
      : latestVolume < averageVolume ? "最新量低於近 5 日均量" : "最新量等於近 5 日均量";
  const candle = latestCandleShape(latest);
  const relationship = twoCandleRelationship(history);
  const multiCandle = threeCandleRelationship(history);
  return Object.freeze([
    row("trend", "均線結構", trend, sma5 != null && sma20 != null, "MA5 / MA20"),
    row("rsi", "RSI(14)", rsiText, rsi != null, "實際 OHLC 收盤序列"),
    row("macd", "MACD", macdText, macd != null && macdSignal != null, "EMA 12 / 26 / 9"),
    row("bollinger", "布林通道", bollingerText, close != null && upper != null && lower != null, "20 日均線 ± 2σ"),
    row("volume", "量能", volumeText, latestVolume != null && averageVolume != null, "來源成交量 / 近 5 日均量"),
    row("candle-shape", "單根 K 棒外觀", candle.text, candle.available, "最新來源 OHLC；影線／實體比例條件"),
    row("candle-relationship", "雙 K 棒關係", relationship.text, relationship.available, "最近兩根來源 OHLC"),
    row("multi-candle-pattern", "三 K 棒形態條件", multiCandle.text, multiCandle.available, "最近三根來源 OHLC；比例與收盤關係規則 v1"),
  ]);
}

const esc = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

export function renderTechnicalSignalMatrix(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return '<p class="empty-state">目前沒有技術觀察資料。</p>';
  return `<div class="data-table-wrap"><table class="data-table technical-signal-matrix"><thead><tr><th>觀察項目</th><th>來源計算結果</th><th>資料狀態</th><th>方法</th></tr></thead><tbody>${rows.map(item => `<tr data-matrix-status="${esc(item.status)}"><th>${esc(item.label)}</th><td>${esc(item.observation)}</td><td>${item.status === "AVAILABLE" ? "可計算" : "資料不足"}</td><td>${esc(item.source)}</td></tr>`).join("")}</tbody></table></div><p class="tiny-note">條件式技術觀察，不是買賣訊號或綜合評分；歷史樣本不足時保留資料不足。</p>`;
}
