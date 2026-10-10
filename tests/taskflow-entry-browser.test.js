const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const path = require("node:path");
const { resolveBrowserExecutable, fixtureURL } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");
const AIOS_LOGIN = "https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=dashboard";
const TEST_SESSION_TOKEN = "isolated-test-session-token";
const TEST_TASKFLOW_TOKEN = "isolated-taskflow-jwt";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

async function launch(t) {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, "CI Chromium is required for TaskFlow browser regression");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(async () => browser.close());
  return browser;
}

async function configureEntry(page, apiOrigin, webOrigin, { authStatus = 200 } = {}) {
  let capturedAuthRequest = null;
  await page.route("**/labs/taskflow/runtime-config.js**", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: "window.ZhugeTaskFlowConfig=Object.freeze({apiUrl:" + JSON.stringify(apiOrigin) + ",webUrl:" + JSON.stringify(webOrigin) + "});"
  }));
  await page.route(apiOrigin + "/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/readyz") return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ status: "ok" }) });
    if (url.pathname === "/auth/zhuge") {
      capturedAuthRequest = { url: request.url(), body: request.postData() || "" };
      if (authStatus !== 200) return route.fulfill({ status: authStatus, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ error: "invalid session" }) });
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ token: TEST_TASKFLOW_TOKEN }) });
    }
    if (url.pathname === "/api/workspaces") {
      assert.equal(request.headers()["authorization"], "Bearer " + TEST_TASKFLOW_TOKEN);
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify([{ slug: "pm-workspace" }]) });
    }
    return route.fulfill({ status: 404, headers: cors, body: "not found" });
  });
  await page.route(webOrigin + "/zhuge-ready", route => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ status: "ok" }) }));
  await page.route(webOrigin + "/zhuge-handoff**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Multica handoff</title><main>Multica handoff</main>"
  }));
  await page.route(url => url.href.startsWith(AIOS_LOGIN), route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Zhuge Login</title><main>Zhuge Login</main>"
  }));
  return () => capturedAuthRequest;
}

test("TaskFlow entry hands Zhuge session to API and opens the Multica handoff on desktop and mobile", async t => {
  const browser = await launch(t);
  const entry = await fixtureURL(path.join(ROOT, "labs/taskflow/index.html"));
  const entryOrigin = new URL(entry).origin;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const readCaptured = await configureEntry(page, "https://taskflow-api.example", "https://taskflow-web.example");
    await page.addInitScript(({ origin }) => {
      if (location.origin === origin) localStorage.setItem("zhuge_ai_os_google_auth_session_v1", JSON.stringify({ access_token: "isolated-test-session-token" }));
    }, { origin: entryOrigin });
    await page.goto(entry + "?source=work-navigation", { waitUntil: "load" });
    assert.equal(await page.getByRole("heading", { name: "TaskFlow", exact: true }).isVisible(), true);
    assert.equal(await page.locator(".brand").innerText(), "Multica");
    assert.match(await page.locator(".attribution").innerText(), /Multica\. All rights reserved\./);
    assert.equal(await page.locator("#enterTaskFlow").isDisabled(), true);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      actionHeight: document.getElementById("enterTaskFlow").getBoundingClientRect().height
    }));
    assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    assert.ok(layout.actionHeight >= 44, JSON.stringify(layout));
    assert.equal(await page.locator(".secondary").getAttribute("href"), AIOS_LOGIN);
    await page.waitForURL(url => url.hostname === "taskflow-web.example" && url.pathname === "/zhuge-handoff", { timeout: 10000 });
    const handoffUrl = new URL(page.url());
    assert.equal(handoffUrl.search, "");
    assert.match(handoffUrl.hash, /zhuge_token=isolated-taskflow-jwt/);
    assert.match(decodeURIComponent(handoffUrl.hash), /zhuge_dest=\/pm-workspace\/issues/);
    const authRequest = readCaptured();
    assert.ok(authRequest);
    assert.equal(new URL(authRequest.url).search, "");
    assert.deepEqual(JSON.parse(authRequest.body), { access_token: TEST_SESSION_TOKEN });
    await page.close();
  }
});

test("unauthenticated TaskFlow entry returns to official Zhuge Login on desktop and mobile", async t => {
  const browser = await launch(t);
  const entry = await fixtureURL(path.join(ROOT, "labs/taskflow/index.html"));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.route("**/labs/taskflow/runtime-config.js**", route => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "window.ZhugeTaskFlowConfig=Object.freeze({apiUrl:\"https://taskflow-api.example\",webUrl:\"https://taskflow-web.example\"});"
    }));
    let apiCalls = 0;
    await page.route("https://taskflow-api.example/**", async route => {
      apiCalls += 1;
      return route.fulfill({ status: 200, headers: cors, body: "{}" });
    });
    await page.route(url => url.href.startsWith(AIOS_LOGIN), route => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Zhuge Login</title>"
    }));
    await page.goto(entry, { waitUntil: "load" });
    await page.waitForURL(url => url.hostname === "qqweasdzxc.github.io" && url.pathname === "/zhuge-ai-os/modules/worklog/", { timeout: 10000 });
    const loginUrl = new URL(page.url());
    assert.equal(loginUrl.searchParams.get("app"), "1");
    assert.equal(loginUrl.searchParams.get("workspace"), "dashboard");
    assert.equal(loginUrl.hash, "");
    assert.equal(apiCalls, 0, "no session must never be sent to TaskFlow");
    await page.close();
  }
});

test("expired Zhuge session is rejected by TaskFlow API and returned to Zhuge Login", async t => {
  const browser = await launch(t);
  const entry = await fixtureURL(path.join(ROOT, "labs/taskflow/index.html"));
  const entryOrigin = new URL(entry).origin;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const readCaptured = await configureEntry(page, "https://taskflow-api.example", "https://taskflow-web.example", { authStatus: 401 });
  await page.addInitScript(({ origin }) => {
    if (location.origin === origin) localStorage.setItem("zhuge_ai_os_session_v1", JSON.stringify({ access_token: "expired-test-session-token" }));
  }, { origin: entryOrigin });
  await page.goto(entry, { waitUntil: "load" });
  await page.waitForURL(url => url.hostname === "qqweasdzxc.github.io" && url.pathname === "/zhuge-ai-os/modules/worklog/", { timeout: 10000 });
  const authRequest = readCaptured();
  assert.ok(authRequest);
  assert.equal(new URL(authRequest.url).search, "");
  assert.equal(JSON.parse(authRequest.body).access_token, "expired-test-session-token");
  const loginUrl = new URL(page.url());
  assert.equal(loginUrl.search, "?app=1&workspace=dashboard");
  assert.equal(loginUrl.hash, "");
  await page.close();
});
