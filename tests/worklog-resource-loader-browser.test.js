const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable, fixtureURL } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");
const ENTRY = path.join(ROOT, "modules/worklog/index.html");
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build;
const DELAY_MS = 60;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openApp(browser, entryUrl, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (["stylesheet", "script"].includes(request.resourceType())) {
      await wait(DELAY_MS);
      if (request.url().includes("cdn.jsdelivr.net/npm/@supabase/supabase-js")) {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.__supabaseTestStub = true;" });
      }
    }
    return route.continue();
  });
  const started = Date.now();
  await page.goto(`${entryUrl}?app=1&workspace=dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const root = document.getElementById("app");
    return root && !root.querySelector(".app-boot-shell") && Boolean(root.textContent.trim());
  }, { timeout: 30000 });
  const readyAt = Date.now() - started;
  const metrics = await page.evaluate((build) => {
    const resources = performance.getEntriesByType("resource");
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((link) => link.href.includes(".css?v="));
    const preloads = [...document.querySelectorAll('link[rel="preload"][as="script"]')];
    const scripts = [...document.scripts].filter((script) => script.src &&
      !/\/(?:version|template-release|cli-sso|zhuge-appearance)\.js(?:\?|$)/.test(script.src));
    const entriesFor = (items) => items.map((item) => resources.find((resource) => resource.name === (item.href || item.src))?.startTime).filter(Number.isFinite);
    const styleStarts = entriesFor(styles);
    const scriptStarts = entriesFor(preloads);
    const firstPaint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null;
    return {
      build,
      firstPaintMs: firstPaint === null ? null : Math.round(firstPaint),
      cssCount: styles.length,
      preloadCount: preloads.length,
      executableRuntimeScriptCount: scripts.length,
      cssRequestStartSpanMs: styleStarts.length ? Math.round(Math.max(...styleStarts) - Math.min(...styleStarts)) : null,
      jsRequestStartSpanMs: scriptStarts.length ? Math.round(Math.max(...scriptStarts) - Math.min(...scriptStarts)) : null,
      cssJsStartGapMs: styleStarts.length && scriptStarts.length ? Math.round(Math.abs(Math.min(...styleStarts) - Math.min(...scriptStarts))) : null,
      appText: document.getElementById("app")?.innerText.slice(0, 140) ?? ""
    };
  }, BUILD);
  return { context, page, readyAt, metrics };
}

test("WorkLog starts its real CSS/JS loader in parallel on desktop and mobile and survives reload", async (t) => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, "CI Chromium is required for WorkLog resource-loader browser QA");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(async () => browser.close());
  const entryUrl = await fixtureURL(ENTRY);

  for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile-emulation", width: 390, height: 844 }]) {
    const first = await openApp(browser, entryUrl, { width: viewport.width, height: viewport.height });
    assert.equal(first.metrics.cssCount, 16, `${viewport.name} should load all app styles`);
    assert.equal(first.metrics.preloadCount, 59, `${viewport.name} should start all script preloads including the TaskFlow return-intent helper`);
    assert.equal(first.metrics.executableRuntimeScriptCount, 59, `${viewport.name} should execute all runtime scripts`);
    assert.ok(first.metrics.firstPaintMs !== null, `${viewport.name} should paint the boot shell before runtime completes`);
    assert.ok(first.metrics.cssRequestStartSpanMs < 250, JSON.stringify(first.metrics));
    assert.ok(first.metrics.jsRequestStartSpanMs < 250, JSON.stringify(first.metrics));
    assert.ok(first.metrics.cssJsStartGapMs < 250, JSON.stringify(first.metrics));
    assert.doesNotMatch(first.metrics.appText, /工作空間暫時無法開啟/);
    console.log(`WORKLOG_BROWSER_${viewport.name.toUpperCase()}: first-paint=${first.metrics.firstPaintMs}ms, app-shell-ready=${first.readyAt}ms, CSS=${first.metrics.cssCount}, JS=${first.metrics.executableRuntimeScriptCount}, CSS-start-span=${first.metrics.cssRequestStartSpanMs}ms, JS-start-span=${first.metrics.jsRequestStartSpanMs}ms`);
    await first.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await first.page.waitForFunction(() => !document.querySelector("#app .app-boot-shell") && Boolean(document.querySelector("#app")?.textContent?.trim()), { timeout: 30000 });
    const reload = await first.page.evaluate(() => ({
      css: document.querySelectorAll('link[rel="stylesheet"][href*=".css?v="]').length,
      scripts: [...document.scripts].filter((script) => script.src && !/\/(?:version|template-release|cli-sso|zhuge-appearance)\.js(?:\?|$)/.test(script.src)).length,
      text: document.getElementById("app")?.innerText.slice(0, 140) ?? ""
    }));
    assert.equal(reload.css, 16);
    assert.equal(reload.scripts, 59);
    assert.doesNotMatch(reload.text, /工作空間暫時無法開啟/);
    await first.context.close();
  }
});

test("WorkLog still shows its fail-closed resource message when a stylesheet fails", async (t) => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, "CI Chromium is required for WorkLog resource-loader browser QA");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(async () => browser.close());
  const entryUrl = await fixtureURL(ENTRY);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/modules/worklog/worklog.css?*", (route) => route.abort());
  await page.goto(`${entryUrl}?app=1&workspace=dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText("版面資源載入失敗，請重新整理後再試。", { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('script[src*="shared/i18n/zh-TW.js"]').count(), 0, "app scripts must not execute after a style load failure");
  await browser.close();
});
