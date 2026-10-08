import assert from "node:assert/strict";
import test from "node:test";
import { calculateIndicators } from "../src/domain/indicators.mjs";
import { buildTechnicalSignalMatrix, renderTechnicalSignalMatrix } from "../src/domain/technical-signal-matrix.mjs";

const bars = Array.from({ length: 40 }, (_, index) => ({
  date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
  open: 100 + index,
  high: 103 + index,
  low: 99 + index,
  close: 102 + index,
  volume: 1000 + index * 10,
}));

test("technical signal matrix derives descriptive observations from the supplied OHLCV indicators", () => {
  const indicators = calculateIndicators(bars);
  const result = buildTechnicalSignalMatrix(bars, indicators);
  const byId = Object.fromEntries(result.map(item => [item.id, item]));

  assert.equal(result.length, 8);
  assert.equal(byId.trend.status, "AVAILABLE");
  assert.equal(byId.trend.observation, "MA5 高於 MA20");
  assert.match(byId.rsi.observation, /RSI\(14\) 100\.00/);
  assert.equal(byId.macd.status, "AVAILABLE");
  assert.equal(byId.macd.observation, indicators.macd.macd > indicators.macd.signal
    ? "MACD 線高於訊號線"
    : indicators.macd.macd < indicators.macd.signal ? "MACD 線低於訊號線" : "MACD 線與訊號線相同");
  assert.equal(byId.bollinger.status, "AVAILABLE");
  assert.equal(byId.volume.observation, "最新量高於近 5 日均量");
  assert.equal(byId["candle-shape"].status, "AVAILABLE");
  assert.equal(byId["candle-relationship"].status, "AVAILABLE");
  assert.equal(byId["multi-candle-pattern"].status, "AVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /買進|賣出|BUY|SELL|score/i);
});

test("technical signal matrix keeps missing source fields explicit instead of zero-filling", () => {
  const result = buildTechnicalSignalMatrix([{ close: 12, volume: null }], {});
  assert.ok(result.every(item => item.status === "INSUFFICIENT_EVIDENCE"));
  assert.match(result.find(item => item.id === "trend").observation, /需要 MA5 與 MA20/);
  assert.match(result.find(item => item.id === "volume").observation, /樣本不足/);
  assert.equal(result.find(item => item.id === "bollinger").status, "INSUFFICIENT_EVIDENCE");
  assert.doesNotMatch(JSON.stringify(result), /0\.00|= 0/);
});

test("engulfing observations require the supplied two-candle OHLC conditions", () => {
  const bullish = buildTechnicalSignalMatrix([
    { open: 10, close: 8, high: 11, low: 7 },
    { open: 7.5, close: 10.5, high: 11, low: 7 },
  ], {});
  assert.match(bullish.find(item => item.id === "candle-relationship").observation, /多方吞噬/);

  const nearMiss = buildTechnicalSignalMatrix([
    { open: 10, close: 8, high: 11, low: 7 },
    { open: 8.5, close: 10.5, high: 11, low: 8 },
  ], {});
  assert.match(nearMiss.find(item => item.id === "candle-relationship").observation, /內包 K 棒/);
  assert.doesNotMatch(nearMiss.find(item => item.id === "candle-relationship").observation, /吞噬/);
});

test("two-candle mother/child, piercing, and dark-cloud descriptions use the supplied OHLC bodies", () => {
  const harami = buildTechnicalSignalMatrix([
    { open: 10, close: 8, high: 10.5, low: 7.5 },
    { open: 8.5, close: 9.5, high: 9.8, low: 8.2 },
  ], {}).find(item => item.id === "candle-relationship");
  assert.match(harami.observation, /多方母子線/);

  const piercing = buildTechnicalSignalMatrix([
    { open: 10, close: 8, high: 10.4, low: 7.7 },
    { open: 7.8, close: 9.2, high: 9.4, low: 7.5 },
  ], {}).find(item => item.id === "candle-relationship");
  assert.match(piercing.observation, /貫穿線/);

  const cloud = buildTechnicalSignalMatrix([
    { open: 8, close: 10, high: 10.4, low: 7.7 },
    { open: 10.2, close: 8.8, high: 10.5, low: 8.6 },
  ], {}).find(item => item.id === "candle-relationship");
  assert.match(cloud.observation, /烏雲蓋頂/);
});

test("three-candle observations label morning/evening star shapes and reject zero-range candles", () => {
  const morning = buildTechnicalSignalMatrix([
    { open: 10, high: 10.5, low: 6.5, close: 7 },
    { open: 7.1, high: 7.6, low: 6.8, close: 7.2 },
    { open: 7.2, high: 9.8, low: 7, close: 9.5 },
  ], {}).find(item => item.id === "multi-candle-pattern");
  assert.match(morning.observation, /晨星/);

  const evening = buildTechnicalSignalMatrix([
    { open: 7, high: 10.5, low: 6.5, close: 10 },
    { open: 10.1, high: 10.4, low: 9.8, close: 10.2 },
    { open: 10.1, high: 10.2, low: 7, close: 7.5 },
  ], {}).find(item => item.id === "multi-candle-pattern");
  assert.match(evening.observation, /夜星/);

  const malformed = buildTechnicalSignalMatrix([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 11, low: 9, close: 10 },
    { open: 10, high: 11, low: 9, close: 10 },
  ], {}).find(item => item.id === "multi-candle-pattern");
  assert.equal(malformed.status, "INSUFFICIENT_EVIDENCE");
});

