const test = require("node:test");
const assert = require("node:assert/strict");
const Position = require("../../modules/investment/models/position.js");
const Card = require("../../modules/investment/components/position-card.js");
const Calc = require("../../modules/investment/services/portfolio-calculation-service.js");
const format = require("../../modules/investment/utils/formatters.js");

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const deps = { escape, format, classify: Calc.classify };

test("normalize keeps missing quotes null instead of fabricating 0 price and -100% loss", () => {
  const position = Position.normalize({ symbol: "2330", name: "台積電", market: "TW", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  assert.equal(position.lastPrice, null);
  assert.equal(position.marketValue, null);
  assert.equal(position.unrealizedPnl, null);
  assert.equal(position.unrealizedPercent, null);
  assert.equal(position.priceAvailable, false);
});

test("normalize preserves broker snapshot market value when only last_price is missing", () => {
  const position = Position.normalize({ symbol: "00878", quantity: 996, avg_cost: 21.4, invested_cost: 21333, market_value: 33046 });
  assert.equal(position.lastPrice, null);
  assert.equal(position.marketValue, 33046);
  assert.equal(position.unrealizedPnl, 33046 - 21333);
  assert.equal(position.priceAvailable, false);
});

test("position card shows 暫無報價 instead of 0.00 and -100% when quote is missing", () => {
  const position = Position.normalize({ symbol: "2330", name: "台積電", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  const html = Card.render(position, deps);
  assert.match(html, /暫無報價/);
  assert.match(html, /損益待報價更新/);
  assert.doesNotMatch(html, /-100\.00%/);
  assert.doesNotMatch(html, /<b>0\.00<\/b>/);
});

test("position card keeps real numbers when a quote exists", () => {
  const position = Position.normalize({ symbol: "0050", name: "元大台灣50", quantity: 783, avg_cost: 69.4, invested_cost: 54361, last_price: 99, market_value: 77525, unrealized_pnl: 23164, unrealized_pct: 42.61 });
  const html = Card.render(position, deps);
  assert.match(html, /<b>99\.00<\/b>/);
  assert.match(html, /\+23,164\.00/);
  assert.doesNotMatch(html, /暫無報價/);
});

test("position card surfaces quote as-of and freshness after applyQuotes", () => {
  const base = Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  const [updated] = Calc.applyQuotes([base], [{ symbol: "2330", market: "TW", price: 2290.5, available: true, asOf: "2026-11-17T13:30:00+08:00", freshness: "stale", provider: "twse-openapi" }]);
  assert.equal(updated.liveQuoteAvailable, true);
  assert.equal(updated.quoteAsOf, "2026-11-17T13:30:00+08:00");
  const html = Card.render(updated, deps);
  assert.match(html, /報價 11\/17\s13:30 · 非即時/);
});

test("applyQuotes marks positions skipped by a partial batch as liveQuoteAvailable false", () => {
  const positions = [
    Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 }),
    Position.normalize({ symbol: "6898", quantity: 5000, avg_cost: 97.3, invested_cost: 486612, market_value: 355919 })
  ];
  const [priced, skipped] = Calc.applyQuotes(positions, [{ symbol: "2330", market: "TW", price: 2290.5, available: true, asOf: "2026-11-17T13:30:00+08:00", freshness: "fresh" }]);
  assert.equal(priced.liveQuoteAvailable, true);
  assert.equal(skipped.liveQuoteAvailable, false);
  assert.equal(skipped.marketValue, 355919, "snapshot value must survive a missing live quote");
});

test("summarize counts unpriced positions so totals can be caveated", () => {
  const positions = [
    Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.4, invested_cost: 54361, last_price: 99, market_value: 77525 }),
    Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 })
  ];
  const summary = Calc.summarize(positions);
  assert.equal(summary.tw.unpricedCount, 1);
  assert.equal(summary.tw.value, 77525);
  assert.equal(summary.tw.cost, 54361 + 4808);
});

test("roi pairs pnl with the same priced subset cost, never full cost minus partial value", () => {
  const priced = Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361, last_price: 99, market_value: 77525 });
  const unpriced = Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  const summary = Calc.summarize([priced, unpriced]);
  assert.equal(summary.tw.cost, 59169, "cost still totals every holding");
  assert.equal(summary.tw.pricedCost, 54361, "roi denominator excludes the unpriced position's cost");
  assert.equal(summary.tw.roi, (77525 - 54361) / 54361 * 100);
  const allUnpriced = Calc.summarize([unpriced]);
  assert.equal(allUnpriced.tw.roi, null, "no priced positions means no roi, not 0%");
});

test("overview shows 報酬率待報價 instead of a fabricated +0.00% when nothing is priced", () => {
  const Overview = require("../../modules/investment/pages/overview-page.js");
  const unpriced = Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  const html = Overview.render(
    { positions: [unpriced], intelligence: { status: "ready", loadedAt: "2026-11-17T13:30:00+08:00", quotes: [] }, watchlist: [], todayFocus: [], marketEvents: [], performance: {} },
    { format, calculation: Calc, escape, positionCard: Card }
  );
  assert.match(html, /報酬率待報價/);
  assert.doesNotMatch(html, /\+0\.00%/);
});

test("stored snapshot price is labeled 快照 with its date, never as a fresh quote", () => {
  const snapshot = Position.normalize({ symbol: "6898", quantity: 5000, avg_cost: 97.32, invested_cost: 486612, last_price: 71.18, market_value: 355919, effective_at: "2026-11-16T09:44:00+08:00" });
  const [afterBatchMiss] = Calc.applyQuotes([snapshot], []);
  const html = Card.render(afterBatchMiss, deps);
  assert.match(html, /快照 2026\/11\/16 · 暫無新報價/);
  assert.doesNotMatch(html, /報價 20/);
});

