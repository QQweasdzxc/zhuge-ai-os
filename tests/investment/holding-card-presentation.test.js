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
  const collapsed = presentation.renderHoldingContent(source, { workCode: "IVTK-091" }, null, format);
  assert.match(collapsed, /aria-label="查看持股明細"/);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /investment-holding-metrics|investment-holding-trend|投入成本/);
  const detail = presentation.renderHoldingDetail(source, { workCode: "IVTK-091" }, history(), format);
  for (const label of ["平均成本 / 股", "投入成本", "目前價格", "目前市值", "未實現損益", "損益率", "近 20 日行情", "資料來源", "非即時行情"]) assert.match(detail, new RegExp(label));
  assert.match(detail, /1,085/);
  assert.match(detail, /官方收盤走勢/);
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
    await page.waitForSelector('[data-investment-holding-presentation="v2"]');
    await page.waitForFunction(() => document.body.dataset.investmentCloudBridge === "ready");
    const audit = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".investment-holding-runtime-card")];
      const rects = cards.map(card => {
        const box = card.getBoundingClientRect();
        const title = card.querySelector(".shared-task-card-title");
        const price = card.querySelector(".investment-holding-price");
        return {
          width: box.width, height: box.height, title: title?.innerText || "", price: price?.innerText || "",
          footer: card.querySelector(".investment-holding-freshness")?.innerText || "",
          trigger: card.querySelector("[data-investment-holding-detail-trigger]")?.getAttribute("aria-expanded") || "",
          hiddenDetails: !card.querySelector(".investment-holding-metrics, .investment-holding-trend"),
          hasOldProjectionText: /Investment Position Projection|Card projection owned by Investment Cloud/.test(card.innerText),
          touchCard: card.getAttribute("role") === "button" || card.tabIndex >= 0
        };
      });
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        count: cards.length, cards: rects,
        historicalCardUnchanged: document.querySelector(".fixture-legacy-history")?.querySelector(".shared-task-card-title")?.innerText === "7001 · 歷史標的"
          && !document.querySelector(".fixture-legacy-history")?.querySelector('[data-investment-holding-presentation="v2"]'),
        title: [...document.querySelectorAll(".investment-holding-title")].map(node => node.innerText),
        price: [...document.querySelectorAll(".investment-holding-price")].map(node => node.innerText),
        identityPreserved: [...document.querySelectorAll(".investment-holding-runtime-card")].map(card => card.dataset.investmentWorkCode),
        baselineHeights: window.__holdingBaselineCardHeights,
        cardHeights: cards.map(card => card.getBoundingClientRect().height),
        noOldText: !cards.some(card => /Investment Position Projection|Card projection owned by Investment Cloud/.test(card.innerText)),
        marketDataOnlyInPresentation: !document.querySelector("[data-board-task-price], [data-board-task-cost], [data-board-task-pnl]")
      };
    });
    assert.equal(audit.count, 3);
    assert.ok(audit.cards.every(card => card.title && card.price && card.trigger === "false" && card.hiddenDetails && !card.hasOldProjectionText && card.touchCard));
    assert.deepEqual(audit.identityPreserved, ["IVTK-001", "IVTK-002", "IVTK-003"]);
    assert.equal(audit.noOldText, true);
    assert.equal(audit.historicalCardUnchanged, true);
    assert.equal(audit.marketDataOnlyInPresentation, true);
    assert.deepEqual(audit.cardHeights, audit.baselineHeights.slice(0, 3));
    assert.ok(audit.documentWidth <= audit.width, `horizontal overflow ${audit.documentWidth} > ${audit.width}`);
    if (width < 500) assert.ok(audit.cards.every(card => card.width <= width));
    await fs.promises.mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: path.join(artifactDirectory, screenshotName), fullPage: true, animations: "disabled" });
    const cards = page.locator(".investment-holding-runtime-card");
    const firstCard = cards.nth(0);
    const secondCard = cards.nth(1);
    const firstTrigger = firstCard.locator("[data-investment-holding-detail-trigger]");
    const secondTrigger = secondCard.locator("[data-investment-holding-detail-trigger]");
    const initialRect = await firstCard.boundingBox();
    const boardRect = await page.locator("#holdingCards").boundingBox();
    await firstTrigger.click();
    const panel = page.locator("[data-investment-holding-detail-layer]:not([hidden]) .investment-holding-detail-panel");
    await panel.waitFor({ state: "visible" });
    assert.equal(await firstTrigger.getAttribute("aria-expanded"), "true");
    assert.equal(await panel.getAttribute("aria-modal"), width < 500 ? "true" : "false");
    assert.match(await panel.innerText(), /平均成本 \/ 股[\s\S]*投入成本[\s\S]*目前價格[\s\S]*目前市值[\s\S]*未實現損益[\s\S]*損益率/);
    assert.match(await panel.innerText(), /近 20 日行情/);
    if (width >= 500) {
      const panelRect = await panel.boundingBox();
      assert.ok(panelRect.x >= 0 && panelRect.y >= 0 && panelRect.x + panelRect.width <= width && panelRect.y + panelRect.height <= height, "desktop panel must remain in the viewport");
    } else {
      assert.equal(await page.locator("[data-investment-holding-detail-layer]").getAttribute("data-mode"), "mobile");
      assert.ok((await panel.boundingBox()).height <= height * .76 + 1);
    }
    assert.deepEqual(await firstCard.boundingBox(), initialRect, "opening details must not resize the card");
    assert.deepEqual(await page.locator("#holdingCards").boundingBox(), boardRect, "opening details must not reflow the Board");
    if (width >= 500) {
      await firstTrigger.click();
      assert.equal(await page.locator("[data-investment-holding-detail-layer]").isHidden(), true, "activating the same trigger toggles the panel closed");
      assert.equal(await firstTrigger.getAttribute("aria-expanded"), "false");
      await firstTrigger.click();
    } else {
      await page.locator("[data-investment-holding-detail-backdrop]").click({ position: { x: 12, y: 12 } });
      await firstTrigger.click();
    }
    if (width < 500) await page.locator("[data-investment-holding-detail-backdrop]").click({ position: { x: 12, y: 12 } });
    await secondTrigger.click();
    assert.equal(await page.locator("[data-investment-holding-detail-layer]:not([hidden]) .investment-holding-detail-panel").count(), 1);
    assert.equal(await secondTrigger.getAttribute("aria-expanded"), "true");
    assert.ok(await page.locator(".investment-holding-detail-metrics .loss").count() > 0, "negative P/L uses the existing loss semantic");
    assert.equal(await page.locator("[data-investment-holding-detail-layer]:not([hidden]) .investment-holding-detail-panel").count(), 1);
    if (width < 500) {
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("[data-investment-holding-detail-close]").evaluate(node => document.activeElement === node), true, "mobile modal focus stays inside the sheet");
      await page.locator("[data-investment-holding-detail-backdrop]").click({ position: { x: 12, y: 12 } });
    } else {
      await page.mouse.click(8, height - 8);
    }
    assert.equal(await page.locator("[data-investment-holding-detail-layer]").isHidden(), true);
    await firstTrigger.click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-investment-holding-detail-layer]").isHidden(), true);
    assert.equal(await firstTrigger.getAttribute("aria-expanded"), "false");
    assert.equal(await firstTrigger.evaluate(node => document.activeElement === node), true, "closing restores focus to the original trigger");
    if (width < 500) {
      await page.locator(".investment-holding-runtime-card").nth(2).locator("[data-investment-holding-detail-trigger]").click();
      const unavailablePanel = page.locator("[data-investment-holding-detail-layer]:not([hidden]) .investment-holding-detail-panel");
      assert.match(await unavailablePanel.innerText(), /尚無行情/);
      assert.match(await unavailablePanel.innerText(), /目前價格[\s\S]*—/);
      await page.locator("[data-investment-holding-detail-close]").click();
    }
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
  assert.deepEqual(desktop.cardHeights, [104, 104, 104]);
  assert.deepEqual(mobile.cardHeights, [104, 104, 104]);
});
