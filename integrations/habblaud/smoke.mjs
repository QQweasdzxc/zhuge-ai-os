#!/usr/bin/env node
/** Browser-level review smoke test for pinned Habblaud's real canvas + status bridge. */
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const site = path.resolve(process.argv[2] || '');
const upstream = path.resolve(process.argv[3] || '');
const sourceRoot = path.resolve(process.argv[4] || path.resolve(import.meta.dirname, '../..'));
if (!process.argv[2] || !process.argv[3]) throw new Error('usage smoke.mjs <artifact> <upstream> [source-root]');
const playwright = await import(pathToFileURL(path.join(upstream, 'node_modules/playwright-core/index.mjs')).href);
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  // Static Pages intentionally has no /api endpoints.
  if (pathname.startsWith('/api/')) { res.writeHead(404); res.end('NO_CLI_SERVER'); return; }
  const wanted = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  let full = path.resolve(site, '.' + wanted);
  if (!(full === site || full.startsWith(site + path.sep))) { res.writeHead(403); res.end(); return; }
  // The native build artifact contains the compiled Habblaud route and docs
  // projection; the remaining Pages assets come from this checked-out source.
  if (!fs.existsSync(full)) {
    full = path.resolve(sourceRoot, '.' + wanted);
    if (!(full === sourceRoot || full.startsWith(sourceRoot + path.sep))) { res.writeHead(403); res.end(); return; }
  }
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
async function waitForNativeReady(page) {
  const embedded = await page.locator('iframe').count() > 0;
  const scene = embedded ? page.frameLocator('iframe') : page;
  await scene.locator('#zhuge-aios-hud').waitFor({timeout:30000});
  await scene.locator('canvas#world').waitFor({state:'visible',timeout:30000});
  await page.waitForFunction(() => {
    const iframe = document.querySelector('iframe');
    const win = iframe?.contentWindow ?? window;
    const doc = iframe?.contentDocument ?? document;
    const app = win.habblaud;
    const debug = app?.world?.debug;
    const splash = doc.querySelector('.ui-splash');
    const splashHidden = !splash || (
      splash.classList.contains('is-hidden') &&
      Number.parseFloat(getComputedStyle(splash).opacity) <= 0.01 &&
      getComputedStyle(splash).pointerEvents === 'none'
    );
    return !!(
      app?.store?.snapshot && debug?.sim?.initialized &&
      debug?.sim?.building?.core?.length >= 4 && doc.querySelector('canvas#world') &&
      splashHidden
    );
  }, null, {timeout:45000});
  // Wait for the native renderer to paint after its real snapshot/splash-ready signal.
  await page.evaluate(() => new Promise(resolve => {
    const win = document.querySelector('iframe')?.contentWindow ?? window;
    win.requestAnimationFrame(() => win.requestAnimationFrame(resolve));
  }));
  return scene;
}
async function waitForNativeViewport(page, width, height) {
  const expected = {width, height};
  await page.waitForFunction(({width, height}) => {
    const win = document.querySelector('iframe')?.contentWindow ?? window;
    const camera = win.habblaud?.world?.debug?.camera;
    return camera?.viewW === width && camera.viewH === height && camera.insets.top > 0 && camera.zoom > 0;
  }, expected, {timeout:30000});
  // Camera framing can animate after the viewport/safe-area observers update.
  // Require three stable animation frames instead of sleeping a guessed duration.
  await page.waitForFunction(({width, height}) => new Promise(resolve => {
    let previous = null;
    let stable = 0;
    const sample = () => {
      const win = document.querySelector('iframe')?.contentWindow ?? window;
      const camera = win.habblaud?.world?.debug?.camera;
      const matches = camera?.viewW === width && camera.viewH === height && camera.insets.top > 0;
      const current = matches ? [camera.x, camera.y, camera.zoom, camera.insets.top, camera.insets.bottom].map(v => Number(v).toFixed(3)).join('|') : null;
      if (current && current === previous) stable += 1;
      else stable = 0;
      previous = current;
      if (stable >= 2) return resolve(true);
      win.requestAnimationFrame(sample);
    };
    sample();
  }), expected, {timeout:30000});
}
async function waitForLighting(page, hour, night) {
  await page.waitForFunction(({hour, night}) => {
    const win = document.querySelector('iframe')?.contentWindow ?? window;
    const state = win.habblaud?.world?.debug?.lightingSnapshot?.();
    return state && state.hourOverride === hour && Math.abs(state.renderedHour - hour) < 0.01 && Math.abs(state.ambientNight - night) < 0.03;
  }, {hour, night}, {timeout:20000});
}
async function readCanvasLuminanceGrid(page) {
  return page.evaluate(() => {
    const win = document.querySelector('iframe')?.contentWindow ?? window;
    const canvas = win.document.querySelector('canvas#world');
    const ctx = canvas?.getContext('2d', {willReadFrequently:true});
    if (!canvas || !ctx) throw new Error('native scene pixels are unavailable for day/night comparison');
    const {width, height} = canvas;
    const image = ctx.getImageData(0, 0, width, height);
    const grid = [];
    const columns = 16, rows = 16;
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < columns; gx++) {
      const x0 = Math.floor(gx * width / columns), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * width / columns));
      const y0 = Math.floor(gy * height / rows), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * height / rows));
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
        const i = (y * width + x) * 4;
        sum += image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722;
        count++;
      }
      grid.push(sum / Math.max(count, 1));
    }
    return {width, height, grid};
  });
}
let browser;
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || undefined;
  browser = await playwright.chromium.launch({ headless:true, args:['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport:{ width:1280,height:780 }, locale:'zh-TW' });
  const failures = [];
  // Fresh mobile startup verifies actual native camera focus, not a desktop-derived viewport.
  const phone = await browser.newPage({ viewport:{width:390,height:844}, locale:'zh-TW' });
  phone.on('pageerror', error => failures.push('native-phone: ' + error.message));
  await phone.goto(base + '/pixel-office/index.html?hora=13', { waitUntil:'domcontentloaded' });
  await waitForNativeReady(phone);
  await waitForNativeViewport(phone,390,844);
  await waitForLighting(phone,13,0);
  const readPortraitCamera = async () => phone.evaluate(() => {
    const d = window.habblaud.world.debug;
    const c = d.camera;
    // Pinned native constants: COL_W=16, TILE=16, BUILDING_H=29.
    const fullZoom = c.fitZoom({x:0,y:0,w:d.sim.building.cols*16*16,h:29*16},16);
    const range = {left:c.x-c.viewW/(2*c.zoom),right:c.x+c.viewW/(2*c.zoom)};
    const room = id => d.sim.building.core.find(a=>a.id===id)?.rect;
    const visibleRoomShare = id => {
      const r=room(id); if(!r) return 0;
      const left=r.x*16,right=(r.x+r.w)*16;
      return Math.max(0,Math.min(range.right,right)-Math.max(range.left,left))/(range.right-range.left);
    };
    const visibleFeatureShare = (left,right) => Math.max(0,Math.min(range.right,right)-Math.max(range.left,left))/(right-left);
    const reception=room('core:recepcao');
    const x=reception?.x||0;
    return {
      zoom:c.zoom,fullZoom,cols:d.sim.building.cols,lang:document.documentElement.lang,
      visibleLeft:range.left,visibleRight:range.right,
      cafeShare:visibleRoomShare('core:copa'),restroomShare:visibleRoomShare('core:banheiros'),loungeShare:visibleRoomShare('core:lounge'),
      meetingVisible:visibleFeatureShare((x+8.5)*16,(x+15.5)*16),
    };
  });
  const cameraAudit = await readPortraitCamera();
  if (cameraAudit.lang !== 'zh-TW' || cameraAudit.zoom <= cameraAudit.fullZoom * 1.03) {
    throw new Error('Native phone does not start focused on the office, or is not zh-TW: ' + JSON.stringify(cameraAudit));
  }
  // Recheck after native safe-area observers settle, using camera state rather than a guessed delay.
  await waitForNativeViewport(phone,390,844);
  const stableCameraAudit = await readPortraitCamera();
  if (stableCameraAudit.lang !== 'zh-TW' || stableCameraAudit.zoom <= stableCameraAudit.fullZoom * 1.03) {
    throw new Error('Office closeup was lost after delayed HUD/topbar inset update: ' + JSON.stringify({initial:cameraAudit,stable:stableCameraAudit}));
  }
  // Visual quality target: work/cafe and lounge dominate, while the real meeting
  // room remains visible and the restroom is not the dominant room.
  if (stableCameraAudit.zoom < 1.13 || stableCameraAudit.cafeShare < 0.60 || stableCameraAudit.restroomShare > 0.40 ||
      stableCameraAudit.loungeShare < 0.60 || stableCameraAudit.meetingVisible < 0.75) {
    throw new Error('Portrait home frame must balance work/living space with a findable native meeting room: ' + JSON.stringify(stableCameraAudit));
  }
  console.log('PASS portrait composition audit ' + JSON.stringify(stableCameraAudit));
  const phoneShots = process.env.PIXEL_SCREENSHOT_DIR;
  if (phoneShots) {
    fs.mkdirSync(phoneShots,{recursive:true});
    await phone.screenshot({path:path.join(phoneShots,'pixel-p2-first-screen-day-390x844.png'),fullPage:false});
  }
  const dayLight = await readCanvasLuminanceGrid(phone);
  const dayLightingState = await phone.evaluate(() => window.habblaud.world.debug.lightingSnapshot());
  // Use a separate renderer at a fixed local hour. Wait for the actual renderer state
  // and pixels, not only for a URL parameter or a test-only CSS theme.
    await phone.goto(base + '/pixel-office/index.html?hora=23', {waitUntil:'domcontentloaded'});
    await waitForNativeReady(phone);
    await waitForNativeViewport(phone,390,844);
    await waitForLighting(phone,23,1);
    const nightLight = await readCanvasLuminanceGrid(phone);
    const nightLightingState = await phone.evaluate(() => window.habblaud.world.debug.lightingSnapshot());
    const luminanceDelta = dayLight.grid.reduce((sum, value, index) => sum + Math.abs(value - nightLight.grid[index]), 0) / dayLight.grid.length;
    if (!(dayLightingState.ambientNight < 0.03 && nightLightingState.ambientNight > 0.97 && luminanceDelta >= 5)) {
      throw new Error('Actual native day/night output is not perceptibly different: ' + JSON.stringify({dayLightingState,nightLightingState,luminanceDelta}));
    }
    if (phoneShots) await phone.screenshot({path:path.join(phoneShots,'pixel-p2-first-screen-night-390x844.png'),fullPage:false});
    console.log('PASS deterministic native day/night ' + JSON.stringify({dayLightingState,nightLightingState,luminanceDelta,canvas:[dayLight.width,dayLight.height]}));
  await phone.close();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/api/')) failures.push('HTTP ' + response.status() + ' ' + response.url());
  });
  await page.goto(base + '/', { waitUntil:'domcontentloaded' });
  const frame = await waitForNativeReady(page);
  await waitForNativeViewport(page,1280,780);
  const hud = await frame.locator('#zhuge-aios-hud').innerText();
  if (!hud.includes('Zhuge AI OS') || !hud.includes('待裁示')) throw new Error('HUD not rendered: ' + hud);
  // Desktop gets one orientation window, then a compact pill; the decision count
  // must remain visible and the same control must still expand/collapse manually.
  const hudRoot = frame.locator('#zhuge-aios-hud');
  if (await hudRoot.getAttribute('data-open') !== 'true') throw new Error('Desktop first entry should initially show the full status banner');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#zhuge-aios-hud')?.dataset.open === 'false', null, {timeout:9500});
  const bannerToggle = frame.locator('.zhuge-hud-menu-toggle');
  const decisionPill = frame.locator('.zhuge-hud-decision-pill');
  if (await hudRoot.getAttribute('data-open') !== 'false' || !await decisionPill.isVisible() || !await bannerToggle.isVisible()) {
    throw new Error('Auto-collapsed HUD must retain the decision pill and expansion control');
  }
  await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'true' || await bannerToggle.getAttribute('aria-label') !== '收合辦公室資訊') {
    throw new Error('Desktop status banner cannot be expanded again');
  }
  await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'false') throw new Error('Desktop status banner cannot be manually collapsed');
  await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'true') throw new Error('Desktop status banner cannot be manually reopened');
  await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'false') throw new Error('Desktop status banner did not remain dismissible after reopening');
  const rendered = await frame.locator('canvas#world').count();
  if (!rendered) throw new Error('real Habblaud world Canvas missing');
  const snapshot = await frame.locator('body').evaluate(() => {
    const s = (window).habblaud?.store?.snapshot;
    return { rooms:s?.rooms?.length || 0, agents:s?.agents?.length || 0, waiting:s?.agents?.filter(a=>a.status==='waiting').length||0 };
  });
  if (snapshot.rooms !== 1 || snapshot.agents !== 8 || snapshot.waiting !== 0) throw new Error('Static project status created people or changed work state: ' + JSON.stringify(snapshot));
  const localizedNativeControls = await frame.locator('body').evaluate(() => ({
    searchPlaceholder: document.querySelector('.ui-search__input')?.getAttribute('placeholder'),
    feedEmpty: document.querySelector('.ui-feed__empty')?.textContent?.trim(),
  }));
  if (localizedNativeControls.searchPlaceholder !== '搜尋角色、專案或帳號' ||
      localizedNativeControls.feedEmpty !== '已驗證的工程事件會依發生時間顯示於此。' ||
      /Buscar agente|Os eventos dos agentes/.test(JSON.stringify(localizedNativeControls))) {
    throw new Error('Native Habblaud high-visibility controls must be fully localized in zh-TW: ' + JSON.stringify(localizedNativeControls));
  }
  await frame.locator('button[aria-label="設定"]').click();
  await frame.locator('#ui-settings').waitFor({state:'visible',timeout:2000});
  const settingsText = await frame.locator('#ui-settings').innerText();
  if (!settingsText.includes('設定') || !settingsText.includes('外觀') || !settingsText.includes('語言') ||
      !settingsText.includes('日夜循環') || /Configurações|Aparência|Idioma|Ciclo dia\/noite/.test(settingsText)) {
    throw new Error('Settings surface is incomplete or not zh-TW: ' + settingsText);
  }
  await frame.locator('#ui-settings button[aria-label="關閉設定"]').click();
  await frame.locator('#ui-settings').waitFor({state:'hidden',timeout:2000});
  await frame.locator('button[aria-label="說明（?）"]').click();
  await frame.locator('dialog.ui-help[open]').waitFor({timeout:2000});
  const helpText = await frame.locator('dialog.ui-help').innerText();
  if (!helpText.includes('如何閱讀辦公室資訊') || !helpText.includes('狀態') || /Como ler o escritório|Trabalhando|Recebeu um pedido/.test(helpText)) {
    throw new Error('Help surface contains untranslated status/event text: ' + helpText);
  }
  await frame.locator('dialog.ui-help button[aria-label="關閉說明"]').click();
  await frame.locator('dialog.ui-help').waitFor({state:'hidden',timeout:2000});
  // Reopen the compact desktop capsule explicitly before testing its controls.
  // The collapsed state is intentionally sticky after its initial auto-dismiss.
  if (await hudRoot.getAttribute('data-open') !== 'true') await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'true') throw new Error('Status capsule did not expand for control verification');
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
  // #78: family residents and the cat are native idle residents, never AI workers.
  const family = await frame.locator('body').evaluate(() => {
    const s = window.habblaud?.store?.snapshot;
    const ids = ['zhuge-family-beidili', 'zhuge-family-anan', 'zhuge-family-kaka', 'zhuge-pet-blackgray-cat'];
    return ids.map(id => {
      const agent = (s?.agents || []).find(a => a.id === id);
      return agent ? { id: agent.id, name: agent.name, status: agent.status, provider: agent.provider, account: agent.account, resident: agent.zhugeResident, tasks: agent.tasks?.length || 0 } : null;
    });
  });
  if (family.some(a => !a || a.status !== 'idle' || a.provider !== undefined || a.account !== 'zhuge-family-cast' || !a.resident || a.tasks !== 0)) {
    throw new Error('P2 family/pet residents must remain non-worker idle characters: ' + JSON.stringify(family));
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
  // The resident roster is appended after the four fixed engineering roles;
  // keep this assertion pinned to Gem rather than assuming it is the last row.
  await frame.locator('.zhuge-role-roster button').nth(3).click();
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
  await bannerToggle.click();
  if (await hudRoot.getAttribute('data-open') !== 'false') throw new Error('Desktop status banner did not remain collapsible after panel checks');
  const classic = await frame.locator('#zhuge-aios-hud a').getAttribute('href');
  if (!classic?.endsWith('/status-classic.html')) throw new Error('classic route broken: ' + classic);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  // P0 removes the floating medal wall while preserving the original immutable data.
  const awards = await page.evaluate(() => ({
    wall: document.querySelector('#zgf-trophy-board, .zgf-awards, .zgf-medal'),
    records: window.ZhugeOfficeAwards,
    rack: document.querySelector('.zgf-rack'),
  }));
  if (awards.wall || !awards.rack || !Array.isArray(awards.records) || !['taskflow','worklog','investment','lab'].every(id => awards.records.some(item => item.id === id))) {
    throw new Error('Floating award wall must be absent while source records and the quick-link rack remain: ' + JSON.stringify({wall:!!awards.wall,records:awards.records?.map(item=>item.id),rack:!!awards.rack}));
  }
  const taskflow = await page.locator('.zgf-rack [data-zgf-work="taskflow"]').getAttribute('href');
  if (taskflow !== 'https://zhuge-taskflow-web.onrender.com/') throw new Error('TaskFlow medal points to wrong official hall: ' + taskflow);
  const worklog = await page.locator('.zgf-rack [data-zgf-work="worklog"]').getAttribute('href');
  const investment = await page.locator('.zgf-rack [data-zgf-work="investment"]').getAttribute('href');
  const classicQuickLink = await page.locator('.zgf-rack [data-zgf-work="classic"]').getAttribute('href');
  if (worklog !== base + '/modules/worklog/' || investment !== base + '/modules/investment/' || classicQuickLink !== base + '/status-classic.html') {
    throw new Error('Existing quick links resolve outside current Pages root: ' + worklog + ', ' + investment + ', ' + classicQuickLink);
  }
  if (await page.locator('.zgf-meeting, .zgf-door-art').count()) throw new Error('old floating meeting-room mock remains');
  await page.locator('.zgf-rack [data-zgf-pending="cockpit"]').click();
  const message = await page.locator('.zgf-toast:not([hidden])').innerText();
  if (!message.includes('連結待 PM 補充')) throw new Error('Unverified cockpit URL was not treated as pending');
  await page.locator('[data-zgf-pending="tools"]').click();
  if (!(await page.locator('.zgf-toast:not([hidden])').innerText()).includes('正式下載來源尚待驗證')) {
    throw new Error('TF-03 failed to disclose unavailable download');
  }
  await page.locator('.zgf-toast').evaluate(element => { element.hidden = true; });
  const shotDir = process.env.PIXEL_SCREENSHOT_DIR;
  if (shotDir) {
    fs.mkdirSync(shotDir, {recursive: true});
    await page.screenshot({path: path.join(shotDir, 'pixel-furnishings-desktop-1280.png'), fullPage: false});
  }
  for (const viewport of [{width:1440,height:900},{width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    await waitForNativeViewport(page,viewport.width,viewport.height);
    if (await page.locator('#zgf-trophy-board').count() || await frame.locator('canvas#world').count() !== 1) {
      throw new Error('desktop native office should keep the medal wall removed at ' + JSON.stringify(viewport));
    }
    if (shotDir) await page.screenshot({path: path.join(shotDir, `pixel-p2-71-desktop-${viewport.width}x${viewport.height}.png`), fullPage:false});
  }
  const tablet = await browser.newPage({viewport:{width:900,height:1200},locale:'zh-TW'});
  tablet.on('pageerror', error => failures.push('native-tablet: ' + error.message));
  await tablet.goto(base + '/', {waitUntil:'domcontentloaded'});
  const tabletFrameLocator = await waitForNativeReady(tablet);
  await waitForNativeViewport(tablet,900,1200);
  const tabletAudit = await tablet.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {x:r.x,right:r.right};
    };
    const d = document.querySelector('iframe')?.contentWindow?.habblaud?.world?.debug;
    const c = d?.camera;
    const reception = d?.sim?.building?.core?.find(a => a.id === 'core:recepcao');
    return {
      viewport:{width:innerWidth,height:innerHeight},
      scrollWidth:document.documentElement.scrollWidth,
      iframe:rect('iframe'),
      rack:rect('.zgf-rack'),
      camera:c && reception ? {
        zoom:c.zoom,
        portrait:c.viewH > c.viewW * 1.12,
        visibleLeft:c.x - c.viewW / (2 * c.zoom),
        visibleRight:c.x + c.viewW / (2 * c.zoom),
        meetingLeft:(reception.rect.x + 8.5) * 16,
        meetingRight:(reception.rect.x + 15.5) * 16,
      } : null,
    };
  });
  if (tabletAudit.viewport.width !== 900 || tabletAudit.scrollWidth > 901 ||
      !tabletAudit.iframe || tabletAudit.iframe.x < 0 || tabletAudit.iframe.right > 901 ||
      !tabletAudit.rack || tabletAudit.rack.x < 0 || tabletAudit.rack.right > 901 ||
      !tabletAudit.camera?.portrait || tabletAudit.camera.zoom < 1.13 ||
      tabletAudit.camera.visibleLeft > tabletAudit.camera.meetingLeft || tabletAudit.camera.visibleRight < tabletAudit.camera.meetingRight) {
    throw new Error('Portrait tablet must show the native meeting room and quick links in a legible, non-overflowing frame: ' + JSON.stringify(tabletAudit));
  }
  if (shotDir) await tablet.screenshot({path:path.join(shotDir,'pixel-p2-narrow-desktop-900x1200.png'),fullPage:false});
  await tablet.close();
  await page.setViewportSize({width:1280,height:780});
  await page.setViewportSize({width:390,height:844});
  await waitForNativeViewport(page,390,844);
  // Do not assert pixel-perfect zoom levels: use the real native renderer camera.
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
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-p0-mobile-390x844.png'), fullPage: false});
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
  await waitForNativeViewport(page,844,390);
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
  if (!landscapeCanvas || landscapeCanvas.width <= 0 || landscapeCanvas.height <= 0 ||
      !landscapeHud || landscapeHud.x < 0 || landscapeHud.y < 0 || landscapeHud.x + landscapeHud.width > 844 || landscapeHud.y + landscapeHud.height > 390 ||
      await page.locator('#zgf-trophy-board').count()) {
    throw new Error('Mobile landscape native scene or HUD is not visible, or floating medals returned: ' + JSON.stringify({landscapeCanvas,landscapeHud}));
  }
  const landscapeMenu = frame.locator('.zhuge-hud-menu-toggle');
  const landscapeMenuBox = await landscapeMenu.boundingBox();
  if (!landscapeMenuBox || await landscapeMenu.getAttribute('aria-expanded') !== 'false') {
    throw new Error('Short landscape viewport must use the collapsed HUD instead of clipping the long status bar');
  }
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'pixel-p2-mobile-landscape-844x390.png'), fullPage:false});
  await page.setViewportSize({width:1280,height:780});
  await page.goto(base + '/docs/index.html', { waitUntil:'domcontentloaded' });
  await waitForNativeReady(page);
  await waitForNativeViewport(page,1280,780);
  if (await page.locator('#zgf-trophy-board').count()) throw new Error('docs entry must also omit the floating medal wall');
  const docsWorklog = await page.locator('.zgf-rack [data-zgf-work="worklog"]').getAttribute('href');
  if (docsWorklog !== base + '/modules/worklog/') throw new Error('docs home shifted WorkLog to /docs/: ' + docsWorklog);
  if (failures.length) throw new Error('Browser errors: ' + failures.slice(0,8).join('; '));
  console.log('PASS native Habblaud P2 cast Jackal/GPT/Codex/Gem idle, zh-TW visible controls, static status is not people, weather contract unknown-state/manual-city/desktop-mobile, read-only project/PR panel, role dossier, medal records retained with no floating wall, balanced work/living with meeting room on portrait, stable ready-state day/night screenshots, compact landscape HUD, P1 links, classic and docs entry');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