test("single-candle geometry reports doji and long-shadow candidates from validated OHLC only", () => {
  const doji = buildTechnicalSignalMatrix([
    { open: 10, high: 12, low: 8, close: 10.2 },
    { open: 11, high: 14, low: 10, close: 11.1 },
  ], {});
  assert.match(doji.find(item => item.id === "candle-shape").observation, /十字線外觀/);

  const hammer = buildTechnicalSignalMatrix([
    { open: 10, high: 10.45, low: 7.8, close: 10.4 },
  ], {});
  assert.match(hammer.find(item => item.id === "candle-shape").observation, /長下影錘頭外觀/);
  assert.equal(hammer.find(item => item.id === "candle-relationship").status, "INSUFFICIENT_EVIDENCE");
  assert.doesNotMatch(JSON.stringify([...doji, ...hammer]), /買進|賣出|BUY|SELL/);
});

test("inside/outside relationships require valid high-low containment and never infer direction", () => {
  const inside = buildTechnicalSignalMatrix([
    { open: 10, high: 12, low: 8, close: 11 },
    { open: 10.5, high: 11.5, low: 8.5, close: 10.8 },
  ], {});
  assert.match(inside.find(item => item.id === "candle-relationship").observation, /內包 K 棒/);

  const outside = buildTechnicalSignalMatrix([
    { open: 10, high: 12, low: 8, close: 11 },
    { open: 10.5, high: 12.5, low: 7.5, close: 10.8 },
  ], {});
  assert.match(outside.find(item => item.id === "candle-relationship").observation, /外包 K 棒/);

  const malformed = buildTechnicalSignalMatrix([
    { open: 10, high: 8, low: 12, close: 11 },
    { open: 10, high: 12, low: 9, close: 11 },
  ], {});
  assert.equal(malformed.find(item => item.id === "candle-relationship").status, "INSUFFICIENT_EVIDENCE");
});

test("technical matrix renderer escapes labels and marks insufficient evidence", () => {
  const html = renderTechnicalSignalMatrix([
    { id: "safe", label: "<script>", observation: "資料不足", status: "INSUFFICIENT_EVIDENCE", source: "source" },
  ]);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-matrix-status="INSUFFICIENT_EVIDENCE"/);
  assert.doesNotMatch(html, /<script>/);
});
