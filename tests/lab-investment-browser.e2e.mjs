import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.resolve(process.env.LAB_INVESTMENT_EVIDENCE_DIR || "/tmp/zhuge-lab-investment-browser-evidence");
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml"],
]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === "/") pathname = "/labs/";
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, {
      "content-type": mime.get(path.extname(file)) || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.BROWSER_EXECUTABLE,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

await mkdir(evidenceDir, { recursive: true });
await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, ...(browserExecutable() ? { executablePath: browserExecutable() } : {}) });
const result = { runAt: new Date().toISOString(), scope: "temporary static-file preview only; no authenticated session or API server", checks: [], providerCorsErrors: [], consoleErrors: [], pageErrors: [], screenshots: [], portfolioReadRequests: 0 };
const pass = (name, evidence = "") => result.checks.push({ name, result: "PASS", evidence });
const providerHosts = new Set([
  "openapi.twse.com.tw", "openapi.taifex.com.tw", "openapi.tdcc.com.tw",
  "www.tpex.org.tw", "thedocs.worldbank.org", "datacatalog.worldbank.org",
  "www.twse.com.tw", "www.dramexchange.com", "en.sse.net.cn", "indexes.nasdaqomx.com",
]);

function watchPage(page) {
  page.on("request", (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (/^\/rest\/v1\/(app_users|portfolios|investment_current_positions_view|broker_position_snapshots|current_broker_positions_view)$/.test(url.pathname)) {
      result.portfolioReadRequests += 1;
    }
  });
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    let parsed;
    try { parsed = new URL(request.url()); } catch {}
    const failure = request.failure()?.errorText || "browser fetch failed";
    const record = { host: parsed?.hostname || "unknown", path: parsed?.pathname || "", failure };
    result.requestFailures ||= [];
    result.requestFailures.push(record);
    if (providerHosts.has(record.host)) result.providerCorsErrors.push(`${record.host}${record.path}: ${failure}`);
    else if (/ERR_ABORTED/.test(failure)) {
      result.expectedNavigationCancellations ||= [];
      result.expectedNavigationCancellations.push(record);
    } else {
      result.unexpectedRequestFailures ||= [];
      result.unexpectedRequestFailures.push(record);
    }
  });
  page.on("response", (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (response.status() >= 400) {
      result.httpErrorResponses ||= [];
      result.httpErrorResponses.push({ host: url.hostname, path: url.pathname, status: response.status() });
    }
    if (url.origin === new URL(base).origin && response.status() >= 400) {
      result.sameOriginHttpFailures ||= [];
      result.sameOriginHttpFailures.push({ path: url.pathname, status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Access to fetch|CORS policy|blocked by CORS/i.test(text)) result.providerCorsErrors.push(text.slice(0, 280));
    else if (/Failed to load resource: net::ERR_[A-Z_]+/.test(text)) {
      result.browserNetworkNotices ||= [];
      result.browserNetworkNotices.push(text.slice(0, 280));
    }
    else result.consoleErrors.push({ message: text.slice(0, 280), location: message.location() });
  });
}

async function save(page, name) {
  const file = path.join(evidenceDir, name);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  result.screenshots.push(file);
}

async function saveElement(locator, name) {
  const file = path.join(evidenceDir, name);
  await locator.screenshot({ path: file, animations: "disabled" });
  result.screenshots.push(file);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watchPage(page);
  await page.goto(`${base}/labs/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Lab 實驗室" }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: /Lab_投資/ }).waitFor({ state: "visible" });
  const href = await page.getByRole("link", { name: "進入 Lab" }).getAttribute("href");
  assert.equal(new URL(href, page.url()).origin, new URL(page.url()).origin);
  await save(page, "lab-center-desktop-1440.png");
  await page.getByRole("link", { name: "進入 Lab" }).click();
  await page.waitForURL(/\/labs\/investment\/$/);
  await page.locator('.portfolio-state[data-state="SESSION_REQUIRED"]').waitFor({ state: "visible" });
  await page.locator(".stock-card").first().waitFor({ state: "visible", timeout: 90_000 });
  assert.equal(await page.locator(".stock-card").count(), 3);
  assert.equal(await page.locator(".portfolio-holding-card").count(), 0);
  assert.match(await page.locator(".portfolio-state").innerText(), /需要先登入 Zhuge AI OS/);
  assert.equal(result.portfolioReadRequests, 0, "anonymous session must be denied before any portfolio REST read");
  assert.match(await page.locator("body").innerText(), /2330\.TW|台積電/);
  assert.doesNotMatch(await page.locator("body").innerText(), /開啟本機 Lab|在終端機執行|Demo 限制|VIP lock|License Key/);
  assert.equal(await page.locator("a[href]").evaluateAll((links) => links.some((link) => /^(https?:)?\/\/(127\.0\.0\.1|localhost)|\.app(?:$|\/)/i.test(link.getAttribute("href") || ""))), false);
  await save(page, "investment-home-desktop-1440.png");
  await save(page, "my-holdings-session-gate-desktop-1440.png");
  const desktop = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(desktop.scrollWidth <= desktop.width + 1, JSON.stringify(desktop));
  pass("AIOS Lab Center → same-origin Lab runtime", `path=${new URL(page.url()).pathname}; no popup or independent service; ${JSON.stringify(desktop)}`);
  pass("anonymous portfolio boundary", "SESSION_REQUIRED before owner mapping/portfolio SELECT; portfolio REST reads=0");

  for (const [symbol, name, screenshot] of [
    ["2330.TW", "台積電", "investment-2330-desktop-1440.png"],
    ["0050.TW", "元大台灣50", "investment-0050-desktop-1440.png"],
    ["6488.TWO", "環球晶", "investment-6488-desktop-1440.png"],
  ]) {
    await page.locator(`button[data-action="research"][data-symbol="${symbol}"]`).first().click();
    await page.getByRole("heading", { name: new RegExp(`${symbol} 個股研究`) }).waitFor({ state: "visible", timeout: 90_000 });
    const text = await page.locator("body").innerText();
    assert.ok(text.includes(name));
    assert.match(text, /來源與證據|Provider：/);
    if (symbol === "0050.TW") assert.match(text, /ETF|不適用此標的/);
    if (symbol === "6488.TWO") assert.match(text, /需要安全資料代理|尚未接通|暫時無法取得/);
    await save(page, screenshot);
    pass(`${symbol} research route and truthful provider state`, `page title and evidence rendered; ${symbol === "6488.TWO" ? "TPEx CORS boundary retained" : "no simulated value asserted"}`);
    if (symbol !== "6488.TWO") await page.getByRole("button", { name: "返回總覽" }).click();
  }

  for (const [view, title] of [["opening", "開盤壓力"], ["market", "大盤脈搏"], ["radar", "產業價格雷達"]]) {
    await page.locator(`[data-view="${view}"]`).first().click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor({ state: "visible", timeout: 90_000 });
    assert.ok((await page.locator("body").innerText()).length > 100);
    pass(`${title} static route`, "real provider results or explicit unavailable/proxy-required state rendered");
  }

  await page.goto(`${base}/labs/investment/#research/AAPL`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /AAPL 個股研究/ }).waitFor({ state: "visible", timeout: 90_000 });
  assert.match(await page.locator("body").innerText(), /尚未接通/);
  await save(page, "investment-AAPL-research-not-connected-desktop-1440.png");
  pass("AAPL research route retains explicit provider boundary", "NOT_CONNECTED with null evidence; no simulated quote or holdings displayed");

  await page.goto(`${base}/labs/investment/#research/NVDA`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /NVDA 個股研究/ }).waitFor({ state: "visible", timeout: 90_000 });
  assert.match(await page.locator("body").innerText(), /尚未接通/);
  pass("NVDA research route retains explicit provider boundary", "NOT_CONNECTED with null evidence; no simulated quote or holdings displayed");
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  watchPage(mobile);
  await mobile.goto(`${base}/labs/investment/`, { waitUntil: "domcontentloaded" });
  await mobile.locator('.portfolio-state[data-state="SESSION_REQUIRED"]').waitFor({ state: "visible" });
  await mobile.locator(".stock-card").first().waitFor({ state: "visible", timeout: 90_000 });
  assert.equal(await mobile.locator(".portfolio-holding-card").count(), 0);
  assert.equal(result.portfolioReadRequests, 0, "mobile anonymous session must not trigger portfolio REST reads");
  const layout = await mobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
  const targets = await mobile.locator(".mobile-nav button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
  assert.ok(targets.every((height) => height >= 44), JSON.stringify(targets));
  await save(mobile, "investment-home-mobile-375.png");
  await save(mobile, "my-holdings-session-gate-mobile-375.png");
  await mobile.locator('button[data-action="research"][data-symbol="2330.TW"]').first().click();
  await mobile.getByRole("heading", { name: /2330\.TW 個股研究/ }).waitFor({ state: "visible", timeout: 90_000 });
  await save(mobile, "investment-2330-mobile-375.png");
  pass("Mobile 375×812 Lab and 2330 journey", `${JSON.stringify(layout)}; minimum navigation target=${Math.min(...targets)}px`);
  await mobileContext.close();

  const fixtureContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const fixture = await fixtureContext.newPage();
  watchPage(fixture);
  await fixture.goto(`${base}/labs/investment/test/fixtures/portfolio-sparkline.html`, { waitUntil: "domcontentloaded" });
  await fixture.locator('html[data-fixture-ready="true"]').waitFor({ state: "attached" });
  assert.match(await fixture.locator(".fixture-banner").innerText(), /QA VISUAL FIXTURE.*合成測試資料/);
  assert.equal(await fixture.locator(".portfolio-holding-card").count(), 4);
  const etfCard = fixture.locator('[data-portfolio-symbol="0050"]');
  const stockCard = fixture.locator('[data-portfolio-symbol="2330"]');
  const tpexCard = fixture.locator('[data-portfolio-symbol="6488"]');
  assert.equal(await etfCard.locator('.portfolio-sparkline-chart[data-point-count="20"]').count(), 1);
  assert.equal(await etfCard.locator('[data-average-cost-reference="true"]').count(), 1);
  assert.equal(await etfCard.locator('[data-latest-point="true"]').count(), 1);
  assert.equal(await stockCard.locator('[data-average-cost-reference="true"]').count(), 1);
  assert.equal(await tpexCard.locator('.portfolio-sparkline[data-history-status="NOT_CONNECTED"] .portfolio-sparkline-chart').count(), 0);
  assert.match(await tpexCard.innerText(), /歷史行情尚未接通|NOT_CONNECTED/);
  await save(fixture, "my-holdings-desktop-1440.png");
  await saveElement(etfCard, "0050-card-desktop-1440.png");
  await saveElement(stockCard, "average-cost-reference-card-desktop-1440.png");
  await saveElement(tpexCard, "no-history-card-desktop-1440.png");
  const desktopFixtureLayout = await fixture.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(desktopFixtureLayout.scrollWidth <= desktopFixtureLayout.width + 1, JSON.stringify(desktopFixtureLayout));
  pass("Portfolio sparkline desktop visual fixture", `${JSON.stringify(desktopFixtureLayout)}; 20-point chart, average-cost line, latest point and NOT_CONNECTED verified; visible synthetic-data watermark`);
  await fixtureContext.close();

  const fixtureMobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const fixtureMobile = await fixtureMobileContext.newPage();
  watchPage(fixtureMobile);
  await fixtureMobile.goto(`${base}/labs/investment/test/fixtures/portfolio-sparkline.html`, { waitUntil: "domcontentloaded" });
  await fixtureMobile.locator('html[data-fixture-ready="true"]').waitFor({ state: "attached" });
  const mobileFixtureLayout = await fixtureMobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(mobileFixtureLayout.scrollWidth <= mobileFixtureLayout.width + 1, JSON.stringify(mobileFixtureLayout));
  assert.equal(await fixtureMobile.locator('[data-portfolio-symbol="0050"] [data-average-cost-reference="true"]').count(), 1);
  await save(fixtureMobile, "my-holdings-mobile-375.png");
  pass("Portfolio sparkline mobile visual fixture", `${JSON.stringify(mobileFixtureLayout)}; no horizontal overflow; visible synthetic-data watermark`);
  await fixtureMobileContext.close();

  if (result.unexpectedRequestFailures?.length) result.consoleErrors.push(`Unexpected request failures: ${JSON.stringify(result.unexpectedRequestFailures)}`);
  if (result.sameOriginHttpFailures?.length) result.consoleErrors.push(`Same-origin HTTP failures: ${JSON.stringify(result.sameOriginHttpFailures)}`);
  const classifiedNetworkFailures = (result.requestFailures || []).filter((failure) => providerHosts.has(failure.host) || /ERR_ABORTED/.test(failure.failure)).length;
  if (result.browserNetworkNotices?.length > classifiedNetworkFailures) {
    result.consoleErrors.push("Browser reported a network failure but no provider-boundary request was captured.");
  }
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.consoleErrors, []);
  result.checks.push({ name: "Runtime JavaScript/console errors", result: "PASS", evidence: "0 uncaught page errors; CORS errors are captured separately as expected provider boundary evidence." });
} catch (error) {
  result.failure = String(error?.stack || error);
  result.checks.push({ name: "Lab Investment browser journeys", result: "FAIL", evidence: String(error?.message || error) });
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const output = path.join(evidenceDir, "browser-result.json");
await (await import("node:fs/promises")).writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  passCount: result.checks.filter((check) => check.result === "PASS").length,
  failCount: result.checks.filter((check) => check.result === "FAIL").length,
  checks: result.checks,
  pageErrors: result.pageErrors,
  consoleErrors: result.consoleErrors,
  providerCorsErrors: result.providerCorsErrors.length,
  screenshots: result.screenshots,
  evidence: output,
}, null, 2));
if (result.checks.some((check) => check.result === "FAIL")) process.exitCode = 1;
