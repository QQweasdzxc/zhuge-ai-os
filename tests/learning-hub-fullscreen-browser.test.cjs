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
      bgFills: getComputedStyle(document.querySelector('.voyage-bg')).backgroundSize === '100% 100%'
    };
  });
  assert.equal(r.fullClass, true, 'desktop defaults to the fullscreen layout');
  assert.ok(r.stage.w >= 0.97 * r.iw || r.stage.h >= 0.97 * r.ih, 'map really fills the viewport, got ' + JSON.stringify(r.stage) + ' in ' + r.iw + 'x' + r.ih);
  assert.ok(Math.abs(r.aspect - 1672 / 941) < 0.02, 'stage keeps the art ratio so no island is cropped');
  assert.equal(r.bgFills, true, 'art covers the stage edge to edge without cover-cropping');
  assert.ok(r.chengyu && r.english && r.board, 'both island entries and the hero board stay inside the stage');
  assert.ok(r.links[0].includes('chengyu-quest-family.onrender.com') && r.links[1].includes('vocab-quest-family.onrender.com'), 'island entries keep their destinations');
  assert.ok(r.fitBtn && r.fsBtnVisible && r.chips, 'fullscreen controls and status chips are present');

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

  await page.click('#voyageFitBtn');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('voyage-full')), true, 'toggling back restores the fullscreen map');
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
