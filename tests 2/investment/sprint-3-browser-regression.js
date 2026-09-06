const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("../browser-executable");

(async () => {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  const fixture = path.join(__dirname, "browser-sprint-3-fixture.html");
  await page.goto(`file://${fixture}`);
  await page.waitForSelector("[data-investment-module-shell]");

  assert.equal(await page.locator(".investment-command-center").count(), 1);
  assert.equal(await page.locator(".investment-page-heading h1").textContent(), "投資首頁");
  assert.equal(await page.getByText("投資核心 KPI").count(), 1);
  assert.equal(await page.getByText(/Shared Session|Security Gate|Mock Data|Module Version|UUID/).count(), 0);
  assert.equal(errors.length, 0, errors.join("\n"));

  const baseUrl = String(process.env.ZHUGE_TEST_BASE_URL || "").replace(/\/$/, "");
  if (baseUrl) {
    const anonymous = await browser.newPage();
    const anonymousErrors = [];
    anonymous.on("console", message => { if (message.type() === "error") anonymousErrors.push(message.text()); });
    anonymous.on("pageerror", error => anonymousErrors.push(error.message));
    await anonymous.goto(`${baseUrl}/modules/investment/`);
    await anonymous.waitForSelector(".investment-access-screen h1");
    assert.equal(await anonymous.locator(".investment-access-screen h1").textContent(), "請先登入");
    assert.equal(anonymousErrors.length, 0, anonymousErrors.join("\n"));

    const runtime = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const runtimeErrors = [];
    runtime.on("console", message => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    runtime.on("pageerror", error => runtimeErrors.push(error.message));
    await runtime.addInitScript(({ userId, expiresAt }) => {
      const session = { user_uuid: userId, email: "pm@example.test", name: "PM 驗收者", provider: "google-oauth", access_token: "browser-test-token", refresh_token: "browser-test-refresh", expires_at: expiresAt, aal: "aal2" };
      localStorage.setItem("zhuge_ai_os_session_v1", JSON.stringify(session));
      localStorage.setItem("zhuge_ai_os_google_auth_session_v1", JSON.stringify(session));
      sessionStorage.setItem(`zhuge_module_unlock_v1:investment:${userId}`, JSON.stringify({ userId, expiresAt }));
    }, { userId: "550e8400-e29b-41d4-a716-446655440000", expiresAt: Date.now() + 60 * 60 * 1000 });
    const cloudRows = {
      app_users: [{ id: "legacy-owner-1", display_name: "PM 驗收者", email: "pm@example.test" }],
      portfolios: [{ id: "portfolio-1", user_id: "legacy-owner-1", name: "主要投資組合", base_currency: "TWD", is_default: true }],
      opening_positions: [
        { id: "tw-1", user_id: "legacy-owner-1", portfolio_id: "portfolio-1", symbol: "2330", name: "台積電", market: "TW", quantity: 10, avg_cost: 900, invested_cost: 9000, last_price: 950, market_value: 9500, unrealized_pnl: 500, currency: "TWD" },
        { id: "us-1", user_id: "legacy-owner-1", portfolio_id: "portfolio-1", symbol: "MSFT", name: "Microsoft", market: "US", quantity: 2, avg_cost: 400, invested_cost: 800, last_price: 420, market_value: 840, unrealized_pnl: 40, currency: "USD" }
      ],
      transactions: [], watchlists: [], strategies: [], decision_logs: [], user_settings: []
    };
    await runtime.route("**/rest/v1/**", async route => {
      const table = new URL(route.request().url()).pathname.split("/").pop();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudRows[table] || []) });
    });
    await runtime.goto(`${baseUrl}/modules/investment/`);
    await runtime.waitForSelector("[data-investment-module-shell]");
    assert.equal(await runtime.locator(".investment-page-heading h1").textContent(), "投資首頁");
    assert.equal(await runtime.locator(".investment-position-card").count(), 2);
    assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
    await runtime.screenshot({ path: path.join(__dirname, "..", "evidence", "investment-sprint-3-overview.png"), fullPage: true });
  } else {
    await page.screenshot({ path: path.join(__dirname, "..", "evidence", "investment-sprint-3-overview.png"), fullPage: true });
  }
  await browser.close();
  console.log("Investment Sprint 3 browser regression: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
