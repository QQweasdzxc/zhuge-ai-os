const test = require('node:test'), assert = require('node:assert/strict'), path = require('path');
const { chromium } = require('playwright');
const { fixtureURL, resolveBrowserExecutable } = require('./browser-executable');

const HUB = path.resolve(__dirname, '../apps/learning-archipelago/site/index.html');

async function openHub(width, height) {
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*.supabase.co/**', r => r.abort());
  await page.goto(await fixtureURL(HUB));
  await page.waitForSelector('.voyage-shell');
  await page.evaluate(() => {
    document.querySelectorAll('.player-gate, #overlay, .hb-overlay, .drawer').forEach(e => { e.hidden = true; e.style.display = 'none'; });
  });
  return { browser, page };
}

test('desktop hub defaults to a viewport-filling uncropped map with live island entries and a restore control', async t => {
  const { browser, page } = await openHub(1280, 800);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const s = document.querySelector('.voyage-stage').getBoundingClientRect();
    const inside = id => {
      const e = document.querySelector(id).getBoundingClientRect();
      return e.width > 4 && e.left >= s.left - 1 && e.right <= s.right + 1 && e.top >= s.top - 1 && e.bottom <= s.bottom + 1;
    };
    return {
      fullClass: document.documentElement.classList.contains('voyage-full'),
      stage: { w: s.width, h: s.height }, iw: innerWidth, ih: innerHeight,
      aspect: s.width / s.height,
      chengyu: inside('#islandChengyu'), english: inside('#islandEnglish'), board: inside('#heroBoardBtn'),
      links: [document.getElementById('islandChengyu').href, document.getElementById('islandEnglish').href],
      fitBtn: !!document.getElementById('voyageFitBtn'), fsBtnVisible: !document.getElementById('voyageFsBtn').hidden,
      chips: ['.stage-chip-title', '.stage-chip-status', '.stage-chip-hint'].every(q => { const e = document.querySelector(q); return e && e.getBoundingClientRect().width > 0 }),
      bgFills: getComputedStyle(document.querySelector('.voyage-bg')).backgroundSize === '100% 100%',
      shellClip: getComputedStyle(document.querySelector('.voyage-shell')).overflowY,
      shellScroll: document.querySelector('.voyage-shell').scrollLeft + document.querySelector('.voyage-shell').scrollTop,
      chipTop: document.querySelector('.stage-chip-title').getBoundingClientRect().top,
      dbar: (() => { const d = document.querySelector('.d-topbar'); if (!d) return null; const cs = getComputedStyle(d), b = d.getBoundingClientRect(); return { disp: cs.display, bottom: b.bottom, left: b.left, top: b.top, name: document.getElementById('dName').textContent, lv: document.getElementById('dLv').textContent, coins: document.getElementById('dCoinsN').textContent, xp: document.getElementById('dXpFill').style.width } })()
    };
  });
  assert.equal(r.fullClass, true, 'desktop defaults to the fullscreen layout');
  assert.ok(r.stage.w >= 0.97 * r.iw || r.stage.h >= 0.97 * r.ih, 'map really fills the viewport, got ' + JSON.stringify(r.stage) + ' in ' + r.iw + 'x' + r.ih);
  assert.ok(Math.abs(r.aspect - 1672 / 941) < 0.02, 'stage keeps the art ratio so no island is cropped');
  assert.equal(r.bgFills, true, 'art covers the stage edge to edge without cover-cropping');
  assert.ok(r.chengyu && r.english && r.board, 'both island entries and the hero board stay inside the stage');
  assert.ok(r.links[0].includes('chengyu-quest-family.onrender.com') && r.links[1].includes('vocab-quest-family.onrender.com'), 'island entries keep their destinations');
  assert.ok(r.fitBtn && r.fsBtnVisible && r.chips, 'fullscreen controls and status chips are present');
  assert.ok(r.shellClip === 'clip' || r.shellClip === 'hidden', 'shell clips overflow so no programmatic scroll can crop the art, got ' + r.shellClip);
  assert.equal(r.shellScroll, 0, 'shell is never scrolled');
  assert.ok(r.stage.w >= r.iw && r.stage.h >= r.ih, 'capped cover fills the viewport edge to edge');
  assert.ok((r.stage.w - r.iw) / 2 / r.stage.w <= 0.095 && (r.stage.h - r.ih) / 2 / r.stage.h <= 0.095, 'cover crop stays within 9% per side');
  assert.ok(r.dbar && r.dbar.disp === 'flex' && r.dbar.top >= 0 && r.dbar.left >= 0, 'desktop adventure card is pinned top-left');
  assert.equal(r.dbar.name, '冒險者', 'adventure card guest name');
  assert.equal(r.dbar.lv, '訪客', 'adventure card guest level');
  assert.ok(r.chipTop >= r.dbar.bottom - 1, 'island title chip sits below the adventure card');
  const hot = await page.evaluate(() => ['#islandChengyu', '#islandEnglish', '#heroBoardBtn'].map(id => { const e = document.querySelector(id).getBoundingClientRect(); return { l: e.left, r: e.right, t: e.top, b: e.bottom } }));
  assert.ok(hot.every(e => e.l >= -1 && e.r <= 1280 + 1 && e.t >= -1 && e.b <= 800 + 1), 'all island entries stay inside the viewport under capped cover: ' + JSON.stringify(hot));

  await page.click('#voyageFitBtn');
  const boxed = await page.evaluate(() => ({
    full: document.documentElement.classList.contains('voyage-full'),
    w: document.querySelector('.voyage-stage').getBoundingClientRect().width,
    iw: innerWidth,
    stored: localStorage.getItem('voyage-desktop-layout')
  }));
  assert.equal(boxed.full, false, 'restore leaves the fullscreen layout');
  assert.ok(boxed.w < boxed.iw * 0.97, 'restored layout is the original boxed map');
  assert.equal(boxed.stored, 'boxed', 'restore choice is remembered');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.d-topbar')).display), 'none', 'adventure card is fullscreen-only');
  assert.equal(await page.evaluate(() => document.querySelector('.voyage-stage').style.width), '', 'boxed mode clears the cover sizing');

  await page.click('#voyageFitBtn');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('voyage-full')), true, 'toggling back restores the fullscreen map');
});

test('extreme aspect ratios fall back to the uncropped fit instead of over-cropping', async t => {
  const { browser, page } = await openHub(1100, 1000);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const s = document.querySelector('.voyage-stage').getBoundingClientRect();
    return { inline: document.querySelector('.voyage-stage').style.width, w: s.width, h: s.height, iw: innerWidth, ih: innerHeight };
  });
  assert.equal(r.inline, '', 'fit fallback uses CSS sizing, no cover override');
  assert.ok(r.w <= r.iw + 1 && r.h <= r.ih + 1, 'fit keeps the whole stage inside the viewport');
  assert.ok(Math.abs(r.w / r.h - 1672 / 941) < 0.02, 'fit keeps the art ratio');
});

test('mobile hub keeps its existing fullscreen portrait map and gets no desktop controls', async t => {
  const { browser, page } = await openHub(390, 844);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const sh = document.querySelector('.voyage-shell');
    const rect = sh.getBoundingClientRect();
    const s = document.querySelector('.voyage-stage').getBoundingClientRect();
    const inside = id => { const e = document.querySelector(id).getBoundingClientRect(); return e.width > 4 && e.left >= s.left - 1 && e.right <= s.right + 1; };
    return {
      shellFixed: getComputedStyle(sh).position === 'fixed',
      shellFull: rect.width >= innerWidth - 1 && rect.height >= innerHeight - 1,
      chengyu: inside('#islandChengyu'), english: inside('#islandEnglish'),
      fitHidden: getComputedStyle(document.getElementById('voyageFitBtn')).display === 'none',
      noFullClass: !document.documentElement.classList.contains('voyage-full'),
      noScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
  assert.deepEqual(r, { shellFixed: true, shellFull: true, chengyu: true, english: true, fitHidden: true, noFullClass: true, noScroll: true });
});
