const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "task-088-responsive-preview.html");
const evidenceDir = path.join(__dirname, "evidence");

async function inspect(page, label) {
  const metrics = await page.evaluate(() => {
    const target = document.querySelector(".responsive-actions button");
    const drawerClose = document.querySelector(".shared-task-drawer-close");
    const hub = document.querySelector(".zhuge-hub-trigger");
    const root = document.documentElement;
    return {
      width: innerWidth,
      height: innerHeight,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      targetMinHeight: getComputedStyle(target).minHeight,
      targetBox: target.getBoundingClientRect().toJSON(),
      drawerCloseBox: drawerClose.getBoundingClientRect().toJSON(),
      hubBox: hub.getBoundingClientRect().toJSON(),
      drawerPanelHeight: getComputedStyle(document.querySelector(".shared-task-drawer-panel")).height,
      drawerOverflow: getComputedStyle(document.querySelector(".shared-task-drawer-grid")).overflow,
      safeBottom: getComputedStyle(root).getPropertyValue("--zhuge-safe-area-bottom").trim(),
      bodyFontSize: getComputedStyle(document.body).fontSize,
      hasLongText: document.body.textContent.includes("長內容測試")
    };
  });
  assert.equal(metrics.scrollWidth, metrics.clientWidth, `${label}: page horizontal overflow`);
  assert.ok(metrics.targetBox.width >= 44 && metrics.targetBox.height >= 44, `${label}: action touch target is smaller than 44px`);
  assert.ok(metrics.drawerCloseBox.width >= 44 && metrics.drawerCloseBox.height >= 44, `${label}: drawer close target is smaller than 44px`);
  assert.ok(metrics.hubBox.width >= 44 && metrics.hubBox.height >= 44, `${label}: Hub target is smaller than 44px`);
  assert.equal(metrics.hasLongText, true);
  return metrics;
}

(async () => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, "Chrome executable is required for responsive browser QA");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--disable-gpu", "--disable-dev-shm-usage"]
  });
  const results = {};
  try {
    for (const [label, viewport] of [
      ["desktop-1440", { width: 1440, height: 1000 }],
      ["tablet-1024", { width: 1024, height: 900 }],
      ["mobile-500", { width: 500, height: 900 }],
      ["narrow-375", { width: 375, height: 812 }]
    ]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`file://${fixture}`, { waitUntil: "load" });
      await page.screenshot({
        path: path.join(evidenceDir, `task-088-${label}-responsive-source-preview.png`),
        fullPage: true,
        animations: "disabled"
      });
      results[label] = await inspect(page, label);
      assert.equal(errors.length, 0, `${label}: browser errors\n${errors.join("\n")}`);

      /* Simulate browser text enlargement. This is deliberately not a
       * product-data/runtime claim; it verifies source reflow only. */
      await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
      await page.waitForTimeout(40);
      results[`${label}-text-zoom`] = await inspect(page, `${label} text zoom`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ status: "PASS", fixture: path.relative(ROOT, fixture), results }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
