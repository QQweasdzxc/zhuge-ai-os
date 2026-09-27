const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

const fixture = path.join(__dirname, "skyeye-mobile-browser.html");

async function installGeolocation(page, mode) {
  await page.addInitScript(({ permission }) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success, failure) {
          if (permission === "allow") {
            success({ coords: { latitude: 25.014, longitude: 121.463, accuracy: 18 }, timestamp: Date.now() });
          } else {
            failure({ code: 1, message: "permission denied" });
          }
        }
      }
    });
  }, { permission: mode });
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".skyeye-stage");
    const guard = document.querySelector(".skyeye-desktop-guard");
    const map = document.querySelector(".skyeye-map");
    const overlay = document.querySelector(".skyeye-overlay-layer");
    const floating = document.querySelector(".skyeye-floating-window");
    const panel = document.querySelector(".skyeye-evidence-panel");
    const sheet = document.querySelector("[data-skyeye-sheet]");
    const search = document.querySelector("[data-skyeye-search-form]");
    const searchInput = document.querySelector("[data-skyeye-search-input]");
    const locationLabel = document.querySelector("[data-skyeye-location-label]");
    const touchNodes = [...document.querySelectorAll("button")].map(node => ({
      label: node.getAttribute("aria-label") || node.textContent.trim(),
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      visible: getComputedStyle(node).display !== "none" && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    }));
    const stageRect = stage.getBoundingClientRect();
    const mapRect = map.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      stageDisplay: getComputedStyle(stage).display,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      guardExists: Boolean(guard),
      mapWidth: mapRect.width,
      mapHeight: mapRect.height,
      mapRight: mapRect.right,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
      panelPosition: getComputedStyle(panel).position,
      overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
      floatingPointerEvents: getComputedStyle(floating).pointerEvents,
      locationLabel: locationLabel.textContent,
      sheetState: sheet.dataset.sheetState,
      searchWidth: searchInput.getBoundingClientRect().width,
      searchFormHeight: search.getBoundingClientRect().height,
      dataStates: [...document.querySelectorAll(".skyeye-layer-button")].map(node => node.dataset.state),
      touchNodes
    };
  });
}

test("SkyEye Location-Centric V2 remains mobile-first and adds desktop map/evidence presentation", async t => {
  const executable = resolveBrowserExecutable();
  if (!executable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run SkyEye browser regression");
  const browser = await chromium.launch({ headless: true, executablePath: executable, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    for (const viewport of [
      { label: "mobile-375", width: 375, height: 812 },
      { label: "mobile-500", width: 500, height: 900 },
      { label: "tablet-1024", width: 1024, height: 900 },
      { label: "desktop-1440", width: 1440, height: 900 },
      { label: "desktop-1920", width: 1920, height: 1080 }
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await installGeolocation(page, "allow");
      await page.goto(pathToFileURL(fixture).href, { waitUntil: "load" });
      await page.locator("[data-skyeye-my-location]").click();
      assert.match(await page.locator("[data-skyeye-location-label]").textContent(), /我的附近/);
      await page.fill("[data-skyeye-search-input]", "板橋車站");
      await page.locator("[data-skyeye-search-form] button[type=submit]").click();
      await page.locator(".skyeye-search-result").waitFor({ state: "visible", timeout: 5000 });
      await page.locator(".skyeye-search-result").click();
      assert.match(await page.locator("[data-skyeye-location-label]").textContent(), /板橋車站附近/);
      await page.locator("[data-skyeye-search-area]").click();
      assert.match(await page.locator(".skyeye-status-pill").textContent(), /已搜尋目前地圖範圍/);
      if (viewport.width < 768) {
        await page.locator("[data-skyeye-sheet-to=half]").click();
        assert.equal(await page.locator("[data-skyeye-sheet]").getAttribute("data-sheet-state"), "half");
        await page.locator("[data-skyeye-sheet-to=expanded]").click();
        assert.equal(await page.locator("[data-skyeye-sheet]").getAttribute("data-sheet-state"), "expanded");
      }
      const result = await inspectPage(page);
      assert.ok(result.scrollWidth <= result.width + 1, `${viewport.label}: horizontal overflow`);
      assert.ok(result.scrollHeight <= result.height + 2, `${viewport.label}: vertical overflow`);
      assert.ok(result.touchNodes.filter(node => node.visible).every(node => node.width >= 44 && node.height >= 44), `${viewport.label}: visible touch target below 44px`);
      assert.equal(result.guardExists, false, `${viewport.label}: legacy desktop guard remains`);
      assert.match(result.locationLabel, /板橋車站附近/);
      assert.deepEqual(result.dataStates, ["available", "available", "empty"]);
      if (viewport.width < 768) {
        assert.equal(result.stageDisplay, "block", `${viewport.label}: mobile stage changed presentation`);
        assert.ok(result.mapWidth >= viewport.width - 1, `${viewport.label}: map not full width`);
        assert.ok(result.mapHeight > 500, `${viewport.label}: map is not full-screen enough`);
        assert.equal(result.panelPosition, "absolute", `${viewport.label}: mobile bottom sheet changed presentation`);
        assert.equal(result.overlayPointerEvents, "none", `${viewport.label}: overlay blocks map gestures`);
        assert.equal(result.floatingPointerEvents, "auto", `${viewport.label}: floating window is not interactive`);
      } else {
        assert.equal(result.stageDisplay, "grid", `${viewport.label}: desktop stage is not map/panel grid`);
        assert.ok(result.mapWidth >= 280, `${viewport.label}: map area is too narrow`);
        assert.ok(result.mapHeight >= 540, `${viewport.label}: desktop map is too short`);
        assert.ok(result.panelWidth >= 300, `${viewport.label}: evidence panel is too narrow`);
        assert.ok(result.panelHeight >= 540, `${viewport.label}: evidence panel is too short`);
        assert.equal(result.panelPosition, "relative", `${viewport.label}: desktop panel still uses mobile absolute sheet`);
        assert.ok(result.mapRight <= result.stageWidth - result.panelWidth + 1, `${viewport.label}: map overlaps evidence panel`);
        assert.equal(result.sheetState, "collapsed", `${viewport.label}: desktop panel should not use mobile sheet state`);
      }
      await page.close();
      await context.close();
    }

    for (const permission of ["allow", "deny"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await installGeolocation(page, permission);
      await page.goto(pathToFileURL(fixture).href, { waitUntil: "load" });
      await page.locator("[data-skyeye-my-location]").click();
      const label = await page.locator("[data-skyeye-location-label]").textContent();
      assert.match(label, permission === "allow" ? /我的附近/ : /請搜尋地點/, `desktop geolocation ${permission}`);
      await page.close();
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
