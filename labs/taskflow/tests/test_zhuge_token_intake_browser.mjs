import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const intakeModule = await readFile(resolve(here, "../overrides/zhuge-token-intake-inline.ts"), "utf8");
const intakeInline = intakeModule.match(/String\.raw`([\s\S]*?)`;/)[1];
const validToken = "isolated-browser-intake-token";

// Minimal stand-in for the Multica shell: the intake runs first (mirroring the
// before-interactive layout injection), then the app's own boot reads storage
// and makes its first authenticated probe.
function appHtml() {
  return `<!doctype html><html><head><script>${intakeInline}</script></head><body><main id="app">boot</main><script>
    (async () => {
      const token = localStorage.getItem("multica_token");
      const response = await fetch("/api/me", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      document.body.dataset.authStatus = response.ok ? "authenticated" : "unauthenticated";
      document.getElementById("app").textContent = response.ok
        ? "TaskFlow Workspace"
        : "TaskFlow Login";
    })();
  </script></body></html>`;
}

async function withServer(t, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/workspace/issues" || url.pathname === "/other") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(appHtml());
      return;
    }
    if (url.pathname === "/api/me") {
      requests.push({ authorization: request.headers.authorization || "" });
      await new Promise((r) => setTimeout(r, 120));
      if (request.headers.authorization === `Bearer ${validToken}`) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "isolated-user" }));
      } else {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
  t.after(() => browser.close());
  await run({ server, browser, requests });
}

test("intake plants the fragment token before the app's first authenticated request, invisibly", async (t) => {
  await withServer(t, async ({ server, browser, requests }) => {
    const { port } = server.address();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/workspace/issues#zhuge_token=${validToken}`);
    await page.waitForFunction(() => document.body.dataset.authStatus === "authenticated");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, `Bearer ${validToken}`);
    // Fragment stripped: no credential in the visible URL after boot.
    assert.ok(!page.url().includes("zhuge_token"), page.url());
    assert.equal(page.url(), `http://127.0.0.1:${port}/workspace/issues`);
    // No intermediate page was shown: the same document booted the app.
    assert.equal(await page.locator("#app").innerText(), "TaskFlow Workspace");
    await page.close();
  });
});

test("intake without a fragment leaves the unauthenticated boot untouched", async (t) => {
  await withServer(t, async ({ server, browser, requests }) => {
    const { port } = server.address();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/workspace/issues`);
    await page.waitForFunction(() => document.body.dataset.authStatus === "unauthenticated");
    assert.equal(requests[0].authorization, "");
    assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), null);
    await page.close();
  });
});

test("intake rejects an oversize or empty token and never hangs blank", async (t) => {
  await withServer(t, async ({ server, browser }) => {
    const { port } = server.address();
    const page = await browser.newPage();
    const oversize = "x".repeat(16385);
    await page.goto(`http://127.0.0.1:${port}/workspace/issues#zhuge_token=${oversize}`);
    await page.waitForFunction(() => document.body.dataset.authStatus === "unauthenticated");
    assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), null);
    assert.ok(!page.url().includes("zhuge_token"), page.url());
    await page.goto(`http://127.0.0.1:${port}/workspace/issues#zhuge_token=`);
    await page.waitForFunction(() => document.body.dataset.authStatus === "unauthenticated");
    assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), null);
    assert.equal(await page.locator("#app").innerText(), "TaskFlow Login");
    await page.close();
  });
});

test("intake follows only same-origin zhuge_dest after planting", async (t) => {
  await withServer(t, async ({ server, browser, requests }) => {
    const { port } = server.address();
    const page = await browser.newPage();
    const dest = encodeURIComponent("/other");
    await page.goto(`http://127.0.0.1:${port}/workspace/issues#zhuge_token=${validToken}&zhuge_dest=${dest}`);
    await page.waitForFunction(() => document.body.dataset.authStatus === "authenticated");
    assert.equal(page.url(), `http://127.0.0.1:${port}/other`);
    assert.equal(requests[0].authorization, `Bearer ${validToken}`);
    // Cross-origin / protocol-relative / backslash destinations are dropped.
    for (const bad of ["https%3A%2F%2Fevil.example%2F", "%2F%2Fevil.example%2F", "%5C%5Cevil"]) {
      const p2 = await browser.newPage();
      await p2.goto(`http://127.0.0.1:${port}/workspace/issues#zhuge_token=${validToken}&zhuge_dest=${bad}`);
      await p2.waitForFunction(() => document.body.dataset.authStatus === "authenticated");
      assert.ok(p2.url().startsWith(`http://127.0.0.1:${port}/`), p2.url());
      await p2.close();
    }
    await page.close();
  });
});