test("quote data line separates price time from read-back time so stale quotes never look new", () => {
  const Overview = require("../../modules/investment/pages/overview-page.js");
  const base = Position.normalize({ symbol: "2330", quantity: 2, avg_cost: 2404, invested_cost: 4808 });
  const [priced] = Calc.applyQuotes([base], [{ symbol: "2330", market: "TW", price: 2215, available: true, asOf: "2026-11-16T13:30:00+08:00", freshness: "stale" }]);
  const html = Overview.render(
    { positions: [priced], intelligence: { status: "ready", loadedAt: "2026-11-17T13:30:00+08:00", quotes: [{ symbol: "2330", market: "TW", available: true, asOf: "2026-11-16T13:30:00+08:00", price: 2215 }] }, watchlist: [], todayFocus: [], marketEvents: [], performance: {} },
    { format, calculation: Calc, escape, positionCard: Card }
  );
  assert.match(html, /報價資料 2026\/11\/16（1 檔）/);
  assert.match(html, /資料讀回 11\/17\s13:30/);
  assert.doesNotMatch(html, /行情更新時間/);
});

test("quote data line counts snapshot and unpriced positions in mixed batches", () => {
  const Overview = require("../../modules/investment/pages/overview-page.js");
  const live = Calc.applyQuotes([Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361 })], [{ symbol: "0050", market: "TW", price: 96.45, available: true, asOf: "2026-11-16T13:30:00+08:00", freshness: "stale" }])[0];
  const snapshot = Calc.applyQuotes([Position.normalize({ symbol: "6898", quantity: 5000, avg_cost: 97.32, invested_cost: 486612, market_value: 355919, effective_at: "2026-11-16T09:44:00+08:00" })], [])[0];
  const unpriced = Position.normalize({ symbol: "00952", quantity: 12, avg_cost: 18.08, invested_cost: 217 });
  const html = Overview.render(
    { positions: [live, snapshot, unpriced], intelligence: { status: "ready", loadedAt: "2026-11-17T13:30:00+08:00", quotes: [{ symbol: "0050", market: "TW", available: true, asOf: "2026-11-16T13:30:00+08:00", price: 96.45 }] }, watchlist: [], todayFocus: [], marketEvents: [], performance: {} },
    { format, calculation: Calc, escape, positionCard: Card }
  );
  assert.match(html, /券商快照 2026\/11\/16（1 檔）/);
  assert.match(html, /1 檔暫無報價未計入/);
  assert.match(html, /另有 1 檔暫無報價：市值與損益只計有價檔，報酬率以有價檔成本計。/);
});

test('quote normalizer and applyQuotes never coerce missing or malformed values into zero',()=>{
 const Layer=require('../../modules/investment/services/investment-intelligence-layer.js');
 const Calc=require('../../modules/investment/services/portfolio-calculation-service.js');
 for(const price of[null,undefined,'','   ',NaN,Infinity,-Infinity,-1,'-1',false,true,[],[0],{},'0x0','garbage']){
  const quote={symbol:'TEST',market:'TW',price,available:true};
  const normalized=Layer.normalizeQuote(quote);assert.equal(normalized.price,null,String(price));assert.equal(normalized.available,false,String(price));
  const missing=Position.normalize({symbol:'TEST',market:'TW',quantity:2,avg_cost:10});
  const applied=Calc.applyQuotes([missing],[quote])[0];assert.equal(applied.liveQuoteAvailable,false,String(price));assert.equal(applied.marketValue,null,String(price));assert.equal(applied.unrealizedPnl,null,String(price));
  const snapshot=Position.normalize({symbol:'TEST',market:'TW',quantity:2,avg_cost:10,market_value:18,last_price:9});
  const retained=Calc.applyQuotes([snapshot],[quote])[0];assert.equal(retained.marketValue,18,String(price));assert.equal(retained.unrealizedPnl,-2,String(price));assert.equal(retained.liveQuoteAvailable,false,String(price));
 }
});
test('explicit valid zero quote remains a real zero valuation, unlike missing quote',()=>{
 const Layer=require('../../modules/investment/services/investment-intelligence-layer.js');
 const Calc=require('../../modules/investment/services/portfolio-calculation-service.js');
 for(const price of[0,'0','0.00',' 0 ','0e0']){const quote=Layer.normalizeQuote({symbol:'TEST',market:'TW',price,available:true});assert.equal(quote.price,0);assert.equal(quote.available,true);const applied=Calc.applyQuotes([Position.normalize({symbol:'TEST',market:'TW',quantity:2,avg_cost:10})],[quote])[0];assert.equal(applied.marketValue,0);assert.equal(applied.unrealizedPnl,-20);assert.equal(applied.liveQuoteAvailable,true);}
 const unavailable=Layer.normalizeQuote({symbol:'TEST',market:'TW',price:0,available:false});assert.equal(unavailable.available,false);
});
test('position valuation fields reject blank and nonnumeric container types instead of inventing zero',()=>{for(const value of['  ',false,[],{}]){const p=Position.normalize({symbol:'TEST',quantity:2,avg_cost:10,last_price:value,market_value:value,unrealized_pnl:value});assert.equal(p.lastPrice,null);assert.equal(p.marketValue,null);assert.equal(p.unrealizedPnl,null);}});
