const test = require("node:test");
const assert = require("node:assert/strict");
const Position = require("../../modules/investment/models/position.js");
const Calc = require("../../modules/investment/services/portfolio-calculation-service.js");
const Simple = require("../../modules/investment/components/holdings-simple-list.js");
const format = require("../../modules/investment/utils/formatters.js");

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const deps = { escape, format, calculation: Calc };

function state(positions, quotes = []) {
  return { positions, watchlist: [], intelligence: { status: "ready", loadedAt: "2026-11-17T21:00:00+08:00", quotes, fx: null } };
}

test("simple overview shows cost, value and pnl trio plus one row per holding", () => {
  const positions = [
    Position.normalize({ symbol: "0050", name: "元大台灣50", quantity: 783, avg_cost: 69.41, invested_cost: 54361, last_price: 96.45, market_value: 75520 }),
    Position.normalize({ symbol: "00878", name: "國泰永續高股息", quantity: 996, avg_cost: 21.42, invested_cost: 21333, last_price: 32.43, market_value: 32300 })
  ];
  const html = Simple.render(state(positions), deps);
  assert.match(html, /總投入成本/);
  assert.match(html, /NT\$ 75,694/);
  assert.match(html, /目前市值/);
  assert.match(html, /NT\$ 107,820/);
  assert.match(html, /總損益/);
  assert.match(html, /NT\$ 32,126/);
  assert.equal((html.match(/class="investment-simple-row/g) || []).length, 2);
});

test("rows drill in with quantity, cost, price and data time; no raw numbers for unpriced", () => {
  const positions = [Position.normalize({ symbol: "00952", name: "凱基台灣AI50", quantity: 12, avg_cost: 18.08, invested_cost: 217 })];
  const html = Simple.render(state(positions), deps);
  assert.match(html, /<details class="investment-simple-row is-unpriced"/);
  assert.match(html, /暫無報價/);
  assert.match(html, /損益待報價更新/);
  assert.match(html, /全部投入成本/);
  assert.match(html, /含 1 檔暫無報價/);
  assert.match(html, /已估值部位市值（0 檔）|尚無資料/);
  assert.doesNotMatch(html, /-100\.00%/);
});

test("data line keeps quote date, snapshot date and read-back time separate", () => {
  const live = Calc.applyQuotes([Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361 })], [{ symbol: "0050", market: "TW", price: 96.45, available: true, asOf: "2026-11-16T13:30:00+08:00", freshness: "stale" }])[0];
  const snapshot = Calc.applyQuotes([Position.normalize({ symbol: "6898", quantity: 5000, avg_cost: 97.32, invested_cost: 486612, market_value: 355919, effective_at: "2026-11-16T09:44:00+08:00" })], [])[0];
  const html = Simple.render(state([live, snapshot], [{ symbol: "0050", market: "TW", available: true, asOf: "2026-11-16T13:30:00+08:00", price: 96.45 }]), deps);
  assert.match(html, /報價資料 2026\/11\/16（1 檔）/);
  assert.match(html, /券商快照 2026\/11\/16（1 檔）/);
  assert.match(html, /資料讀回 11\/17\s21:00/);
});

test("empty holdings render an honest empty state", () => {
  const html = Simple.render(state([]), deps);
  assert.match(html, /目前尚無持股資料/);
  assert.match(html, /尚無資料/);
});

test("with an unpriced holding, full cost stays separate and valued-subset totals subtract exactly", () => {
  const priced = Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361, last_price: 96.45, market_value: 75520 });
  const unpriced = Position.normalize({ symbol: "00952", quantity: 12, avg_cost: 18.08, invested_cost: 217 });
  const html = Simple.render(state([priced, unpriced]), deps);
  assert.match(html, /全部投入成本/);
  assert.match(html, /NT\$ 54,578/, "full cost = 54,361 + 217");
  assert.match(html, /已估值部位市值（1 檔）/);
  assert.match(html, /已估值部位損益/);
  assert.match(html, /成本 NT\$ 54,361 計/, "pnl card names the valued-subset cost basis");
  const summary = Calc.summarize([priced, unpriced]);
  assert.equal(summary.tw.value - summary.tw.pricedCost, summary.tw.pnl, "value - pricedCost = pnl exactly");
});

test("without unpriced holdings the trio keeps the plain 總投入成本/目前市值/總損益 labels", () => {
  const positions = [Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361, last_price: 96.45, market_value: 75520 })];
  const html = Simple.render(state(positions), deps);
  assert.match(html, /總投入成本/);
  assert.doesNotMatch(html, /全部投入成本|已估值部位/);
});

test("overview invested-cost note names the valued-subset basis when quotes are missing", () => {
  const Overview = require("../../modules/investment/pages/overview-page.js");
  const priced = Position.normalize({ symbol: "0050", quantity: 783, avg_cost: 69.41, invested_cost: 54361, last_price: 96.45, market_value: 75520 });
  const unpriced = Position.normalize({ symbol: "00952", quantity: 12, avg_cost: 18.08, invested_cost: 217 });
  const html = Overview.render(
    { positions: [priced, unpriced], intelligence: { status: "ready", loadedAt: "2026-11-17T21:00:00+08:00", quotes: [] }, watchlist: [], todayFocus: [], marketEvents: [], performance: {} },
    { format, calculation: Calc, escape, positionCard: { render: () => "" } }
  );
  assert.match(html, /市值與損益口徑為已估值部位成本 NT\$ 54,361，與此全部成本不同口徑。/);
});

test("mixed currencies have independent original-currency totals and unpriced boundaries", () => {
 const positions=[Position.normalize({symbol:"TESTTW",market:"TW",currency:"TWD",quantity:10,avg_cost:100,invested_cost:1000,last_price:110,market_value:1100}),Position.normalize({symbol:"TESTUS",market:"US",currency:"USD",quantity:2,avg_cost:40,invested_cost:80})];
 const html=Simple.render(state(positions),deps);
 const tw=html.split('data-investment-currency="TWD"')[1].split('data-investment-currency="USD"')[0];
 const us=html.split('data-investment-currency="USD"')[1].split('class="investment-simple-holdings"')[0];
 assert.match(tw,/NT\$ 1,000/);assert.match(tw,/NT\$ 1,100/);assert.doesNotMatch(tw,/US\$|未計入/);
 assert.match(us,/US\$ 80\.00/);assert.match(us,/1 檔暫無報價未計入/);assert.doesNotMatch(us,/NT\$/);
});

 test("AAL1 read requires verification without claiming stale sources",()=>{const input=state([]);input.intelligence.quality={dailyClose:{error:'DAILY_SOURCE_AAL2_REQUIRED'}};const html=Simple.render(input,deps);assert.match(html,/data-investment-read-step-up/);assert.match(html,/本次安全驗證/);assert.doesNotMatch(html,/尚未通過來源與日期驗證/);});
 test("source validation failures remain separate from authentication",()=>{const input=state([]);input.intelligence.quality={dailyClose:{error:'OFFICIAL_DAILY_SOURCE_NOT_CURRENT'}};const html=Simple.render(input,deps);assert.match(html,/尚未通過來源與日期驗證/);assert.doesNotMatch(html,/data-investment-read-step-up/);});
