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
  // Fresh mobile startup verifies actual native camera focus, not a desktop-derived viewport.
  const phone = await browser.newPage({ viewport:{width:390,height:844}, locale:'zh-TW' });
  phone.on('pageerror', error => failures.push('native-phone: ' + error.message));
  await phone.goto(base + '/pixel-office/index.html', { waitUntil:'domcontentloaded' });
  await phone.locator('#zhuge-aios-hud').waitFor({timeout:30000});
  await phone.waitForFunction(() => {
    const d = window.habblaud?.world?.debug;
    return !!(d?.sim?.initialized && d?.sim?.building?.cols >= 3 && d?.camera?.zoom > 0);
  }, null, {timeout:30000});
  const cameraAudit = await phone.evaluate(() => {
    const d = window.habblaud.world.debug;
    const c = d.camera;
    // Pinned native constants: COL_W=16, TILE=16, BUILDING_H=29.
    const fullZoom = c.fitZoom({x:0,y:0,w:d.sim.building.cols*16*16,h:29*16},16);
    return {zoom:c.zoom,fullZoom,cols:d.sim.building.cols,lang:document.documentElement.lang};
  });
  if (cameraAudit.lang !== 'zh-TW' || cameraAudit.zoom <= cameraAudit.fullZoom * 1.03) {
    throw new Error('Native phone does not start focused on the office, or is not zh-TW: ' + JSON.stringify(cameraAudit));
  }
  const phoneShots = process.env.PIXEL_SCREENSHOT_DIR;
  if (phoneShots) {
    fs.mkdirSync(phoneShots,{recursive:true});
    await phone.screenshot({path:path.join(phoneShots,'pixel-p2-first-screen-day-390x844.png'),fullPage:false});
    await phone.evaluate(() => window.habblaud.world.debug.setHour(23));
    await phone.waitForTimeout(1000);
    await phone.screenshot({path:path.join(phoneShots,'pixel-p2-first-screen-night-390x844.png'),fullPage:false});
  }
  await phone.close();
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
  // #72: exercise the native browser simulation, not a mocked coordinate list.
  // Idle outings are presentation behavior only and must never imply provider work.
  const beforeRoam = await frame.locator('body').evaluate(() => {
    const world = window.habblaud?.world;
    if (!world?.debug?.wanderNow || !world?.debug?.state) throw new Error('native Habblaud roam debug API missing');
    const chars = world.debug.state().chars;
    const initial = Object.fromEntries(chars.map(c => [c.id, c.tile.join(',')]));
    world.debug.wanderNow();
    return initial;
  });
  await page.waitForFunction((initial) => {
    const world = document.querySelector('iframe')?.contentWindow?.habblaud?.world;
    if (!world?.debug?.state || !world?.debug?.sim?.building?.grid?.walkable) return false;
    const chars = world.debug.state().chars;
    const moved = chars.some(c => initial[c.id] && initial[c.id] !== c.tile.join(','));
    const safe = chars.every(c => c.mode === 'idle' && world.debug.sim.building.grid.walkable(c.tile[0], c.tile[1]));
    return moved && safe;
  }, beforeRoam, { timeout:15000 });
  const roamAudit = await frame.locator('body').evaluate(() => {
    const world = window.habblaud.world;
    return world.debug.state().chars.map(c => ({
      id: c.id, tile: c.tile, mode: c.mode,
      walkable: world.debug.sim.building.grid.walkable(c.tile[0], c.tile[1]),
    }));
  });
  if (!roamAudit.some(c => beforeRoam[c.id] !== c.tile.join(',')) || roamAudit.some(c => c.mode !== 'idle' || !c.walkable)) {
    throw new Error('Native idle roaming left the WalkGrid or changed role into work: ' + JSON.stringify(roamAudit));
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
  await frame.locator('#zhuge-aios-hud button').nth(3).click();
  await frame.locator('#zhuge-weather-panel:not([hidden])').waitFor({timeout:2000});
  const unknownWeather = await frame.locator('#zhuge-weather-panel').innerText();
  if (!unknownWeather.includes('臺北市') || !unknownWeather.includes('尚無可驗證') || !unknownWeather.includes('颱風警報狀態未知')) {
    throw new Error('Unauthenticated static Pages must show Taipei and unknown weather, never mock conditions: ' + unknownWeather);
  }
  await frame.locator('#zhuge-weather-city').selectOption('newTaipei');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.localStorage.getItem('zhuge-pixel-weather-city-v1') === 'newTaipei');
  const selectedWeather = await frame.locator('#zhuge-weather-panel').innerText();
  if (!selectedWeather.includes('新北市') || !selectedWeather.includes('尚無可驗證')) {
    throw new Error('Manual city selection changed to false weather instead of an explicit unknown state: ' + selectedWeather);
  }
  const weatherBox = await frame.locator('#zhuge-weather-panel').boundingBox();
  if (!weatherBox || weatherBox.x < 0 || weatherBox.x + weatherBox.width > 1280) throw new Error('Desktop weather panel is clipped: ' + JSON.stringify(weatherBox));
  await frame.locator('#zhuge-weather-panel > button').click();
  await frame.locator('#zhuge-weather-panel').waitFor({state:'hidden',timeout:2000});
  const classic = await frame.locator('#zhuge-aios-hud a').getAttribute('href');
  if (!classic?.endsWith('/status-classic.html')) throw new Error('classic route broken: ' + classic);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  // P1 furniture: actual published paths, functional medals, honest pending items.
  await page.locator('#zgf-trophy-board').waitFor({timeout:5000});
  const taskflow = await page.locator('#zgf-trophy-board [data-zgf-work="taskflow"]').getAttribute('href');
  if (taskflow !== 'https://zhuge-taskflow-web.onrender.com/') throw new Error('TaskFlow medal points to wrong official hall: ' + taskflow);
  const worklog = await page.locator('#zgf-trophy-board [data-zgf-work="worklog"]').getAttribute('href');
  const investment = await page.locator('#zgf-trophy-board [data-zgf-work="investment"]').getAttribute('href');
  const lab = await page.locator('#zgf-trophy-board [data-zgf-work="lab"]').getAttribute('href');
  if (worklog !== base + '/modules/worklog/' || investment !== base + '/modules/investment/' || lab !== base + '/modules/labs/') {
    throw new Error('Product medals resolve outside current Pages root: ' + worklog + ', ' + investment + ', ' + lab);
  }
  if (await page.locator('.zgf-meeting, .zgf-door-art').count()) throw new Error('old floating meeting-room mock remains');
  const awardWall = await page.locator('#zgf-trophy-board').boundingBox();
  if (!awardWall || awardWall.x < 0 || awardWall.x + awardWall.width > 1280 || awardWall.x > 1280 * 0.6 || await page.locator('#zgf-trophy-board').getAttribute('data-scene-anchor') !== 'core:recepcao') {
    throw new Error('award information is no longer anchored to the indoor Reception: ' + JSON.stringify(awardWall));
  }
  const desktopToggle = page.locator('.zgf-board-toggle');
  if (await desktopToggle.getAttribute('aria-expanded') !== 'false') throw new Error('award info board must start collapsed so the native room is visible');
  await desktopToggle.click();
  if (await desktopToggle.getAttribute('aria-expanded') !== 'true') throw new Error('desktop award info board did not expand');
  await page.locator('.zgf-rack [data-zgf-pending="cockpit"]').click();
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
  await desktopToggle.click();
  if (await desktopToggle.getAttribute('aria-expanded') !== 'false') throw new Error('desktop award info board did not collapse');
  const shotDir = process.env.PIXEL_SCREENSHOT_DIR;
  if (shotDir) {
    fs.mkdirSync(shotDir, {recursive: true});
    await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-desktop-1280.png'), fullPage: false});
  }
  for (const viewport of [{width:1440,height:900},{width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    const boardBox = await page.locator('#zgf-trophy-board').boundingBox();
    if (!boardBox || boardBox.x + boardBox.width > viewport.width || boardBox.x < 0 || await frame.locator('canvas#world').count() !== 1) {
      throw new Error('desktop native room/award panel is clipped at ' + JSON.stringify(viewport));
    }
    if (shotDir) await page.screenshot({path: path.join(shotDir, `pixel-p2-71-desktop-${viewport.width}x${viewport.height}.png`), fullPage:false});
  }
  await page.setViewportSize({width:1280,height:780});
  await page.setViewportSize({width:390,height:844});
  // The phone's native first frame focuses a legible part of the office.
  // Do not assert pixel-perfect zoom levels: use the real native renderer camera.
  await frame.locator('canvas#world').waitFor({state:'visible'});
  await page.waitForTimeout(600);
  const initialMobileCamera = await frame.locator('body').evaluate(() => {
    const c = window.habblaud?.world?.debug?.camera;
    return c ? {zoom:c.zoom,viewW:c.viewW,viewH:c.viewH} : null;
  });
  if (initialMobileCamera && (initialMobileCamera.zoom <= 0 || initialMobileCamera.viewW <= 0)) {
    throw new Error('Invalid mobile native office camera: ' + JSON.stringify(initialMobileCamera));
  }
  const hudMenu = frame.locator('.zhuge-hud-menu-toggle');
  if (await hudMenu.getAttribute('aria-expanded') !== 'false') throw new Error('Mobile engineering HUD must start compact');
  await hudMenu.click();
  if (await hudMenu.getAttribute('aria-expanded') !== 'true') throw new Error('Mobile engineering HUD cannot expand');
  const toggle = page.locator('.zgf-board-toggle');
  const beforeToggle = await toggle.getAttribute('aria-expanded');
  if (beforeToggle !== 'false') throw new Error('mobile award information should start collapsed');
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-mobile-390.png'), fullPage: false});
  await toggle.click();
  const afterToggle = await toggle.getAttribute('aria-expanded');
  if (beforeToggle === afterToggle) throw new Error('Mobile trophy wall cannot expand/collapse');
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-mobile-expanded-390.png'), fullPage: false});
  await toggle.click();
  await frame.locator('#zhuge-aios-hud button').nth(1).click();
  await frame.locator('#zhuge-decision-panel:not([hidden])').waitFor({timeout:2000});
  const mobileStatusBox = await frame.locator('#zhuge-decision-panel').boundingBox();
  const mobileStatusText = await frame.locator('#zhuge-decision-panel').innerText();
  if (!mobileStatusBox || mobileStatusBox.x < 0 || mobileStatusBox.x + mobileStatusBox.width > 390 || !mobileStatusText.includes('靜態專案紀錄')) {
    throw new Error('Mobile read-only status panel is clipped or loses provenance: ' + JSON.stringify({mobileStatusBox, mobileStatusText}));
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await frame.locator('#zhuge-aios-hud button').nth(3).click();
  await frame.locator('#zhuge-weather-panel:not([hidden])').waitFor({timeout:2000});
  const mobileWeatherBox = await frame.locator('#zhuge-weather-panel').boundingBox();
  const mobileWeatherText = await frame.locator('#zhuge-weather-panel').innerText();
  if (!mobileWeatherBox || mobileWeatherBox.x < 0 || mobileWeatherBox.x + mobileWeatherBox.width > 390 || !mobileWeatherText.includes('新北市') || !mobileWeatherText.includes('天文近似')) {
    throw new Error('Mobile weather/city panel is clipped or missing truthful contract: ' + JSON.stringify({ mobileWeatherBox, mobileWeatherText }));
  }
  await frame.locator('#zhuge-weather-panel > button').click();
  await frame.locator('#zhuge-weather-panel').waitFor({state:'hidden',timeout:2000});
  await frame.locator('#zhuge-aios-hud button').nth(2).click();
  const mobileRoleText = await frame.locator('#zhuge-decision-panel').innerText();
  if (!mobileRoleText.includes('Jackal') || !mobileRoleText.includes('GPT')) {
    throw new Error('Mobile role panel is missing fixed cast entries: ' + mobileRoleText);
  }
  await frame.locator('#zhuge-decision-panel > button').click();
  await frame.locator('#zhuge-decision-panel').waitFor({state:'hidden',timeout:2000});
  await hudMenu.click();
  if (await hudMenu.getAttribute('aria-expanded') !== 'false') throw new Error('Mobile engineering HUD cannot collapse');
  await page.setViewportSize({width:844,height:390});
  const landscapeMetrics = await page.evaluate(() => {
    const box = selector => {
      const item = document.querySelector(selector);
      if (!item) return null;
      const rect = item.getBoundingClientRect();
      return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
    };
    return {
      viewport:{width:innerWidth,height:innerHeight},
      document:{width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.clientHeight,scrollHeight:document.documentElement.scrollHeight},
      iframe:box('iframe'),
      devices:[...document.querySelectorAll('.zgf-device')].map(item=>{
        const rect=item.getBoundingClientRect();
        return {name:item.getAttribute('aria-label'),x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
      })
    };
  });
  if (landscapeMetrics.viewport.width !== 844 || landscapeMetrics.viewport.height !== 390 ||
      landscapeMetrics.document.scrollWidth > 845 || landscapeMetrics.document.scrollHeight > 392 ||
      !landscapeMetrics.iframe || landscapeMetrics.iframe.x < 0 || landscapeMetrics.iframe.right > 845 ||
      landscapeMetrics.devices.length !== 6 || landscapeMetrics.devices.some(item => item.x < 0 || item.y < 0 || item.right > 845 || item.bottom > 392 || item.width <= 0 || item.height <= 0)) {
    throw new Error('Mobile landscape office is clipped, overflowing or has inaccessible product links: ' + JSON.stringify(landscapeMetrics));
  }
  const landscapeCanvas = await frame.locator('canvas#world').boundingBox();
  const landscapeHud = await frame.locator('#zhuge-aios-hud').boundingBox();
  const landscapeAwards = await page.locator('#zgf-trophy-board').boundingBox();
  if (!landscapeCanvas || landscapeCanvas.width <= 0 || landscapeCanvas.height <= 0 ||
      !landscapeHud || landscapeHud.x < 0 || landscapeHud.y < 0 || landscapeHud.x + landscapeHud.width > 844 || landscapeHud.y + landscapeHud.height > 390 ||
      !landscapeAwards || landscapeAwards.x < 0 || landscapeAwards.y < 0 || landscapeAwards.x + landscapeAwards.width > 844 || landscapeAwards.y + landscapeAwards.height > 390) {
    throw new Error('Mobile landscape native scene or HUD is not visible inside the viewport: ' + JSON.stringify({landscapeCanvas,landscapeHud,landscapeAwards}));
  }
  const landscapeToggle = page.locator('.zgf-board-toggle');
  await landscapeToggle.click();
  if (await landscapeToggle.getAttribute('aria-expanded') !== 'true') throw new Error('Mobile landscape award wall cannot expand');
  await landscapeToggle.click();
  if (await landscapeToggle.getAttribute('aria-expanded') !== 'false') throw new Error('Mobile landscape award wall cannot collapse');
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-p2-mobile-landscape-844x390.png'), fullPage:false});
  await page.setViewportSize({width:1280,height:780});
  await page.goto(base + '/docs/index.html', { waitUntil:'domcontentloaded' });
  await page.frameLocator('iframe').locator('#zhuge-aios-hud').waitFor({timeout:30000});
  await page.locator('#zgf-trophy-board').waitFor({timeout:5000});
  const docsWorklog = await page.locator('#zgf-trophy-board [data-zgf-work="worklog"]').getAttribute('href');
  if (docsWorklog !== base + '/modules/worklog/') throw new Error('docs home shifted WorkLog to /docs/: ' + docsWorklog);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  console.log('PASS native Habblaud P2 cast Jackal/GPT/Codex/Gem idle, static status is not people, weather contract unknown-state/manual-city/desktop-mobile, read-only project/PR panel, role dossier, medal details, P1 links, classic and docs entry');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
