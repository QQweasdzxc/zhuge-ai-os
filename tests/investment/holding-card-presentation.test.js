const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable, fixtureURL } = require("../browser-executable");
const presentation = require("../../modules/investment/components/holding-card-presentation.js");
const format = require("../../modules/investment/utils/formatters.js");

const fixture = path.join(__dirname, "holding-card-fixture.html");
const artifactDirectory = path.resolve(__dirname, "../../..", "artifacts/Investment-Holding-Card-Promotion");

function position(overrides = {}) {
  return {
    source_kind: "opening_position", source_id: "position-identity", symbol: "2742", name: "遠山科技",
    market: "TW", currency: "TWD", quantity: 20, avg_cost: 54.25, invested_cost: 1085,
    last_price: 68.25, market_value: 1365, unrealized_pnl: 280, unrealized_pct: 25.8064,
    effective_at: "2026-10-06T08:00:00Z", market_value_source: "transaction_calculated", position_status: "current",
    ...overrides
  };
}

function history(provider = "twse-daily-history", count = 20) {
  return {
    provider,
    source: "TWSE Daily Trading Open Data",
    available: true,
    asOf: "2026-10-06T00:00:00.000Z",
    bars: Array.from({ length: count }, (_, index) => ({ asOf: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, close: 50 + index }))
  };
}

test("holding view model preserves canonical financial values and Board identity", () => {
  const source = position();
  const model = presentation.buildHoldingViewModel(source, { workCode: "IVTK-091" }, null, format);
  assert.equal(model.symbol, source.symbol);
  assert.equal(model.displayName, source.name);
  assert.equal(model.workCode, "IVTK-091");
  assert.equal(model.sourceId, source.source_id);
  assert.equal(model.averageCost, source.avg_cost);
  assert.equal(model.marketValue, source.market_value);
  assert.equal(model.unrealizedPnl, source.unrealized_pnl);
  assert.equal(model.unrealizedPercent, source.unrealized_pct);
  assert.equal(model.lastPrice, source.last_price);
  assert.equal(model.quoteAsOf, source.effective_at);
  assert.match(presentation.renderHoldingContent(source, { workCode: "IVTK-091" }, null, format), /持股估值/);
});

test("holding card uses official TWSE history only and keeps unavailable trend truthful", () => {
  const source = position();
  assert.equal(presentation.eligibleOfficialHistory(history()), true);
  assert.equal(presentation.eligibleOfficialHistory(history("yahoo-history")), false);
  assert.equal(presentation.eligibleOfficialHistory(history("twse-daily-history", 19)), true);
  assert.match(presentation.renderSparkline(history()), /data-holding-trend="official"/);
  assert.match(presentation.renderSparkline(history("yahoo-history")), /data-holding-trend="unavailable"/);
  assert.match(presentation.renderSparkline(history("twse-daily-history", 19)), /尚無行情/);
  const unavailable = presentation.buildHoldingViewModel(position({ last_price: null, avg_cost: null, market_value: null, unrealized_pnl: null, unrealized_pct: null, effective_at: null }), {}, null, format);
  assert.deepEqual([unavailable.formatted.lastPrice, unavailable.formatted.averageCost, unavailable.formatted.marketValue, unavailable.formatted.unrealizedPnl, unavailable.formatted.unrealizedPercent], ["—", "—", "—", "—", "—"]);
  const markup = presentation.renderHoldingContent(source, { workCode: "IVTK-091" }, history(), format);
  assert.match(markup, /遠山科技/);
  assert.match(markup, /IVTK-091/);
  assert.doesNotMatch(markup, /Investment Position Projection|Card projection owned by Investment Cloud/);
  assert.doesNotMatch(markup, /data-board-task-price|data-board-task-cost|market_value=/);
});

async function inspectViewport(t, { width, height, screenshotName }) {
  const executablePath = resolveBrowserExecutable() || chromium.executablePath();
  assert.ok(fs.existsSync(executablePath), `Chromium executable not found: ${executablePath}`);
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(await fixtureURL(fixture), { waitUntil: "load" });
    await page.waitForSelector('[data-investment-holding-presentation="v1"]');
    await page.waitForFunction(() => document.body.dataset.investmentCloudBridge === "ready");
    const audit = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".investment-holding-runtime-card")];
      const rects = cards.map(card => {
        const box = card.getBoundingClientRect();
        const title = card.querySelector(".shared-task-card-title");
        const price = card.querySelector(".investment-holding-price > strong");
        return {
          width: box.width, height: box.height, title: title?.innerText || "", price: price?.innerText || "",
          footer: card.querySelector(".investment-holding-code")?.innerText || "",
          trend: card.querySelector("[data-holding-trend]")?.dataset.holdingTrend || "",
          hasOldProjectionText: /Investment Position Projection|Card projection owned by Investment Cloud/.test(card.innerText),
          touchCard: card.getAttribute("role") === "button" || card.tabIndex >= 0
        };
      });
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        count: cards.length, cards: rects,
        historicalCardUnchanged: document.querySelector(".fixture-legacy-history")?.querySelector(".shared-task-card-title")?.innerText === "7001 · 歷史標的"
          && !document.querySelector(".fixture-legacy-history")?.querySelector('[data-investment-holding-presentation="v1"]'),
        title: [...document.querySelectorAll(".investment-holding-title")].map(node => node.innerText),
        price: [...document.querySelectorAll(".investment-holding-price > strong")].map(node => node.innerText),
        metrics: [...document.querySelectorAll(".investment-holding-metrics")].length,
        trendCount: [...document.querySelectorAll('[data-holding-trend="official"]')].length,
        identityPreserved: [...document.querySelectorAll(".investment-holding-code")].map(node => node.innerText),
        noOldText: !cards.some(card => /Investment Position Projection|Card projection owned by Investment Cloud/.test(card.innerText)),
        marketDataOnlyInPresentation: !document.querySelector("[data-board-task-price], [data-board-task-cost], [data-board-task-pnl]")
      };
    });
    assert.equal(audit.count, 3);
    assert.ok(audit.cards.every(card => card.title && card.price && card.footer && card.trend === "official" && !card.hasOldProjectionText && card.touchCard));
    assert.deepEqual(audit.identityPreserved, ["IVTK-001", "IVTK-002", "IVTK-003"]);
    assert.equal(audit.noOldText, true);
    assert.equal(audit.historicalCardUnchanged, true);
    assert.equal(audit.marketDataOnlyInPresentation, true);
    assert.ok(audit.documentWidth <= audit.width, `horizontal overflow ${audit.documentWidth} > ${audit.width}`);
    if (width < 500) assert.ok(audit.cards.every(card => card.width <= width));
    await fs.promises.mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: path.join(artifactDirectory, screenshotName), fullPage: true, animations: "disabled" });
    assert.deepEqual(pageErrors, []);
    return audit;
  } finally {
    await browser.close();
  }
}

test("holding card desktop and mobile presentation is responsive and preserves IVTK identity", async t => {
  const desktop = await inspectViewport(t, { width: 1440, height: 900, screenshotName: "holding-card-desktop-visual-fixture.png" });
  const mobile = await inspectViewport(t, { width: 390, height: 844, screenshotName: "holding-card-mobile-visual-fixture.png" });
  assert.equal(desktop.width, 1440);
  assert.equal(mobile.width, 390);
  assert.equal(desktop.trendCount, 3);
  assert.equal(mobile.trendCount, 3);
});
