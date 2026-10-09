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
  const investmentCard = page.getByRole("article").filter({ hasText: "Lab_投資" });
  const investmentLink = investmentCard.getByRole("link", { name: "進入 Lab" });
  const href = await investmentLink.getAttribute("href");
  assert.equal(new URL(href, page.url()).origin, new URL(page.url()).origin);
  await investmentLink.click();
  await page.waitForURL(/\/labs\/investment\/$/);
  const nav = page.locator('.lab-content-nav[role="tablist"]');
  await nav.getByRole("tab", { name: "我的持股" }).waitFor({ state: "visible" });
  const localTabs = ["總覽", "選股雷達", "市場", "我的持股", "觀察名單", "個股研究", "籌碼", "技術分析", "策略回測", "平倉歷史"];
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
  const overviewMacro = page.locator(".us-treasury-context");
  await overviewMacro.waitFor({ state: "visible" });
  assert.match(await overviewMacro.innerText(), /無可用資料/);
  assert.doesNotMatch(await overviewMacro.innerText(), /\d+\.\d+%/);
  const overviewFx = page.locator("[data-global-fx-context]");
  await overviewFx.waitFor({ state: "visible" });
  assert.equal(await overviewFx.getAttribute("data-global-fx-context"), "unavailable");
  assert.match(await overviewFx.innerText(), /FRED|固定 FRED/);
  assert.doesNotMatch(await overviewFx.innerText(), /1\.17|157\.2|1\.34/);
  const commodityContext = page.locator(".evidence-card").filter({ hasText: "World Bank Pink Sheet" });
  await commodityContext.waitFor({ state: "visible" });
  assert.match(await commodityContext.innerText(), /暫時無法取得/);
  assert.doesNotMatch(await commodityContext.innerText(), /\d+\.\d+/);
  await save(page, "lab-holdings-desktop-1440.png");
  pass("Lab Center → same-origin Lab runtime", `path=${new URL(page.url()).pathname}; ${localTabs.length} local functions; single AIOS shell and Investment local navigation`);
  pass("official Treasury macro context remains truthful without a readable response", "anonymous browser displays an explicit unavailable state; no yield is fabricated");
  pass("holdings authenticated-read gate", "anonymous browser shows SESSION_REQUIRED before owner mapping or protected view SELECT; valuation is labeled non-real-time");

  await nav.getByRole("tab", { name: "我的持股" }).click();
  await page.getByText("需要先登入 Zhuge AI OS", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".portfolio-holding-card").count(), 0);
  await save(page, "lab-holdings-auth-gate-desktop-1440.png");
  pass("canonical holdings remain fail-closed without session", "SESSION_REQUIRED is explicit; no zero count or fixture holding is presented");

  await nav.getByRole("tab", { name: "策略回測" }).click();
  await page.getByText("先用上方股票搜尋選擇一檔台股或美股，再開啟策略回測。", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-backtest-result]").count(), 0);
  assert.equal(result.portfolioWriteRequests || 0, 0);
  pass("historical backtest requires an explicitly selected research symbol", "no seeded ticker, synthetic bars, or transaction write path is exposed");

  await nav.getByRole("tab", { name: "市場" }).click();
  await page.getByRole("heading", { name: "市場 / Global Context", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "台股市場", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "臺指期盤後情境", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "上市三大法人彙總", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "上櫃三大法人彙總", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "上市／上櫃融資融券餘額", exact: true }).waitFor({ state: "visible" });
  assert.match(await page.locator("body").innerText(), /海外指數、匯率與商品是市場背景/);
  const marketMacro = page.locator(".us-treasury-context");
  await marketMacro.waitFor({ state: "visible" });
  assert.match(await marketMacro.innerText(), /無可用資料/);
  assert.doesNotMatch(await marketMacro.innerText(), /\d+\.\d+%/);
  const marketFx = page.locator("[data-global-fx-context]");
  await marketFx.waitFor({ state: "visible" });
  assert.equal(await marketFx.getAttribute("data-global-fx-context"), "unavailable");
  assert.match(await marketFx.innerText(), /FRED|固定 FRED/);
  assert.doesNotMatch(await marketFx.innerText(), /1\.17|157\.2|1\.34/);
  assert.match(await page.locator("body").innerText(), /美股先行股票/);
  assert.match(await page.locator("body").innerText(), /不代表 S&P \/ Nasdaq \/ SOX 指數/);
  const marketCommodityContext = page.locator(".evidence-card").filter({ hasText: "World Bank Pink Sheet" });
  await marketCommodityContext.waitFor({ state: "visible" });
  assert.doesNotMatch(await marketCommodityContext.innerText(), /\d+\.\d+/);
  assert.equal(result.portfolioWriteRequests || 0, 0);
  pass("market view shows no invented macro value without a provider response", "the global yield component remains an attributed daily Treasury series, not a quote fallback");

  await nav.getByRole("tab", { name: "觀察名單" }).click();
  await page.getByRole("heading", { name: "我的觀察名單", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "我的正式觀察名單", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "本機暫存觀察", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "觀察名單訊息候選", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "訊息摘要設定", exact: true }).waitFor({ state: "visible" });
  const notificationForm = page.locator("[data-notification-settings]");
  await notificationForm.locator('[name="enabled"]').check();
  await notificationForm.locator('[name="timeLocal"]').fill("09:15");
  await notificationForm.locator('[name="timezone"]').fill("Asia/Taipei");
  await notificationForm.getByRole("button", { name: "儲存本機設定" }).click();
  assert.equal(await page.locator("[data-notification-schedule]").getAttribute("data-notification-schedule"), "DAILY");
  assert.equal(await page.locator("[data-notification-digest]").count(), 1);
  assert.match(await page.locator("body").innerText(), /需要受控 server scheduler/);
  assert.match(await page.locator("body").innerText(), /尚無背景排程或寄送服務/);
  assert.equal(await page.locator('[data-notification-settings] input[type="password"], [data-notification-settings] input[name*="token" i]').count(), 0);
  assert.match(await page.locator("body").innerText(), /候選來源是依股票代號／名稱搜尋的 Provider 結果/);
  assert.match(await page.locator("body").innerText(), /Email／推播需要 AIOS 通知服務設定/);
  assert.match(await page.locator("body").innerText(), /請登入後讀取正式觀察名單/);
  assert.equal(await page.locator("[data-watchlist-id]").count(), 0);
  await save(page, "lab-watchlist-desktop-1440.png");
  pass("canonical watchlist separated from local temporary observations and notification delivery gates", "watchlist is owner-authenticated; settings/digest are a local preview and explicitly require a future server scheduler + delivery secret");

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
  pass("market scanner authorization boundary", "local anonymous preview does not call Production providers or display fixtures; signed-in Production acceptance remains a final release gate and does not block implementation");

  const researchChartPage = await context.newPage();
  watchPage(researchChartPage);
  await researchChartPage.goto(`${base}/labs/investment/test/fixtures/research-ohlcv-chart.html`, { waitUntil: "domcontentloaded" });
  await researchChartPage.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  const researchChart = researchChartPage.locator('.mini-market-chart[data-mode="research"]');
  assert.equal(await researchChart.getAttribute("data-chart-type"), "candlestick");
  assert.equal(await researchChart.getAttribute("data-bar-count"), "20");
  assert.equal(await researchChart.locator('[data-candle="true"]').count(), 20);
  assert.equal(await researchChart.locator('[data-volume-bar="true"]').count(), 20);
  assert.match(await researchChart.innerText(), /US\$|資料日期|Synthetic QA fixture/);
  await save(researchChartPage, "lab-research-ohlcv-desktop-1440.png");
  pass("research uses the shared OHLC candlestick and volume chart", "20 explicitly labeled QA fixture bars render through the shared research chart; no authenticated or market-data claim");
  await researchChartPage.close();

  const marketViewsPage = await context.newPage();
  watchPage(marketViewsPage);
  await marketViewsPage.goto(`${base}/labs/investment/test/fixtures/taiwan-market-views.html`, { waitUntil: "domcontentloaded" });
  await marketViewsPage.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  assert.equal(await marketViewsPage.locator(".scanner-table tbody tr").count(), 1);
  assert.equal(await marketViewsPage.locator(".scanner-card").count(), 0);
  const tdccObservation = marketViewsPage.locator(".tdcc-local-observation");
  assert.match(await tdccObservation.innerText(), /最高三個來源級距合計/);
  assert.match(await tdccObservation.innerText(), /42%/);
  assert.match(await tdccObservation.innerText(), /\+1\.5 個百分點/);
  assert.match(await marketViewsPage.locator("#tdcc").innerText(), /DEVELOPER QA fixture/);
  await marketViewsPage.getByRole("button", { name: "卡片" }).click();
  assert.equal(await marketViewsPage.locator(".scanner-card").count(), 1);
  assert.equal(await marketViewsPage.locator(".scanner-table").count(), 0);
  await marketViewsPage.locator('[data-action="sector-scan"][data-venue="TWSE"]').click();
  assert.match(await marketViewsPage.locator("#filter-result").innerText(), /"venue":"TWSE","industry":"QA 正向產業"/);
  assert.match(await marketViewsPage.locator("#filter-result").innerText(), /"offset":0/);
  await save(marketViewsPage, "lab-taiwan-market-components-desktop-1440.png");
  pass("Taiwan scanner, sector filter, and TDCC-local-observation components", "production components render explicitly synthetic fixture data; table/card switch, heatmap-to-scanner filter, and source-dated TDCC comparison operate without claiming live market readback");
  await marketViewsPage.close();

  const chipCyclePage = await context.newPage();
  watchPage(chipCyclePage);
  await chipCyclePage.goto(`${base}/labs/investment/test/fixtures/chip-cycle-observation.html`, { waitUntil: "domcontentloaded" });
  await chipCyclePage.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  const chipCycle = chipCyclePage.locator("[data-chip-cycle-status]");
  assert.equal(await chipCycle.getAttribute("data-chip-cycle-status"), "AVAILABLE");
  assert.match(await chipCycle.innerText(), /Markup 趨勢條件候選/);
  assert.match(await chipCycle.innerText(), /不是經典 Wyckoff 階段確認/);
  assert.match(await chipCycle.innerText(), /TDCC 多週級距/);
  await save(chipCyclePage, "lab-chip-cycle-desktop-1440.png");
  await chipCyclePage.setViewportSize({ width: 390, height: 844 });
  const chipMobile = await chipCyclePage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(chipMobile.scrollWidth <= chipMobile.width + 1, JSON.stringify(chipMobile));
  await save(chipCyclePage, "lab-chip-cycle-mobile-390x844.png");
  pass("chip-cycle observation desktop/mobile browser fixture", `${JSON.stringify(chipMobile)}; synthetic source rows are explicitly fixture-only and the renderer preserves the heuristic disclaimer`);
  await chipCyclePage.close();

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
  assert.deepEqual(await mobile.locator(".lab-content-nav .zhuge-functional-tab-label").allTextContents(), ["總覽", "選股雷達", "市場", "我的持股", "觀察名單", "個股研究", "籌碼", "技術分析", "策略回測", "平倉歷史"]);
  const targets = await mobileButtons.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
  assert.ok(targets.every((height) => height >= 44), JSON.stringify(targets));
  await mobileNav.getByRole("tab", { name: "市場" }).click();
  await mobile.getByRole("heading", { name: "市場 / Global Context", exact: true }).waitFor({ state: "visible" });
  await mobile.getByRole("heading", { name: "臺指期盤後情境", exact: true }).waitFor({ state: "visible" });
  await mobile.getByRole("heading", { name: "上市三大法人彙總", exact: true }).waitFor({ state: "visible" });
  await mobile.getByRole("heading", { name: "上櫃三大法人彙總", exact: true }).waitFor({ state: "visible" });
  await mobile.getByRole("heading", { name: "上市／上櫃融資融券餘額", exact: true }).waitFor({ state: "visible" });
  await mobile.locator(".us-treasury-context").waitFor({ state: "visible" });
  assert.match(await mobile.locator(".us-treasury-context").innerText(), /無可用資料/);
  const treasuryMobile = await mobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(treasuryMobile.scrollWidth <= treasuryMobile.width + 1, JSON.stringify(treasuryMobile));
  await save(mobile, "lab-global-context-mobile-390x844.png");
  await mobile.goto(`${base}/labs/investment/test/fixtures/us-treasury-context.html`, { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  const curveFixture = mobile.locator(".us-treasury-context");
  assert.match(await curveFixture.innerText(), /Synthetic QA fixture; not live Treasury/);
  const curveColumns = await mobile.locator(".treasury-yield-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns);
  assert.equal(curveColumns.trim().split(/\s+/).length, 2, curveColumns);
  assert.match(await curveFixture.innerText(), /10Y − 2Y/);
  await save(mobile, "lab-treasury-curve-mobile-390x844.png");
  await mobile.goto(`${base}/labs/investment/`, { waitUntil: "domcontentloaded" });
  await mobileNav.getByRole("tab", { name: "我的持股" }).waitFor({ state: "visible" });
  await mobileNav.getByRole("tab", { name: "觀察名單" }).click();
  await mobile.getByRole("heading", { name: "本機暫存觀察", exact: true }).waitFor({ state: "visible" });
  await mobileNav.getByRole("tab", { name: "平倉歷史" }).click();
  await mobile.getByRole("heading", { name: "我的平倉歷史", exact: true }).waitFor({ state: "visible" });
  const mobileLayout = await mobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.width + 1, JSON.stringify(mobileLayout));
  await save(mobile, "lab-investment-mobile-390x844.png");
  pass("Mobile Lab local navigation", `${JSON.stringify(mobileLayout)}; all 10 navigation touch targets are >=44px`);
  await mobile.goto(`${base}/labs/investment/test/fixtures/research-ohlcv-chart.html`, { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  const mobileChart = mobile.locator('.mini-market-chart[data-mode="research"]');
  assert.equal(await mobileChart.getAttribute("data-chart-type"), "candlestick");
  assert.equal(await mobileChart.locator('[data-candle="true"]').count(), 20);
  const mobileChartWidth = await mobile.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(mobileChartWidth.scrollWidth <= mobileChartWidth.width + 1, JSON.stringify(mobileChartWidth));
  await save(mobile, "lab-research-ohlcv-mobile-390x844.png");
  pass("research OHLCV chart remains readable on mobile", `${JSON.stringify(mobileChartWidth)}; shared chart renders the same OHLC evidence without horizontal page overflow`);
  await mobile.goto(`${base}/labs/investment/test/fixtures/taiwan-market-views.html`, { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
  assert.match(await mobile.locator(".tdcc-local-observation").innerText(), /\+1\.5 個百分點/);
  await mobile.getByRole("button", { name: "卡片" }).click();
  assert.equal(await mobile.locator(".scanner-card").count(), 1);
  await mobile.locator('[data-action="sector-scan"]').first().click();
  const marketMobileWidth = await mobile.evaluate(() => ({ width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, visualWidth: visualViewport?.width, viewportMeta: document.querySelector('meta[name="viewport"]')?.content, overflowers: [...document.querySelectorAll("body *")].map(element => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", width: Math.round(element.getBoundingClientRect().width), right: Math.round(element.getBoundingClientRect().right), scrollWidth: element.scrollWidth })).filter(item => item.right > document.documentElement.clientWidth + 1).slice(0, 12) }));
  assert.equal(mobile.viewportSize()?.width, 390, JSON.stringify({ ...marketMobileWidth, playwrightViewport: mobile.viewportSize() }));
  assert.equal(marketMobileWidth.width, 390, JSON.stringify({ ...marketMobileWidth, playwrightViewport: mobile.viewportSize() }));
  assert.ok(marketMobileWidth.scrollWidth <= marketMobileWidth.width + 1, JSON.stringify(marketMobileWidth));
  pass("Taiwan scanner/heatmap components remain operable on mobile", `${JSON.stringify(marketMobileWidth)}; synthetic QA fixture only`);
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
