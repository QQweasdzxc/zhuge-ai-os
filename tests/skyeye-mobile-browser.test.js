const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

const fixture = path.join(__dirname, "skyeye-mobile-browser.html");

test("SkyEye mobile guard keeps the map usable across mobile and desktop viewports", async t => {
  const executable = resolveBrowserExecutable();
  if (!executable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run SkyEye browser regression");
  const browser = await chromium.launch({ headless: true, executablePath: executable, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    for (const viewport of [
      { label: "mobile-375", width: 375, height: 812 },
      { label: "mobile-500", width: 500, height: 900 },
      { label: "desktop-1024", width: 1024, height: 900 }
    ]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(fixture).href, { waitUntil: "load" });
      const result = await page.evaluate(() => {
        const stage = document.querySelector(".skyeye-mobile-stage");
        const guard = document.querySelector(".skyeye-desktop-guard");
        const map = document.querySelector(".skyeye-map");
        const overlay = document.querySelector(".skyeye-overlay-layer");
        const floating = document.querySelector(".skyeye-floating-window");
        const touchNodes = [...document.querySelectorAll("button")].map(node => ({
          label: node.getAttribute("aria-label") || node.textContent.trim(),
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          visible: getComputedStyle(node).display !== "none" && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
        }));
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          stageDisplay: getComputedStyle(stage).display,
          guardDisplay: getComputedStyle(guard).display,
          mapWidth: map.getBoundingClientRect().width,
          mapHeight: map.getBoundingClientRect().height,
          overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
          floatingPointerEvents: getComputedStyle(floating).pointerEvents,
          touchNodes
        };
      });
      assert.ok(result.scrollWidth <= result.width + 1, `${viewport.label}: horizontal overflow`);
      assert.ok(result.touchNodes.filter(node => node.visible).every(node => node.width >= 44 && node.height >= 44), `${viewport.label}: visible touch target below 44px`);
      if (viewport.width < 768) {
        assert.equal(result.stageDisplay, "block", `${viewport.label}: mobile stage hidden`);
        assert.equal(result.guardDisplay, "none", `${viewport.label}: desktop guard visible`);
        assert.ok(result.mapWidth >= viewport.width - 1, `${viewport.label}: map not full width`);
        assert.ok(result.mapHeight > 500, `${viewport.label}: map is not full-screen enough`);
        assert.equal(result.overlayPointerEvents, "none", `${viewport.label}: overlay blocks map gestures`);
        assert.equal(result.floatingPointerEvents, "auto", `${viewport.label}: floating window is not interactive`);
      } else {
        assert.equal(result.stageDisplay, "none", `${viewport.label}: mobile map should be guarded on desktop`);
        assert.equal(result.guardDisplay, "grid", `${viewport.label}: desktop guard missing`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
