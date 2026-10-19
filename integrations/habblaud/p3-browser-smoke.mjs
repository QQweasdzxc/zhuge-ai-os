#!/usr/bin/env node
/** Browser smoke for the P3 shell embedded around the pinned native Habblaud Canvas. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const site = path.resolve(process.argv[2] || '');
const upstream = path.resolve(process.argv[3] || '');
const output = path.resolve(process.env.P3_SCREENSHOT_DIR || '/tmp/p3-native-screenshots');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: p3-browser-smoke.mjs <pages-artifact> <pinned-habblaud-checkout>');
const { chromium } = await import(pathToFileURL(path.join(upstream, 'node_modules/playwright-core/index.mjs')).href);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404).end('P3_NO_TASKFLOW_OR_CLI_API'); return; }
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(site, `.${requested}`);
  if (!file.startsWith(`${site}${path.sep}`)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const cases = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080, desktop: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, desktop: true },
  { name: 'desktop-narrow-900x1200', width: 900, height: 1200, desktop: true },
  { name: 'mobile-390x844', width: 390, height: 844, desktop: false },
  { name: 'mobile-844x390', width: 844, height: 390, desktop: false },
];
const names = ['PM', 'Co', 'Gem', 'GPT', 'Betty', '安安', '卡卡'];
const preservedLinks = {
  TaskFlow: 'https://zhuge-taskflow-web.onrender.com/',
  WorkLog: 'https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=worklog',
  Investment: 'https://qqweasdzxc.github.io/zhuge-ai-os/labs/investment/',
  Lab: 'https://qqweasdzxc.github.io/zhuge-ai-os/labs/',
  Classic: 'https://qqweasdzxc.github.io/zhuge-ai-os/app/Board/ai/',
};
const executablePath = process.env.P3_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
const failures = [];
const results = [];
try {
  fs.mkdirSync(output, { recursive: true });
  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: 1, locale: 'zh-TW' });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
    const forbidden = [];
    const failedLocal = [];
    const externalHosts = new Set();
    page.on('request', request => {
      const url = request.url();
      try {
        const host = new URL(url).hostname;
        if (host !== '127.0.0.1' && host !== 'localhost') externalHosts.add(host);
        if (/taskflow|supabase|render\.com/i.test(url)) forbidden.push(url);
      } catch { /* ignore non-URL browser requests */ }
    });
    page.on('requestfailed', request => {
      try {
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') failedLocal.push(`${url.pathname}: ${request.failure()?.errorText || 'failed'}`);
      } catch { /* ignore */ }
    });
    page.on('pageerror', error => failures.push(`${scenario.name}: ${error.message}`));
    const response = await page.goto(`${base}/labs/pixel-office-p3-preview/`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200, `${scenario.name}: P3 route loads`);
    const shell = page.frameLocator('#p3-shell');
    const scene = shell.frameLocator('#p3-native-scene');
    const links = await shell.locator('.p3-shell__nav-link').evaluateAll(items => Object.fromEntries(items.map(item => [item.textContent.trim().split(/\s+/).at(-1), { href: item.href, target: item.target, rel: item.rel }])));
    for (const [name, href] of Object.entries(preservedLinks)) {
      const link = links[name];
      assert.ok(link, `${scenario.name}: ${name} route is present`);
      assert.equal(link.href, href, `${scenario.name}: ${name} route matches the existing manifest`);
      assert.equal(link.target, '_blank', `${scenario.name}: ${name} opens in a new tab`);
      assert.match(link.rel, /noopener/);
      assert.match(link.rel, /noreferrer/);
    }
    assert.equal(Object.hasOwn(links, 'AI 指揮艙'), false, 'unverified cockpit URL is not invented');
    assert.equal(Object.hasOwn(links, 'TF-03'), false, 'unverified TF-03 URL is not invented');
    await scene.locator('canvas#world').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('#p3-shell');
      const inner = frame?.contentDocument?.querySelector('#p3-native-scene');
      return inner && !inner.hidden && inner.contentDocument?.querySelector('canvas#world')
        && inner.contentWindow?.habblaud?.store?.snapshot?.meta?.version === 'Zhuge Pixel P3';
    }, null, { timeout: 30000 });
    // The mobile roster is intentionally inside a closed <details>; assert
    // that the row exists without forcing the panel open before its default
    // collapsed-state check below.
    await shell.locator('[data-role-id="kaka"]').waitFor({ state: 'attached' });

    const data = await scene.locator('body').evaluate(() => {
      const h = window.habblaud;
      const snap = h?.store?.snapshot;
      return {
        snapshotVersion: snap?.meta?.version,
        displayOnly: snap?.meta?.demo === true && (snap?.meta?.sources || []).length === 0,
        roles: (snap?.agents || []).map(agent => ({ id: agent.id, name: agent.name, status: agent.status, title: agent.title, role: agent.role, roomId: agent.roomId, tasks: agent.tasks })),
        dynamicRooms: (snap?.rooms || []).map(room => ({ id: room.id, name: room.name })),
        selection: h?.world?.getSelection?.(),
        canvas: (() => { const canvas = document.querySelector('canvas#world'); const r = canvas?.getBoundingClientRect(); return { width: r?.width || 0, height: r?.height || 0, backingWidth: canvas?.width || 0, backingHeight: canvas?.height || 0 }; })(),
        nativeUiHidden: document.querySelector('#ui')?.hidden === true,
        nativeOrigin: location.origin,
        nativeFrameCount: [...document.querySelectorAll('iframe')].length
      };
    });
    assert.equal(data.snapshotVersion, 'Zhuge Pixel P3');
    assert.equal(data.displayOnly, true, 'roster snapshot is explicitly visual-only, not live work telemetry');
    assert.equal(data.roles.length, 7);
    assert.deepEqual(data.roles.map(item => item.name), names);
    assert.equal(data.dynamicRooms.length, 3, 'P3 contributes only three rooms; Habblaud core rooms stay native');
    assert.ok(data.roles.every(item => item.tasks.length === 0), 'no fake assigned tasks');
    assert.ok(data.roles.filter(item => ['Co', 'Gem', 'GPT'].includes(item.name)).every(item => item.title === '尚無可驗證的最新狀態'));
    assert.ok(data.roles.filter(item => ['Betty', '安安', '卡卡'].includes(item.name)).every(item => item.role.includes('虛擬居民') && item.title.includes('虛擬')));
    assert.equal(data.nativeUiHidden, true, 'P3 wrapper uses the original native Canvas without competing native controls');
    assert.ok(data.canvas.width > 0 && data.canvas.height > 0 && data.canvas.backingWidth > 0 && data.canvas.backingHeight > 0, 'native canvas rendered');
    assert.equal(data.nativeFrameCount, 0, 'scene is the Habblaud native Canvas; no nested second engine');

    const shellNames = await shell.locator('[data-role-id] .p3-shell__person-name').allTextContents();
    assert.deepEqual(shellNames.map(name => name.trim()), names);
    const roster = shell.locator('#p3-roster-panel');
    assert.equal(await roster.evaluate(el => el.open), scenario.desktop, `${scenario.name}: desktop starts expanded, compact/mobile starts collapsed`);
    const frameBox = await shell.locator('.p3-shell__scene-frame').boundingBox();
    assert.ok(frameBox && frameBox.width > 0 && frameBox.height > 0, `${scenario.name}: scene remains visible`);
    if (scenario.desktop) assert.ok(frameBox.width >= scenario.width * 0.58, `${scenario.name}: personnel column does not overtake the office canvas`);
    // Capture the native initial overview before exercising roster-to-character
    // focus. The latter deliberately zooms to a person and is not a floorplan
    // screenshot. The 420 ms native overview animation should be settled here.
    await page.waitForTimeout(500);
    const overview = await scene.locator('body').evaluate(() => window.habblaud?.world?.debug?.state?.());
    assert.ok(overview?.camera && overview?.cols > 0, `${scenario.name}: native overview is available for inspection`);
    const floorHeightRatio = 29 * 16 * overview.camera.zoom / data.canvas.height;
    if (scenario.desktop) assert.ok(floorHeightRatio >= 0.58, `${scenario.name}: native floor uses enough of the scene height (${floorHeightRatio.toFixed(2)})`);
    await page.screenshot({ path: path.join(output, `${scenario.name}-overview.png`), fullPage: false });
    const pageMetrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    assert.ok(pageMetrics.width <= scenario.width + 2, `${scenario.name}: no horizontal page overflow`);

    if (!scenario.desktop) {
      await shell.locator('.p3-shell__roster-summary').click();
      assert.equal(await roster.evaluate(el => el.open), true, `${scenario.name}: personnel drawer opens on demand`);
    }
    await shell.locator('[data-role-id="co"]').click();
    const selectedCo = await scene.locator('body').evaluate(() => window.habblaud?.world?.getSelection?.());
    assert.deepEqual(selectedCo, { type: 'agent', id: 'p3-role-co' }, `${scenario.name}: roster selection controls the native character`);
    assert.match(await shell.locator('#p3-detail-status').innerText(), /尚無可驗證的最新狀態/);
    await scene.locator('body').evaluate(() => window.habblaud.world.select({ type: 'agent', id: 'p3-role-anan' }, { focus: false }));
    await shell.locator('[data-role-id="anan"][aria-pressed="true"]').waitFor({ timeout: 3000 });
    assert.match(await shell.locator('#p3-resident-note').innerText(), /不追蹤或呈現真人位置/);
    assert.match(await shell.locator('#p3-resident-activity').innerText(), /虛擬生活設定/);
    assert.equal(await shell.locator('#p3-engineering-events').isVisible(), false, 'residents do not receive engineering events');
    await shell.locator('[data-role-id="gpt"]').click();
    assert.match(await shell.locator('#p3-detail-status').innerText(), /尚無可驗證的最新狀態/);
    assert.equal(forbidden.length, 0, `${scenario.name}: no TaskFlow/Supabase/Render requests`);
    assert.equal(failedLocal.length, 0, `${scenario.name}: no failed local assets ${failedLocal.join(', ')}`);
    assert.ok([...externalHosts].every(host => host === 'api.github.com'), `${scenario.name}: only public GitHub read-only evidence may leave the preview`);
    await page.screenshot({ path: path.join(output, `${scenario.name}-interaction.png`), fullPage: false });
    results.push({ ...scenario, nativeOverview: overview.camera, buildingColumns: overview.cols, floorHeightRatio: Number(floorHeightRatio.toFixed(2)), canvas: data.canvas, scene: { width: Math.round(frameBox.width), height: Math.round(frameBox.height) }, externalHosts: [...externalHosts], noApiCalls: true });
    await context.close();
  }
  if (failures.length) throw new Error(`Browser page errors: ${failures.join('; ')}`);
  console.log(JSON.stringify({ result: 'PASS', browser: 'Chromium', viewports: results, pageErrors: failures, screenshots: output, externalTaskFlowAccess: 'NONE' }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
