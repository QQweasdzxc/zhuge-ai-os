const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("../browser-executable");

(async () => {
  const executablePath = process.env.ZHUGE_TEST_BROWSER_EXECUTABLE || resolveBrowserExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  const fixture = path.join(__dirname, "screenshot-import-browser-fixture.html");

  await page.goto(`file://${fixture}`);
  await page.waitForSelector("[data-investment-import-page]");
  assert.equal(await page.locator("[data-investment-import-result]").count(), 0);
  await page.getByRole("button", { name: "測試用合成圖片" }).click();
  await page.getByRole("button", { name: "開始辨識" }).click();
  await page.waitForSelector("[data-investment-import-result]");
  assert.equal(await page.locator("[data-investment-import-result]").count(), 1);
  assert.equal(await page.locator(".investment-import-result.is-unchanged").count(), 1);
  assert.equal(await page.getByText("信心度 HIGH").count(), 1);
  assert.equal(await page.getByText("Cloud 持倉與截圖差異").count(), 1);
  assert.equal(await page.locator(".investment-import-scope").count(), 1);

  const quantity = page.locator('[data-investment-import-edit] input[name="quantity"]');
  await quantity.fill("11");
  await page.getByRole("button", { name: "保存預覽" }).click();
  await page.waitForSelector(".investment-import-result.is-changed");
  assert.equal(await page.locator(".investment-import-result.is-changed").count(), 1);
  assert.equal(await page.getByText("數量：Cloud 10／截圖 11").count(), 1);

  await page.getByRole("button", { name: "忽略此列" }).click();
  assert.equal(await page.locator(".investment-import-result.is-unknown").count(), 1);
  await page.getByRole("button", { name: "還原辨識結果" }).click();
  assert.equal(await page.locator(".investment-import-result.is-unchanged").count(), 1);
  assert.equal(await page.getByText("數量：Cloud 10／截圖 11").count(), 0);
  await page.getByRole("button", { name: "確認預覽" }).click();
  await page.waitForSelector(".investment-import-confirmed");
  assert.equal(await page.locator(".investment-import-confirmed").count(), 1);
  assert.match(await page.locator(".investment-import-confirmed").innerText(), /受控 Snapshot RPC|不會直接修改/);
  await page.waitForSelector(".investment-import-write-panel");
  assert.equal(await page.locator(".investment-import-write-panel").count(), 1);
  assert.equal(await page.getByRole("button", { name: "確認並寫入 1 筆 Snapshot" }).count(), 1);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({ path: path.join(__dirname, "..", "evidence", "investment-screenshot-import-runtime.png"), fullPage: true });
  await browser.close();
  console.log("Investment Screenshot Import browser regression: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
