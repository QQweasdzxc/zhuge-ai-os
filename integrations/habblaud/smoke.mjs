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
  const executablePath = process.env.BROWSER_EXECUTABLE || undefined;
  browser = await playwright.chromium.launch({ headless:true, args:['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
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
  if (snapshot.rooms !== 1 || snapshot.agents !== 4 || snapshot.waiting !== 0) throw new Error('Static project status created people or changed work state: ' + JSON.stringify(snapshot));
  // P2: four fixed native-renderer role characters, ALWAYS idle and explicitly non-provider.
  const crew = await frame.locator('body').evaluate(() => {
    const s = window.habblaud?.store?.snapshot;
    const cast = (s?.agents || []).filter(a => a.id.startsWith('zhuge-crew-'));
    return {
      rooms: (s?.rooms || []).filter(r => r.id === 'zhuge-room-crew').length,
      agents: cast.map(a => ({ id:a.id, status:a.status, account:a.account, title:a.title })),
    };
  });
  const castIds = ['zhuge-crew-pm', 'zhuge-crew-gpt', 'zhuge-crew-codex', 'zhuge-crew-gem'];
  if (crew.rooms !== 1 || crew.agents.length !== 4 || !castIds.every(id => crew.agents.some(a => a.id === id))) {
    throw new Error('P2 native cast did not spawn as four stable characters: ' + JSON.stringify(crew));
  }
  if (crew.agents.some(a => a.status !== 'idle' || a.provider !== undefined || a.account !== 'zhuge-fixed-cast' || !a.title.includes('尚無可驗證的即時工作狀態'))) {
    throw new Error('P2 cast faked real CLI work status: ' + JSON.stringify(crew));
  }
  if (await frame.locator('body').evaluate(() => (window).habblaud.store.snapshot.agents.some(a => a.id.startsWith('zhuge-module-') || a.id.startsWith('zhuge-pr-')))) {
    throw new Error('Static module/PR status was incorrectly rendered as scene people');
  }
  await frame.locator('#zhuge-aios-hud button').first().click();
  await frame.locator('#zhuge-decision-panel:not([hidden])').waitFor({timeout:2000});
  const panel = await frame.locator('#zhuge-decision-panel').innerText();
  if (!panel.includes('正式 DB') || !panel.includes('下一步')) throw new Error('decision panel missing blocker/action');
  await frame.locator('#zhuge-decision-panel button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await frame.locator('#zhuge-aios-hud button').nth(1).click();
  await frame.locator('#zhuge-decision-panel:not([hidden])').waitFor({timeout:2000});
  const projectStatus = await frame.locator('#zhuge-decision-panel').innerText();
  if (!projectStatus.includes('專案狀態') || !projectStatus.includes('靜態專案紀錄') || !projectStatus.includes('TaskFlow')) {
    throw new Error('Read-only project/PR panel missing or lacks provenance: ' + projectStatus);
  }
  const prLink = frame.locator('#zhuge-decision-panel a[href="https://github.com/QQweasdzxc/zhuge-ai-os/pull/60"]');
  if (await prLink.count() !== 1 || await prLink.getAttribute('rel') !== 'noopener noreferrer') {
    throw new Error('Verified GitHub PR source link missing or unsafe');
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await frame.locator('#zhuge-aios-hud button').nth(2).click();
  await frame.locator('.zhuge-role-roster button').last().click();
  const roleText = await frame.locator('#zhuge-decision-panel').innerText();
  if (!roleText.includes('Gem｜第二工程師') || !roleText.includes('固定像素角色不是真人位置或 Provider Session')) {
    throw new Error('P2 role dossier missing or falsely live: ' + roleText);
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  const classic = await frame.locator('#zhuge-aios-hud a').getAttribute('href');
  if (!classic?.endsWith('/status-classic.html')) throw new Error('classic route broken: ' + classic);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  // P1 furniture: actual published paths, functional medals, honest pending items.
  await page.locator('#zgf-trophy-board').waitFor({timeout:5000});
  const taskflow = await page.locator('#zgf-trophy-board [data-zgf-work="taskflow"]').getAttribute('href');
  if (taskflow !== 'https://zhuge-taskflow-web.onrender.com/') throw new Error('TaskFlow medal points to wrong official hall: ' + taskflow);
  const worklog = await page.locator('#zgf-trophy-board [data-zgf-work="worklog"]').getAttribute('href');
  const investment = await page.locator('#zgf-trophy-board [data-zgf-work="investment"]').getAttribute('href');
  if (worklog !== base + '/modules/worklog/' || investment !== base + '/modules/investment/') {
    throw new Error('Product medals resolve outside current Pages root: ' + worklog + ', ' + investment);
  }
  await page.locator('.zgf-meeting').click();
  const message = await page.locator('.zgf-toast:not([hidden])').innerText();
  if (!message.includes('連結待 PM 補充')) throw new Error('Unverified cockpit URL was not treated as pending');
  await page.locator('[data-zgf-pending="tools"]').click();
  if (!(await page.locator('.zgf-toast:not([hidden])').innerText()).includes('正式下載來源尚待驗證')) {
    throw new Error('TF-03 failed to disclose unavailable download');
  }
  // P2 optional medal information; primary medal remains a direct hyperlink.
  await page.locator('[data-zgf-info="taskflow"]').click();
  const info = await page.locator('#zgf-work-details:not([hidden])').innerText();
  if (!info.includes('TaskFlow') || !info.includes('非運行') && !info.includes('不代表程式目前正在執行')) {
    throw new Error('P2 medal info lacks provenance: ' + info);
  }
  const go = await page.locator('#zgf-work-details a').getAttribute('href');
  if (go !== taskflow) throw new Error('P2 trophy detail changed TaskFlow official URL');
  await page.locator('.zgf-work-close').click();
  await page.locator('#zgf-work-details').waitFor({state:'hidden',timeout:2000});
  await page.locator('.zgf-toast').evaluate(element => { element.hidden = true; });
  const shotDir = process.env.PIXEL_SCREENSHOT_DIR;
  if (shotDir) {
    fs.mkdirSync(shotDir, {recursive: true});
    await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-desktop-1280.png'), fullPage: false});
  }
  await page.setViewportSize({width:390,height:844});
  const toggle = page.locator('.zgf-board-toggle');
  const beforeToggle = await toggle.getAttribute('aria-expanded');
  await toggle.click();
  const afterToggle = await toggle.getAttribute('aria-expanded');
  if (beforeToggle === afterToggle) throw new Error('Mobile trophy wall cannot expand/collapse');
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-mobile-390.png'), fullPage: false});
  await toggle.click();
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-mobile-expanded-390.png'), fullPage: false});
  await frame.locator('#zhuge-aios-hud button').nth(1).click();
  await frame.locator('#zhuge-decision-panel:not([hidden])').waitFor({timeout:2000});
  const mobileStatusBox = await frame.locator('#zhuge-decision-panel').boundingBox();
  const mobileStatusText = await frame.locator('#zhuge-decision-panel').innerText();
  if (!mobileStatusBox || mobileStatusBox.x < 0 || mobileStatusBox.x + mobileStatusBox.width > 390 || !mobileStatusText.includes('靜態專案紀錄')) {
    throw new Error('Mobile read-only status panel is clipped or loses provenance: ' + JSON.stringify({mobileStatusBox, mobileStatusText}));
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await frame.locator('#zhuge-aios-hud button').nth(2).click();
  const mobileRoleText = await frame.locator('#zhuge-decision-panel').innerText();
  if (!mobileRoleText.includes('Jackal') || !mobileRoleText.includes('GPT')) {
    throw new Error('Mobile role panel is missing fixed cast entries: ' + mobileRoleText);
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await page.setViewportSize({width:1280,height:780});
  await page.goto(base + '/docs/index.html', { waitUntil:'domcontentloaded' });
  await page.frameLocator('iframe').locator('#zhuge-aios-hud').waitFor({timeout:30000});
  await page.locator('#zgf-trophy-board').waitFor({timeout:5000});
  const docsWorklog = await page.locator('#zgf-trophy-board [data-zgf-work="worklog"]').getAttribute('href');
  if (docsWorklog !== base + '/modules/worklog/') throw new Error('docs home shifted WorkLog to /docs/: ' + docsWorklog);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  console.log('PASS native Habblaud P2 cast Jackal/GPT/Codex/Gem idle, static status is not people, read-only project/PR panel, role dossier, medal details, P1 links, desktop/mobile, classic and docs entry');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
