"use strict";
// Isolated-origin gesture verification for the drag-vs-click guard on the
// pixel-office-3d 2D canvas. Local fixture server only (every non-loopback
// request is aborted): no production origin, no real token, no auth of any
// kind. Scene people come from the page's own device-local roster feature
// (localStorage zhuge.office.members), seeded with fixture names.
// Live-site post-deploy smoke is reported separately and not claimed here.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable, fixtureURL } = require("./browser-executable");
const ROOT = path.resolve(__dirname, "..");
const PAGE = path.join(ROOT, "labs/pixel-office-3d/index.html");

async function boot(width, { touch = false } = {}) {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch });
  const page = await context.newPage();
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  // Feed one fixture snapshot through the page's own same-origin `events`
  // channel so the scene has people without any external service.
  const feed = { sessions: [
    { key: "fx-1", agent: "codex", project: "Fixture A", status: "thinking", startedAt: Date.now() - 60000, lastEventAt: Date.now() },
    { key: "fx-2", agent: "gemini", project: "Fixture B", status: "thinking", startedAt: Date.now() - 60000, lastEventAt: Date.now() },
  ] };
  await page.route("**/events", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    body: `data: ${JSON.stringify(feed)}\n\n`,
  }));
  await page.addInitScript(() => {
    try { localStorage.setItem("zhuge.office.members", JSON.stringify(["測試甲", "測試乙"])); } catch {}
  });
  await page.goto(await fixtureURL(PAGE));
  // Force the 2D renderer (the guard lives in office.js; 3D has its own controls).
  await page.locator('#qualSeg button[data-v="mid"]').click();
  await page.waitForTimeout(2500);
  const canvas = page.locator("canvas").last();
  await canvas.waitFor();
  return { browser, page, canvas };
}

// Probe the live canvas for a point whose hover cursor is "pointer" (= a
// person hit box). Dispatches real mousemove so the page's own handler runs.
async function probePerson(page, canvas) {
  const box = await canvas.boundingBox();
  assert.ok(box);
  return await page.evaluate(async (box) => {
    const cv = [...document.querySelectorAll("canvas")].filter(c => c.getBoundingClientRect().width > 100).pop();
    const hits = [];
    for (let gx = 0; gx < 30; gx++) for (let gy = 0; gy < 40; gy++) {
      const x = box.x + box.width * (gx + 0.5) / 30, y = box.y + box.height * (gy + 0.5) / 40;
      cv.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      if (cv.style.cursor === "pointer") hits.push([x, y]);
    }
    if (!hits.length) return null;
    // Aim at the centroid of the cluster around the first hit (people wander;
    // an edge point or a multi-person average can miss by click time).
    const first = hits[0];
    const cluster = hits.filter(h => Math.hypot(h[0] - first[0], h[1] - first[1]) < 60);
    const cx = cluster.reduce((a, h) => a + h[0], 0) / cluster.length;
    const cy = cluster.reduce((a, h) => a + h[1], 0) / cluster.length;
    // Return the probed hit closest to the centroid (an actual pointer point).
    let best = cluster[0], bd = 1e9;
    for (const h of cluster) { const d = Math.hypot(h[0] - cx, h[1] - cy); if (d < bd) { bd = d; best = h; } }
    return { x: Math.round(best[0]), y: Math.round(best[1]) };
  }, box);
}

// People wander (~67px/s); a click aimed at a fresh probe can still miss.
// The guard assertions are about open/no-open, so retry the AIM up to 3x.
async function clickPerson(page, canvas, useTouch) {
  for (let a = 0; a < 3; a++) {
    const p = await waitPerson(page, canvas);
    if (!p) continue;
    if (useTouch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    const d = await detailOpen(page, 1500);
    if (d.open) return d;
  }
  return await detailOpen(page, 1);
}

async function waitPerson(page, canvas, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const p = await probePerson(page, canvas);
    if (p) return p;
    await page.waitForTimeout(250);
  }
  return null;
}

// openDetail flips the inert flags synchronously; the slide-in class lands on
// a later animation frame and is not the signal. Poll the inert state.
async function detailOpen(page, timeout = 3000) {
  try {
    await page.waitForFunction(() => document.getElementById("sideDetail").inert === false, null, { timeout });
  } catch {}
  return page.evaluate(() => ({
    open: document.getElementById("sideDetail").inert === false,
    title: (document.getElementById("detailTitle") || {}).textContent || "",
  }));
}
// At <=760px the open side panel overlays the whole canvas, so gestures must
// also hide the panel (not just close the detail) before the next step.
const closeDetail = async (page, narrow) => {
  const b = await page.$("#sideBack"); if (b) await b.click();
  if (narrow) { const h = await page.$("#sideHide"); if (h) await h.click(); }
  await page.waitForTimeout(300);
};

for (const width of [1440, 390]) test(`drag never opens detail; click still does (${width}px)`, async (t) => {
  const { browser, page, canvas } = await boot(width, { touch: width === 390 });
  t.after(() => browser.close());

  // 1. Normal click/tap on a person opens the detail panel.
  let p = await waitPerson(page, canvas);
  assert.ok(p, "a person hit box must exist in the scene");
  let d = await clickPerson(page, canvas, width === 390);
  assert.ok(d.open && d.title, `click must open detail, got ${JSON.stringify(d)}`);
  await closeDetail(page, width === 390);

  // 2. Drag that RELEASES on a person must not open detail.
  p = await waitPerson(page, canvas);
  assert.ok(p);
  if (width === 390) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x - 60, y: p.y, id: 1 }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x - 60 + i * 10, y: p.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(p.x - 60, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  d = await detailOpen(page, 800);
  assert.ok(!d.open, `drag ending on a person must not open detail, got ${JSON.stringify(d)}`);

  // 3. Drag out and back to the exact start point must not open detail.
  p = await waitPerson(page, canvas);
  assert.ok(p);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 80, p.y + 30, { steps: 8 });
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  d = await detailOpen(page, 800);
  assert.ok(!d.open, `drag out-and-back must not open detail, got ${JSON.stringify(d)}`);

  // 4. A normal click right after a suppressed drag still opens (no pollution).
  p = await waitPerson(page, canvas);
  assert.ok(p);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  d = await detailOpen(page);
  assert.ok(d.open && d.title, `click after suppressed drag must open, got ${JSON.stringify(d)}`);
  await closeDetail(page, width === 390);
});
