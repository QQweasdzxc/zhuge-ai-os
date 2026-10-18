"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../labs/pixel-office-p3-preview");
const OUT = process.env.P3_SCREENSHOT_DIR || path.resolve("/workspace/artifacts/p3-personnel-qa");
const CASES = [
  { name: "phone-portrait", width: 390, height: 844, mobile: true },
  { name: "phone-landscape", width: 844, height: 390, mobile: true },
  { name: "desktop-landscape", width: 1440, height: 900, mobile: false },
  { name: "desktop-narrow-portrait", width: 900, height: 1200, mobile: false }
];
const PEOPLE = ["PM", "Co", "Gem", "GPT", "Betty", "安安", "卡卡"];

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/favicon.ico") { res.writeHead(204).end(); return; }
    const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) {
      res.writeHead(403).end("forbidden"); return;
    }
    fs.readFile(target, (error, body) => {
      if (error) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": mime(target), "cache-control": "no-store" });
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const report = [];
  try {
    for (const scenario of CASES) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: 1 });
      await context.grantPermissions([]).catch(() => {});
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      // This browser run verifies the UI's explicit offline fallback. Public
      // GitHub API behavior is covered by the adapter tests; the desktop QA
      // tunnel cannot reach api.github.com reliably and must not hang the run.
      await page.route("https://api.github.com/**", route => route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "isolated browser egress unavailable" })
      }));
      const externalHosts = new Set();
      const forbiddenRequests = [];
      const externalRequestFailures = [];
      page.on("request", request => {
        const url = request.url();
        try {
          const host = new URL(url).hostname;
          if (host !== "127.0.0.1" && host !== "localhost") externalHosts.add(host);
          if (/taskflow|supabase|render\.com/i.test(url)) forbiddenRequests.push(url);
        } catch {}
      });
      page.on("requestfailed", request => {
        try {
          const url = new URL(request.url());
          if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") externalRequestFailures.push({ host: url.hostname, error: request.failure()?.errorText || "failed" });
          else failures.push(`${scenario.name} local request failed: ${url.pathname} ${request.failure()?.errorText || "failed"}`);
        } catch {}
      });
      page.on("pageerror", error => failures.push(`${scenario.name} pageerror: ${error.message}`));
      page.on("console", message => {
        if (message.type() !== "error") return;
        const text = message.text();
        const sourceUrl = message.location()?.url || "";
        if (sourceUrl.startsWith("https://api.github.com/")
          && /^Failed to load resource: the server responded with a status of 503/.test(text)) return;
        // Chromium reports blocked remote fetches as resource-console errors too;
        // those are recorded separately and must not turn the unknown-state fallback into a UI failure.
        if (!/^Failed to load resource: net::ERR_(TUNNEL_CONNECTION_FAILED|CONNECTION_RESET|CONNECTION_REFUSED|TIMED_OUT)$/.test(text)) failures.push(`${scenario.name} console: ${text}`);
      });
      const response = await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
      assert.equal(response.status(), 200, `${scenario.name}: preview loads`);
      await page.waitForFunction(() => document.querySelectorAll("#personnel-list .personnel-person").length === 7, null, { timeout: 10000 });
      await page.waitForFunction(() => {
        const text = document.querySelector("#personnel-source")?.textContent || "";
        return text.includes("Handoff：最新唯讀資料") || text.includes("Handoff：紀錄已過期") || text.includes("Handoff：沒有有效紀錄") || text.includes("Handoff：目前無法讀取");
      }, null, { timeout: 5000 });
      await page.waitForTimeout(100);

      const base = await page.evaluate(() => ({
        names: [...document.querySelectorAll("#personnel-list .personnel-person strong")].map(node => node.textContent.trim()),
        sceneWidth: document.querySelector(".office-section").getBoundingClientRect().width,
        sceneHeight: document.querySelector(".office-section").getBoundingClientRect().height,
        pageWidth: document.documentElement.scrollWidth,
        visualSprites: [...document.querySelectorAll(".agent[data-person-id]")].every(node => node.querySelector(".person-sprite")),
        residentKinds: [...document.querySelectorAll(".agent.resident[data-person-id]")].map(node => node.dataset.personId),
        sourceStatusText: document.querySelector("#personnel-source").textContent.trim(),
        timelineCount: document.querySelectorAll("#personnel-events .personnel-event").length,
        coState: document.querySelector('#personnel-list [data-role-id="co"] .personnel-state').textContent.trim()
      }));
      assert.deepEqual(base.names, PEOPLE, `${scenario.name}: all seven roles appear in roster`);
      assert.ok(base.sceneWidth > 0 && base.sceneHeight > 0, `${scenario.name}: office scene remains visible`);
      assert.ok(base.visualSprites, `${scenario.name}: all seven sprites render`);
      assert.deepEqual(base.residentKinds.sort(), ["anan", "betty", "kaka"], `${scenario.name}: residents remain separate characters`);
      assert.match(base.sourceStatusText, /TaskFlow：尚未連線/, `${scenario.name}: UI discloses TaskFlow is not connected`);
      assert.match(base.sourceStatusText, /Handoff：/, `${scenario.name}: handoff source state and freshness are disclosed`);
      assert.match(base.sourceStatusText, /GitHub：(靜態快照|最新唯讀資料|部分唯讀資料)/, `${scenario.name}: verified GitHub source or explicit snapshot is visible`);
      assert.ok(base.timelineCount >= 2, `${scenario.name}: confirmed Co/Gem handoff events appear in the timeline`);
      assert.match(base.coState, /尚無可驗證的最新狀態|工作中 · /, `${scenario.name}: Co state is current evidence or honestly unknown`);
      assert.ok(base.pageWidth <= scenario.width + 2, `${scenario.name}: no page-level horizontal overflow (${base.pageWidth}px)`);
      if (!scenario.mobile) assert.ok(base.sceneWidth >= scenario.width * 0.48, `${scenario.name}: side panel does not shrink office scene excessively`);

      const toggle = page.locator("#personnel-toggle");
      if (scenario.mobile) {
        assert.equal(await page.locator("#personnel-panel").isVisible(), false, `${scenario.name}: mobile panel starts collapsed`);
        await toggle.click();
      } else {
        assert.equal(await page.locator("#personnel-panel").isVisible(), true, `${scenario.name}: desktop panel starts open`);
      }
      assert.equal(await page.locator("#personnel-panel").isVisible(), true, `${scenario.name}: panel opens`);
      await page.screenshot({ path: path.join(OUT, `${scenario.name}-panel.png`), fullPage: true });

      await page.locator('#personnel-list .personnel-person[data-role-id="co"]').click();
      await page.waitForFunction(() => {
        const profile = document.querySelector("#personnel-detail");
        return profile && !profile.hidden && profile.dataset.roleId === "co";
      });
      const coProfile = await page.locator("#personnel-detail").innerText();
      assert.match(coProfile, /最近已驗證事件/);
      assert.match(coProfile, /來源：/);
      if (base.sourceStatusText.includes("Handoff：最新唯讀資料")) assert.match(coProfile, /工作中 · /);
      assert.ok(/尚無可驗證的最新狀態|工作中 · |P3 GPT／Betty／安安／卡卡/.test(coProfile), `${scenario.name}: status is sourced or honestly unknown`);

      for (const [id, name] of [["betty", "Betty"], ["anan", "安安"], ["kaka", "卡卡"]]) {
        await page.locator(`#personnel-list .personnel-person[data-role-id="${id}"]`).click();
        const profile = await page.locator("#personnel-detail").innerText();
        assert.ok(profile.includes(name), `${scenario.name}: ${name} details link to the selected person`);
        assert.match(profile, /虛擬活動 · 非真人追蹤/);
        assert.doesNotMatch(profile, /TaskFlow 任務|工程工作狀態/);
        assert.match(await page.locator(`#personnel-list .personnel-person[data-role-id="${id}"] .personnel-meta`).innerText(), /來源：角色設定（虛擬展示）.*更新：非即時事件資料/);
      }
      await page.locator("#personnel-collapse").click();
      assert.equal(await page.locator("#personnel-panel").isVisible(), false, `${scenario.name}: panel collapses`);

      const disallowed = forbiddenRequests.map(url => new URL(url).hostname);
      assert.deepEqual(disallowed, [], `${scenario.name}: no TaskFlow/Supabase/Render calls`);
      report.push({ ...scenario, ...base, externalHosts: [...externalHosts], externalRequestFailures });
      await context.close();
    }
    assert.deepEqual(failures, [], failures.join("\n"));
    fs.writeFileSync(path.join(OUT, "browser-report.json"), JSON.stringify({ createdAt: new Date().toISOString(), cases: report, consoleOrPageErrors: failures }, null, 2));
    console.log(`P3 personnel browser QA PASS: ${report.length} Chromium viewports; screenshots: ${OUT}`);
    for (const item of report) console.log(`${item.name} ${item.width}x${item.height} scene=${Math.round(item.sceneWidth)}x${Math.round(item.sceneHeight)} sources=${item.externalHosts.join(",") || "none"}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
