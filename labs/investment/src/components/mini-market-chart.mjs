const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function priceLabel(value, currency) {
  if (!finite(value)) return "—";
  const numeric = Number(value);
  const prefix = currency === "USD" ? "US$" : currency === "TWD" ? "NT$" : "";
  const amount = Math.abs(numeric).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  return (numeric < 0 ? "-" : "") + prefix + amount;
}

function historyMeta(evidence = {}) {
  const provider = evidence.provider || "Provider 未提供";
  const dataDate = evidence.dataTimestamp || "日期未提供";
  const delayed = evidence.delayed === true ? "延遲收盤" : evidence.delayed === false ? "非延遲標示" : "延遲狀態未標示";
  const freshness = evidence.stale === true ? "資料較舊" : evidence.stale === false ? "時效正常" : "時效未確認";
  const fallback = evidence.fallback === true ? "Fallback：同來源快取" : "Fallback：否";
  return [provider, dataDate, delayed, freshness, fallback, evidence.errorCode].filter(Boolean).join(" · ");
}

function validCandle(row) {
  if (![row?.open, row?.high, row?.low, row?.close].every(finite)) return false;
  const open = Number(row.open), high = Number(row.high), low = Number(row.low), close = Number(row.close);
  return high >= low && high >= Math.max(open, close) && low <= Math.min(open, close);
}

function emptyChart({ mode, evidence }) {
  const state = evidence?.status === "UNAVAILABLE" || evidence?.status === "ERROR" ? "UNAVAILABLE" : "NOT_CONNECTED";
  const message = evidence?.errorCode === "EXTERNAL_SECRET_REQUIRED"
    ? "美股歷史行情來源暫時無法取得；Alpaca 僅是可選備援，並非使用必要條件。"
    : evidence?.errorCode === "HISTORY_NOT_CONNECTED"
      ? "此掛牌市場尚無已驗證的官方歷史行情來源。"
      : state === "NOT_CONNECTED" ? "歷史行情尚未接通" : "歷史行情暫時無法取得";
  return '<section class="mini-market-chart" data-mode="' + mode + '" data-chart-type="none" data-state="' + state + '" data-bar-count="0" data-has-volume="false" data-has-cost-reference="false" aria-label="' + (mode === "portfolio" ? "持股" : "研究") + '近 20 日行情">'
    + '<div class="mini-market-chart-head"><strong>近 20 日行情</strong><span class="mini-market-chart-state" data-state="' + state + '">' + state + '</span></div>'
    + '<p class="mini-market-chart-empty">' + message + '</p>'
    + '<p class="mini-market-chart-meta">' + escapeHtml(historyMeta(evidence || {})) + '</p>'
    + '</section>';
}

/**
 * Single Mini Market Chart authority for Lab research and portfolio cards.
 * It visualizes only supplied provider evidence; missing OHLC never becomes a candle.
 */
