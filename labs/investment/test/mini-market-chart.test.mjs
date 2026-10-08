import assert from "node:assert/strict";
import test from "node:test";
import { MiniMarketChart } from "../src/components/mini-market-chart.mjs";

function candle(index, { open = 10 + index, close = 10.5 + index, volume = 1000 + index } = {}) {
  return {
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume,
  };
}

function evidence(data, extra = {}) {
  return {
    status: "AVAILABLE", provider: "TWSE", dataTruth: "OFFICIAL", dataTimestamp: "2026-10-01",
    fetchedAt: "2026-10-01T09:00:00.000Z", delayed: true, stale: false, fallback: false, data,
    ...extra,
  };
}

test("research mode renders the latest 20 supplied OHLC candles and volume without portfolio context", () => {
  const html = MiniMarketChart({
    evidence: evidence(Array.from({ length: 24 }, (_, index) => candle(index))),
    mode: "research", averageCost: 12, currency: "TWD",
  });
  assert.match(html, /data-mode="research" data-chart-type="candlestick" data-state="AVAILABLE" data-bar-count="20"/);
  assert.equal((html.match(/data-candle="true"/g) || []).length, 20);
  assert.equal((html.match(/data-volume-bar="true"/g) || []).length, 20);
  assert.match(html, /data-candle-index="19" data-latest-point="true"/);
  assert.match(html, /2026-09-24/);
  assert.doesNotMatch(html, /data-average-cost-reference="true"|平均成本/);
  assert.match(html, /mini-market-candle-up/);
  assert.match(html, /TWSE · 2026-10-01 · 延遲收盤 · 時效正常 · Fallback：否/);
});

test("portfolio mode overlays only its supplied canonical average cost and formats USD", () => {
  const html = MiniMarketChart({
    evidence: evidence([candle(0), candle(1, { open: 12, close: 11, volume: 0 })]),
    mode: "portfolio", averageCost: 10.75, currency: "USD",
  });
  assert.match(html, /data-mode="portfolio"/);
  assert.match(html, /data-average-cost-reference="true"/);
  assert.match(html, /平均成本 US\$10\.75/);
  assert.match(html, /Zhuge Investment Portfolio/);
  assert.match(html, /mini-market-candle-down/);
  assert.match(html, /data-volume-bar="true"/);
});

test("close-only or malformed OHLC falls back to a thin partial-history line without fake candles", () => {
  const rows = [
    { date: "2026-09-01", close: 20, volume: 50 },
    { date: "2026-09-02", open: 22, high: 21, low: 19, close: 21, volume: null },
    { date: "2026-09-03", close: 22 },
  ];
  const html = MiniMarketChart({ evidence: evidence(rows), mode: "research" });
  assert.match(html, /data-chart-type="close-line" data-state="PARTIAL_HISTORY"/);
  assert.match(html, /data-close-fallback="true"/);
  assert.equal((html.match(/data-candle="true"/g) || []).length, 0);
  assert.equal((html.match(/data-volume-bar="true"/g) || []).length, 1);
  assert.match(html, /PARTIAL_HISTORY/);
  assert.match(html, /僅有收盤價；此線圖不是 K 線/);
  assert.doesNotMatch(html, /<path|portfolio-sparkline-area/);
});

test("volume is omitted when provider did not supply volume; no zero-filled bars are invented", () => {
  const first = candle(0); delete first.volume;
  const second = candle(1); delete second.volume;
  const html = MiniMarketChart({ evidence: evidence([first, second]) });
  assert.match(html, /data-chart-type="candlestick"/);
  assert.match(html, /data-has-volume="false"/);
  assert.equal((html.match(/data-volume-bar="true"/g) || []).length, 0);
  assert.doesNotMatch(html, /mini-market-volume-key/);
});

test("not-connected and unavailable histories show explicit state and no synthetic chart", () => {
  const notConnected = MiniMarketChart({ evidence: { status: "NOT_CONNECTED", provider: "TPEx", errorCode: "HISTORY_NOT_CONNECTED", data: null }, mode: "portfolio", averageCost: 12 });
  assert.match(notConnected, /data-chart-type="none" data-state="NOT_CONNECTED"/);
  assert.match(notConnected, /data-bar-count="0" data-has-volume="false" data-has-cost-reference="false"/);
  assert.match(notConnected, /尚無已驗證的官方歷史行情來源/);
  assert.match(notConnected, /HISTORY_NOT_CONNECTED/);
  assert.doesNotMatch(notConnected, /<svg|<rect|data-average-cost-reference="true"/);

  const unavailable = MiniMarketChart({ evidence: { status: "UNAVAILABLE", provider: "TWSE", errorCode: "TIMEOUT", data: null } });
  assert.match(unavailable, /data-state="UNAVAILABLE"/);
  assert.match(unavailable, /歷史行情暫時無法取得/);
  assert.doesNotMatch(unavailable, /<svg|<rect/);
});

test("US history secret gate names the Zhuge Edge setup boundary without fabricating a chart", () => {
  const html = MiniMarketChart({ evidence: {
    status: "NOT_CONNECTED", provider: "Alpaca IEX", errorCode: "EXTERNAL_SECRET_REQUIRED", data: null,
  } });
  assert.match(html, /美股歷史行情來源暫時無法取得；Alpaca 僅是可選備援，並非使用必要條件/);
  assert.match(html, /data-chart-type="none"/);
  assert.doesNotMatch(html, /<svg|data-candle="true"|data-close-fallback="true"/);
});

test("up candles are Taiwan-red and down candles are Taiwan-green; flat uses neutral tone", () => {
  const html = MiniMarketChart({ evidence: evidence([
    candle(0, { open: 10, close: 11 }),
    candle(1, { open: 12, close: 11 }),
    candle(2, { open: 12, close: 12 }),
  ]) });
  assert.match(html, /mini-market-candle-up/);
  assert.match(html, /mini-market-candle-down/);
  assert.match(html, /mini-market-candle-flat/);
});
