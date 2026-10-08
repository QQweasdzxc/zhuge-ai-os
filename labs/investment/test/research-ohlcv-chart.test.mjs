import assert from "node:assert/strict";
import test from "node:test";
import { renderResearchOhlcvChart } from "../src/components/research-ohlcv-chart.mjs";

const bar = (index) => ({
  asOf: `2026-09-${String(index + 1).padStart(2, "0")}`,
  open: 100 + index,
  high: 103 + index,
  low: 99 + index,
  close: 102 + index,
  volume: 1000 + index,
});

test("research history adapter renders real provider OHLC candles and volume", () => {
  const html = renderResearchOhlcvChart({
    available: true,
    provider: "Zhuge US Market Provider",
    sourceUrl: "https://data.example/history",
    asOf: "2026-09-24T00:00:00.000Z",
    stale: false,
    delayed: true,
    bars: Array.from({ length: 22 }, (_, index) => bar(index)),
  }, { market: "US" });

  assert.match(html, /data-mode="research" data-chart-type="candlestick" data-state="AVAILABLE" data-bar-count="20"/);
  assert.equal((html.match(/data-candle="true"/g) || []).length, 20);
  assert.equal((html.match(/data-volume-bar="true"/g) || []).length, 20);
  assert.match(html, /US\$121/);
  assert.match(html, /Zhuge US Market Provider/);
  assert.match(html, /延遲收盤/);
});

test("research history adapter preserves partial close-only evidence without inventing candles", () => {
  const html = renderResearchOhlcvChart({
    status: "PARTIAL",
    provider: "Official source",
    dataTimestamp: "2026-09-02",
    data: [{ date: "2026-09-01", close: 10 }, { date: "2026-09-02", close: 11 }],
  });

  assert.match(html, /data-chart-type="close-line" data-state="PARTIAL_HISTORY"/);
  assert.equal((html.match(/data-candle="true"/g) || []).length, 0);
  assert.match(html, /僅有收盤價；此線圖不是 K 線/);
});

test("research history adapter shows a truthful unavailable state when no bars exist", () => {
  const html = renderResearchOhlcvChart({ available: false, error: "HISTORY_UNAVAILABLE", bars: [] }, { market: "US" });
  assert.match(html, /data-chart-type="none" data-state="UNAVAILABLE"/);
  assert.match(html, /歷史行情暫時無法取得/);
  assert.doesNotMatch(html, /data-candle="true"|data-volume-bar="true"/);
});