export function MiniMarketChart({ evidence = null, mode = "research", averageCost = null, currency = "TWD" } = {}) {
  const chartMode = mode === "portfolio" ? "portfolio" : "research";
  if (evidence?.status === "NOT_CONNECTED" || !Array.isArray(evidence?.data) || !evidence.data.length) {
    return emptyChart({ mode: chartMode, evidence });
  }

  const bars = evidence.data
    .filter((row) => row && finite(row.close) && Number(row.close) >= 0)
    .slice(-20);
  if (!bars.length) return emptyChart({ mode: chartMode, evidence });

  const candlesAvailable = bars.every(validCandle);
  const chartType = candlesAvailable ? "candlestick" : "close-line";
  const chartState = candlesAvailable ? (evidence.status || "AVAILABLE") : "PARTIAL_HISTORY";
  const useCost = chartMode === "portfolio" && finite(averageCost) && Number(averageCost) >= 0;
  const cost = useCost ? Number(averageCost) : null;
  const volumePoints = bars.map((row, index) => ({ row, index, volume: row.volume }))
    .filter((item) => finite(item.volume) && Number(item.volume) >= 0);
  const hasVolume = volumePoints.length > 0;
  const plotTop = 5;
  const plotBottom = hasVolume ? 52 : 70;
  const viewHeight = hasVolume ? 88 : 76;

  const priceValues = candlesAvailable
    ? bars.flatMap((bar) => [Number(bar.high), Number(bar.low)])
    : bars.map((bar) => Number(bar.close));
  if (cost !== null) priceValues.push(cost);
  let min = Math.min(...priceValues);
  let max = Math.max(...priceValues);
  if (max === min) {
    const padding = Math.max(Math.abs(max) * 0.02, 1);
    min -= padding;
    max += padding;
  }
  const yFor = (value) => plotBottom - ((value - min) / (max - min)) * (plotBottom - plotTop);
  const left = 5;
  const width = 290;
  const slot = width / bars.length;
  const candleWidth = Math.min(9, slot * 0.58);
  const xFor = (index) => left + (index + 0.5) * slot;

  let priceMarkup = "";
  if (candlesAvailable) {
    priceMarkup = bars.map((bar, index) => {
      const open = Number(bar.open), high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
      const tone = close > open ? "up" : close < open ? "down" : "flat";
      const x = xFor(index);
      const bodyTop = Math.min(yFor(open), yFor(close));
      const bodyHeight = Math.max(1.5, Math.abs(yFor(open) - yFor(close)));
      const title = (bar.date || "日期未提供") + " · 開 " + priceLabel(open, currency) + " · 高 " + priceLabel(high, currency) + " · 低 " + priceLabel(low, currency) + " · 收 " + priceLabel(close, currency);
      return '<g class="mini-market-candle mini-market-candle-' + tone + '" data-candle="true" data-candle-index="' + index + '"' + (index === bars.length - 1 ? ' data-latest-point="true"' : '') + '>'
        + '<title>' + escapeHtml(title) + '</title>'
        + '<line class="mini-market-candle-wick" x1="' + x.toFixed(2) + '" x2="' + x.toFixed(2) + '" y1="' + yFor(high).toFixed(2) + '" y2="' + yFor(low).toFixed(2) + '"></line>'
        + '<rect class="mini-market-candle-body" x="' + (x - candleWidth / 2).toFixed(2) + '" y="' + bodyTop.toFixed(2) + '" width="' + candleWidth.toFixed(2) + '" height="' + bodyHeight.toFixed(2) + '" rx=".7"></rect>'
        + '</g>';
    }).join("");
  } else {
    const points = bars.map((bar, index) => xFor(index).toFixed(2) + "," + yFor(Number(bar.close)).toFixed(2)).join(" ");
    const latest = bars.at(-1);
    const direction = Number(latest.close) > Number(bars[0].close) ? "up" : Number(latest.close) < Number(bars[0].close) ? "down" : "flat";
    priceMarkup = '<g class="mini-market-close-fallback mini-market-close-' + direction + '" data-close-fallback="true">'
      + '<polyline points="' + points + '"></polyline>'
      + '<circle data-latest-point="true" cx="' + xFor(bars.length - 1).toFixed(2) + '" cy="' + yFor(Number(latest.close)).toFixed(2) + '" r="2.2"><title>最新收盤 ' + escapeHtml(priceLabel(latest.close, currency)) + '</title></circle>'
      + '</g>';
  }

  let volumeMarkup = "";
  if (hasVolume) {
    const maxVolume = Math.max(...volumePoints.map((item) => Number(item.volume)));
    const baseline = viewHeight - 3;
    volumeMarkup = volumePoints.map(({ row, index, volume }) => {
      const amount = Number(volume);
      const height = maxVolume > 0 ? (amount / maxVolume) * 16 : 0;
      const open = finite(row.open) ? Number(row.open) : Number(row.close);
      const tone = Number(row.close) > open ? "up" : Number(row.close) < open ? "down" : "flat";
      const x = xFor(index);
      return '<rect class="mini-market-volume-bar mini-market-volume-' + tone + '" data-volume-bar="true" data-volume-index="' + index + '" x="' + (x - candleWidth / 2).toFixed(2) + '" y="' + (baseline - height).toFixed(2) + '" width="' + candleWidth.toFixed(2) + '" height="' + height.toFixed(2) + '">'
        + '<title>' + escapeHtml(row.date || "日期未提供") + ' · 成交量 ' + amount.toLocaleString("zh-TW") + '</title></rect>';
    }).join("");
  }

  const costLine = cost === null ? "" : '<line class="mini-market-cost-line" data-average-cost-reference="true" x1="' + left + '" x2="' + (left + width) + '" y1="' + yFor(cost).toFixed(2) + '" y2="' + yFor(cost).toFixed(2) + '"><title>Zhuge Investment Portfolio · 平均成本 ' + escapeHtml(priceLabel(cost, currency)) + '</title></line>';
  const latestClose = Number(bars.at(-1).close);
  const historyLabel = candlesAvailable ? bars.length + " 根 K 線" : bars.length + " 筆收盤線";
  const partialLabel = candlesAvailable ? "" : '<span class="mini-market-chart-state" data-state="PARTIAL_HISTORY">PARTIAL_HISTORY</span>';
  const aria = (chartMode === "portfolio" ? "持股" : "研究") + "近 20 日" + (candlesAvailable ? "OHLC K 線" : "收盤價線") + (hasVolume ? "與成交量" : "") + (costLine ? "；平均成本 " + priceLabel(cost, currency) : "");
  const lastData = bars.at(-1);

  return '<section class="mini-market-chart" data-mode="' + chartMode + '" data-chart-type="' + chartType + '" data-state="' + escapeHtml(chartState) + '" data-bar-count="' + bars.length + '" data-has-volume="' + hasVolume + '" data-has-cost-reference="' + (costLine ? "true" : "false") + '" aria-label="' + escapeHtml(aria) + '">'
    + '<div class="mini-market-chart-head"><strong>' + (candlesAvailable ? "近 20 日 K 線" : "近 20 日收盤線") + '</strong><span>' + (partialLabel || escapeHtml(historyLabel)) + '</span></div>'
    + '<svg class="mini-market-chart-svg' + (hasVolume ? " has-volume" : "") + '" viewBox="0 0 300 ' + viewHeight + '" preserveAspectRatio="none" role="img" aria-label="' + escapeHtml(aria) + '">'
    + '<title>' + escapeHtml(aria) + '</title>' + costLine + priceMarkup + volumeMarkup + '</svg>'
    + '<div class="mini-market-chart-legend">' + (hasVolume ? '<span class="mini-market-volume-key">成交量</span>' : "") + (costLine ? '<span class="mini-market-cost-key"><i aria-hidden="true"></i>平均成本 ' + escapeHtml(priceLabel(cost, currency)) + '</span>' : "") + '</div>'
    + '<div class="mini-market-chart-foot"><span>最新 ' + escapeHtml(priceLabel(latestClose, currency)) + '</span><span>' + escapeHtml(lastData.date || "日期未提供") + '</span></div>'
    + (candlesAvailable ? "" : '<p class="mini-market-chart-note">僅有收盤價；此線圖不是 K 線。</p>')
    + '<p class="mini-market-chart-meta">' + escapeHtml(historyMeta(evidence)) + '</p>'
    + '</section>';
}

export const miniMarketChartContract = Object.freeze({ validCandle });
