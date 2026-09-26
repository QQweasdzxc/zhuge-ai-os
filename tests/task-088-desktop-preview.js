const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

(async () => {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  const fixture = path.join(__dirname, "task-088-desktop-preview.html");
  await page.goto(`file://${fixture}`, { waitUntil: "load" });
  for (const id of ["p3", "p4", "p5", "p6"]) {
    const scene = page.locator(`#${id}`);
    await scene.waitFor({ state: "visible" });
    assert.ok(await scene.boundingBox(), `${id} preview must have a visible layout`);
    await scene.screenshot({
      path: path.join(__dirname, "evidence", `task-088-${id}-desktop-source-preview.png`),
      animations: "disabled"
    });
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  await browser.close();
  console.log("TASK-088 P3-P6 desktop source previews: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
