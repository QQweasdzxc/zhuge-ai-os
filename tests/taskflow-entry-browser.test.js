const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolveBrowserExecutable, fixtureURL } = require("./browser-executable");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("TaskFlow entry keeps attribution, responsive layout, and the Zhuge-to-TaskFlow handoff", async t => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, "A real Chromium executable is required");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(async () => browser.close());

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const apiOrigin = "https://taskflow-api.example";
    const webOrigin = "https://taskflow-web.example";
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };

    await page.route("**/labs/taskflow/runtime-config.js", route => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `window.ZhugeTaskFlowConfig = Object.freeze({apiUrl:${JSON.stringify(apiOrigin)},webUrl:${JSON.stringify(webOrigin)}});`
    }));
    await page.route(`${apiOrigin}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === "/readyz") return route.fulfill({ status: 200, headers: cors, body: "ok" });
      if (url.pathname === "/auth/zhuge") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ token: "isolated-taskflow-test-token" }) });
      if (url.pathname === "/api/workspaces") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify([{ slug: "alpha-1" }]) });
      return route.fulfill({ status: 404, headers: cors, body: "not found" });
    });
    await page.route(`${webOrigin}/zhuge-ready`, route => route.fulfill({ status: 200, headers: cors, body: "ok" }));
    await page.route(`${webOrigin}/zhuge-handoff**`, route => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>TaskFlow handoff received</title><main>TaskFlow handoff received</main>"
    }));

    await page.goto(await fixtureURL(path.join(ROOT, "labs/taskflow/index.html")), { waitUntil: "load" });
    assert.equal(await page.getByRole("heading", { name: "TaskFlow", exact: true }).isVisible(), true);
    assert.equal(await page.locator(".brand").innerText(), "Multica");
    assert.match(await page.locator(".attribution").innerText(), /Multica\. All rights reserved\./);
    assert.equal(await page.getByRole("button", { name: "直接進入 TaskFlow" }).isEnabled(), true);

    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      actionHeight: document.getElementById("enterTaskFlow").getBoundingClientRect().height
    }));
    assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    assert.ok(layout.actionHeight >= 44, JSON.stringify(layout));

    await page.evaluate(() => localStorage.setItem("zhuge_ai_os_google_auth_session_v1", JSON.stringify({ access_token: "test-zhuge-access-token" })));
    await page.getByRole("button", { name: "直接進入 TaskFlow" }).click();
    await page.waitForURL(url => url.hostname === "taskflow-web.example" && url.pathname === "/zhuge-handoff", { timeout: 10000 });
    const hash = new URL(page.url()).hash;
    assert.match(hash, /zhuge_token=isolated-taskflow-test-token/);
    assert.match(decodeURIComponent(hash), /zhuge_dest=\/alpha-1\/issues/);
    await page.close();
  }
});
