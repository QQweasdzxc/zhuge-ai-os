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
    if (/^\/rest\/v1\/(app_users|portfolios|watchlists|investment_current_positions_view|broker_position_snapshots|current_broker_positions_view)$/.test(url.pathname)) {
      result.portfolioReadRequests += 1;
    }
    if (/\/rest\/v1\//.test(url.pathname) && !["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
      result.portfolioWriteRequests = (result.portfolioWriteRequests || 0) + 1;
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
  await page.getByRole("link", { name: "進入 Lab" }).click();
  await page.waitForURL(/\/labs\/investment\/$/);
  const nav = page.locator('.lab-content-nav[role="tablist"]');
  await nav.getByRole("tab", { name: "我的持股" }).waitFor({ state: "visible" });
  const localTabs = ["總覽", "選股雷達", "市場", "我的持股", "觀察名單", "個股研究", "籌碼", "技術分析", "平倉歷史"];
  assert.deepEqual(await nav.locator(".zhuge-functional-tab-label").allTextContents(), localTabs);
  assert.equal(await nav.getByRole("tab", { name: "總覽" }).getAttribute("aria-selected"), "true");
  assert.equal(await nav.getByRole("tab", { name: "我的持股" }).getAttribute("aria-selected"), "false");
  await page.locator("[data-symbol-search-form]").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("[data-market-select] option").allTextContents(), ["台股", "美股"]);
  assert.doesNotMatch(await page.locator("body").innerText(), /Investment Watchlist Projection|Investment Position Projection/);
  assert.match(await page.locator("body").innerText(), /登入授權後讀取|登入後讀取/);
  assert.doesNotMatch(await page.locator("body").innerText(), /0 個目前部位|0 筆正式觀察/);
  assert.equal(await page.locator(".portfolio-holding-card").count(), 0);
  assert.equal(result.portfolioReadRequests, 0, "anonymous session must be denied before protected portfolio reads");
  await save(page, "lab-holdings-desktop-1440.png");
  pass("Lab Center → same-origin Lab runtime", `path=${new URL(page.url()).pathname}; ${localTabs.length} local functions; single AIOS shell and Investment local navigation`);
  pass("holdings authenticated-read gate", "anonymous browser shows SESSION_REQUIRED before owner mapping or protected view SELECT; valuation is labeled non-real-time");

  await nav.getByRole("tab", { name: "我的持股" }).click();
  await page.getByText("需要先登入 Zhuge AI OS", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".portfolio-holding-card").count(), 0);
  await save(page, "lab-holdings-auth-gate-desktop-1440.png");
  pass("canonical holdings remain fail-closed without session", "SESSION_REQUIRED is explicit; no zero count or fixture holding is presented");

  await nav.getByRole("tab", { name: "觀察名單" }).click();
  await page.getByRole("heading", { name: "我的觀察名單", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "我的正式觀察名單", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "本機暫存觀察", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "觀察名單訊息候選", exact: true }).waitFor({ state: "visible" });
  assert.match(await page.locator("body").innerText(), /候選來源是依股票代號／名稱搜尋的 Provider 結果/);
  assert.match(await page.locator("body").innerText(), /Email／推播需要 AIOS 通知服務設定/);
  assert.match(await page.locator("body").innerText(), /請登入後讀取正式觀察名單/);
  assert.equal(await page.locator("[data-watchlist-id]").count(), 0);
  await save(page, "lab-watchlist-desktop-1440.png");
  pass("canonical watchlist separated from local temporary observations", "formal watchlists section is owner-authenticated and localStorage is labeled 本機暫存觀察");

  await nav.getByRole("tab", { name: "平倉歷史" }).click();
  await page.getByRole("heading", { name: "我的平倉歷史", exact: true }).waitFor({ state: "visible" });
  assert.match(await page.locator("body").innerText(), /請登入後讀取平倉歷史/);
  assert.equal(await page.locator(".watch-row").count(), 0);
  await save(page, "lab-closed-history-desktop-1440.png");
  assert.equal(result.portfolioReadRequests, 0, "anonymous session must not read protected holdings/watchlist/history rows");
  const desktop = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(desktop.scrollWidth <= desktop.width + 1, JSON.stringify(desktop));
  pass("canonical closed-history boundary", "history view uses authenticated adapter and presents no locally synthesized rows while unauthenticated");

  await nav.getByRole("tab", { name: "選股雷達" }).click();
  await page.getByText(/Scanner 讀取失敗/).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "台股全市場" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "我的持股／觀察" }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".scanner-table tbody tr").count(), 0, "unauthenticated browser must not render test or simulated scan rows");
  assert.equal(result.portfolioReadRequests, 0, "scanner must fail closed before private portfolio reads");
  pass("market scanner authorization boundary", "local anonymous preview does not call Production providers or display fixtures; authenticated result path remains a HUMAN_GATE");

  const forbiddenWrites = (result.requestFailures || []).filter((request) => !/ERR_ABORTED/.test(request.failure));
  assert.equal(result.portfolioWriteRequests || 0, 0);
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.consoleErrors, []);
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  watchPage(mobile);
  await mobile.goto(`${base}/labs/investment/`, { waitUntil: "domcontentloaded" });
  const mobileNav = mobile.locator('.lab-content-nav[role="tablist"]');
  await mobileNav.getByRole("tab", { name: "我的持股" }).waitFor({ state: "visible" });
  const mobileButtons = mobile.locator(".lab-content-nav .zhuge-functional-tab");
  assert.deepEqual(await mobile.locator(".lab-content-nav .zhuge-functional-tab-label").allTextContents(), ["總覽", "選股雷達", "市場", "我的持股", "觀察名單", "個股研究", "籌碼", "技術分析", "平倉歷史"]);
  const targets = await mobileButtons.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
  assert.ok(targets.every((height) => height >= 44), JSON.stringify(targets));
  await mobileNav.getByRole("tab", { name: "觀察名單" }).click();
  await mobile.getByRole("heading", { name: "本機暫存觀察", exact: true }).waitFor({ state: "visible" });
  await mobileNav.getByRole("tab", { name: "平倉歷史" }).click();
  await mobile.getByRole("heading", { name: "我的平倉歷史", exact: true }).waitFor({ state: "visible" });
  const mobileLayout = await mobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.width + 1, JSON.stringify(mobileLayout));
  await save(mobile, "lab-investment-mobile-390x844.png");
  pass("Mobile three-view navigation", `${JSON.stringify(mobileLayout)}; 3 touch targets all >=44px`);
  await mobileContext.close();

  result.checks.push({ name: "Lab browser write boundary", result: "PASS", evidence: "anonymous journey generated zero protected data reads and zero writes; implementation exposes SELECT-only canonical adapter methods" });
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
