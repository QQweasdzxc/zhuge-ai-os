#!/usr/bin/env node
/** Browser-level review smoke test for pinned Habblaud's real canvas + status bridge. */
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const site = path.resolve(process.argv[2] || '');
const upstream = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage smoke.mjs <site> <upstream>');
const playwright = await import(pathToFileURL(path.join(upstream, 'node_modules/playwright-core/index.mjs')).href);
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  // Static Pages intentionally has no /api endpoints.
  if (pathname.startsWith('/api/')) { res.writeHead(404); res.end('NO_CLI_SERVER'); return; }
  const wanted = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const full = path.resolve(site, '.' + wanted);
  if (!(full === site || full.startsWith(site + path.sep))) { res.writeHead(403); res.end(); return; }
  try {
    const data = fs.readFileSync(full);
    res.writeHead(200, {'content-type':types[path.extname(full)] || 'application/octet-stream','cache-control':'no-store'});
    res.end(data);
  } catch {
    res.writeHead(404); res.end('NOT_FOUND ' + pathname);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = 'http://127.0.0.1:' + address.port;
let browser;
try {
  browser = await playwright.chromium.launch({ headless:true, args:['--no-sandbox'] });
  const page = await browser.newPage({ viewport:{ width:1280,height:780 }, locale:'zh-TW' });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/api/')) failures.push('HTTP ' + response.status() + ' ' + response.url());
  });
  await page.goto(base + '/', { waitUntil:'domcontentloaded' });
  const frame = page.frameLocator('iframe');
  await frame.locator('#zhuge-aios-hud').waitFor({ timeout:30000 });
  const hud = await frame.locator('#zhuge-aios-hud').innerText();
  if (!hud.includes('Zhuge AI OS') || !hud.includes('待裁示')) throw new Error('HUD not rendered: ' + hud);
  const rendered = await frame.locator('canvas#world').count();
  if (!rendered) throw new Error('real Habblaud world Canvas missing');
  const snapshot = await frame.locator('body').evaluate(() => {
    const s = (window).habblaud?.store?.snapshot;
    return { rooms:s?.rooms?.length || 0, agents:s?.agents?.length || 0, waiting:s?.agents?.filter(a=>a.status==='waiting').length||0 };
  });
  if (snapshot.rooms < 3 || snapshot.agents < 3 || snapshot.waiting < 1) throw new Error('Snapshot did not drive native room/agents: ' + JSON.stringify(snapshot));
  await frame.locator('#zhuge-aios-hud button').click();
  await frame.locator('#zhuge-decision-panel:not([hidden])').waitFor({timeout:2000});
  const panel = await frame.locator('#zhuge-decision-panel').innerText();
  if (!panel.includes('正式 DB') || !panel.includes('下一步')) throw new Error('decision panel missing blocker/action');
  const classic = await frame.locator('#zhuge-aios-hud a').getAttribute('href');
  if (!classic?.endsWith('/status-classic.html')) throw new Error('classic route broken: ' + classic);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  await page.goto(base + '/docs/index.html', { waitUntil:'domcontentloaded' });
  await page.frameLocator('iframe').locator('#zhuge-aios-hud').waitFor({timeout:30000});
  console.log('PASS real Habblaud Canvas, rooms=' + snapshot.rooms + ', agents=' + snapshot.agents + ', waiting=' + snapshot.waiting + ', HUD drawer, classic, docs entry');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
