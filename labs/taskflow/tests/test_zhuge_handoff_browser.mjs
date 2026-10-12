import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const handoffHtml = await readFile(resolve(here, "../overrides/zhuge-handoff.html"), "utf8");
const validToken = "isolated-browser-test-token";

function workspaceHtml() {
  return `<!doctype html><html><body><main id="workspace">Workspace loading</main><script>
    (async () => {
      const token = localStorage.getItem("multica_token");
      const response = await fetch("/api/me", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      document.body.dataset.authStatus = response.ok ? "authenticated" : "rejected";
      document.getElementById("workspace").textContent = response.ok
        ? "TaskFlow Workspace"
        : "TaskFlow Login Required";
      if (response.status === 401) localStorage.removeItem("multica_token");
    })();
  </script></body></html>`;
}

test("browser handoff persists Zhuge token before the first authenticated app request", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/zhuge-handoff.html") {
      // Delayed document delivery models a slower desktop/mobile connection.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(handoffHtml);
      return;
    }
    if (url.pathname === "/workspace/issues") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(workspaceHtml());
      return;
    }
    if (url.pathname === "/api/me") {
      const authorization = request.headers.authorization || "";
      requests.push({ path: url.pathname, authorization });
      // The delayed response also exercises slow API completion after handoff.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
      if (authorization === `Bearer ${validToken}`) {
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

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  const hash = new URLSearchParams({
    zhuge_token: validToken,
    zhuge_dest: "/workspace/issues",
  }).toString();
  await page.goto(`${origin}/zhuge-handoff.html#${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.authStatus === "authenticated");

  assert.equal(new URL(page.url()).pathname, "/workspace/issues");
  assert.equal(new URL(page.url()).hash, "", "credential fragment must not remain in the final URL");
  assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), validToken);
  assert.deepEqual(requests, [{ path: "/api/me", authorization: `Bearer ${validToken}` }]);
});

test("expired token remains rejected and is removed after a real browser 401", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/workspace/issues") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(workspaceHtml());
      return;
    }
    if (url.pathname === "/api/me") {
      requests.push(request.headers.authorization || "");
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  t.after(() => browser.close());

  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("multica_token", "expired-test-token"));
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/workspace/issues`);
  await page.waitForFunction(() => document.body.dataset.authStatus === "rejected");

  assert.deepEqual(requests, ["Bearer expired-test-token"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), null);
});

test("rejected handoffs clear the fragment before validation and never persist the token", async (t) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/zhuge-handoff.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(handoffHtml);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  const cases = [
    {
      name: "valid token with cross-origin destination",
      hash: new URLSearchParams({
        zhuge_token: validToken,
        zhuge_dest: "https://attacker.example/steal",
      }).toString(),
    },
    {
      name: "empty token",
      hash: new URLSearchParams({
        zhuge_token: "",
        zhuge_dest: "/workspace/issues",
      }).toString(),
    },
  ];

  for (const [index, entry] of cases.entries()) {
    await page.goto(`http://127.0.0.1:${address.port}/zhuge-handoff.html?case=${index}#${entry.hash}`);
    await page.waitForFunction(() => document.documentElement.dataset.handoffState === "rejected");
    assert.equal(new URL(page.url()).hash, "", `${entry.name}: fragment must be removed`);
    assert.equal(await page.evaluate(() => localStorage.getItem("multica_token")), null, `${entry.name}: token must not be stored`);
  }
});
