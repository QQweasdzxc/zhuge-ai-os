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
      noFitBtn: !document.getElementById('voyageFitBtn'), fsBtnVisible: !document.getElementById('voyageFsBtn').hidden,
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
  assert.ok(r.noFitBtn && r.fsBtnVisible && r.chips, 'no layout toggle remains; browser-fullscreen control and status chips are present');
  assert.ok(r.shellClip === 'clip' || r.shellClip === 'hidden', 'shell clips overflow so no programmatic scroll can crop the art, got ' + r.shellClip);
  assert.equal(r.shellScroll, 0, 'shell is never scrolled');
  assert.ok(r.stage.w >= r.iw && r.stage.h >= r.ih, 'capped cover fills the viewport edge to edge');
  assert.ok((r.stage.w - r.iw) / 2 / r.stage.w <= 0.095 && (r.stage.h - r.ih) / 2 / r.stage.h <= 0.095, 'cover crop stays within 9% per side');
  assert.ok(r.dbar && r.dbar.disp === 'flex' && r.dbar.top >= 0 && r.dbar.left >= 0, 'desktop hero card is pinned top-left');
  assert.equal(await page.evaluate(() => document.getElementById('profileChip')), null, 'duplicate dock hero entry is removed; the top-left hero card is the single desktop entry');
  assert.ok(r.dbar.coins !== undefined, 'hero card keeps the coins readout integrated');
  const cardChrome = await page.evaluate(() => {
    const tb = document.querySelector('.d-topbar'), pl = document.querySelector('.d-player'), cn = document.querySelector('.d-coins');
    return { tbBorder: getComputedStyle(tb).borderTopWidth, plBorder: getComputedStyle(pl).borderTopWidth, cnBorder: getComputedStyle(cn).borderTopWidth, tbBg: getComputedStyle(tb).backgroundColor, plBg: getComputedStyle(pl).backgroundColor };
  });
  assert.equal(cardChrome.tbBorder, '2px', 'the single visual hero card carries the border on the shared topbar');
  assert.equal(cardChrome.plBorder, '0px', 'player half is borderless inside the single card');
  assert.equal(cardChrome.cnBorder, '0px', 'coins half is borderless inside the single card');
  assert.notEqual(cardChrome.tbBg, 'rgba(0, 0, 0, 0)', 'single card has the shared background');
  assert.equal(r.dbar.name, '勇者', 'hero card guest name');
  assert.equal(r.dbar.lv, '訪客', 'adventure card guest level');
  assert.ok(r.chipTop >= r.dbar.bottom - 1, 'island title chip sits below the adventure card');
  const hot = await page.evaluate(() => ['#islandChengyu', '#islandEnglish', '#heroBoardBtn'].map(id => { const e = document.querySelector(id).getBoundingClientRect(); return { l: e.left, r: e.right, t: e.top, b: e.bottom } }));
  assert.ok(hot.every(e => e.l >= -1 && e.r <= 1280 + 1 && e.t >= -1 && e.b <= 800 + 1), 'all island entries stay inside the viewport under capped cover: ' + JSON.stringify(hot));

  assert.equal(await page.evaluate(() => document.getElementById('voyageFitBtn')), null, 'layout toggle is gone: desktop is always the adaptive map');
  const boatD = await page.evaluate(() => {
    const b = document.getElementById('boatShopBtn'); if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), inView: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, w: Math.round(r.width), h: Math.round(r.height) };
  });
  assert.ok(boatD && boatD.inView && boatD.w > 40 && boatD.h > 40, 'boat shop entry visible with a tappable area at 1280x800: ' + JSON.stringify(boatD));
  assert.ok(boatD.text.includes('商船'), 'boat carries the 商船 sign');
  assert.equal(await page.evaluate(() => document.getElementById('shopChip')), null, 'standalone dock shop chip is consolidated into the boat entry');
  await page.click('#boatShopBtn');
  assert.equal(await page.evaluate(() => !document.getElementById('shopDrawer').hidden), true, 'tapping the boat opens the existing shop drawer');
  await page.evaluate(() => document.getElementById('shopClose').click());
  assert.equal(await page.evaluate(() => document.getElementById('shopDrawer').hidden), true, 'shop drawer closes again');

  await page.evaluate(() => localStorage.setItem('voyage-desktop-layout', 'boxed'));
  await page.reload();
  await page.waitForSelector('.voyage-shell');
  await page.evaluate(() => { document.querySelectorAll('.player-gate, #overlay, .hb-overlay, .drawer').forEach(e => { e.hidden = true; e.style.display = 'none' }); });
  const legacy = await page.evaluate(() => ({
    full: document.documentElement.classList.contains('voyage-full'),
    stored: localStorage.getItem('voyage-desktop-layout'),
    fitBtn: !!document.getElementById('voyageFitBtn'),
    fsBtnVisible: !document.getElementById('voyageFsBtn').hidden
  }));
  assert.equal(legacy.full, true, 'a stale boxed preference no longer traps the desktop in the boxed layout');
  assert.equal(legacy.stored, null, 'stale layout preference is cleared');
  assert.equal(legacy.fitBtn, false, 'layout toggle stays removed after reload');
  assert.equal(legacy.fsBtnVisible, true, 'browser-fullscreen control remains');
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
      fitHidden: !document.getElementById('voyageFitBtn'),
      boatInView: (() => { const b = document.getElementById('boatShopBtn'); if (!b) return false; const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 })(),
      noShopEntries: !document.getElementById('shopChip') && !document.getElementById('mShopBtn'),
      noFullClass: !document.documentElement.classList.contains('voyage-full'),
      noScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
  assert.deepEqual(r, { shellFixed: true, shellFull: true, chengyu: true, english: true, fitHidden: true, boatInView: true, noShopEntries: true, noFullClass: true, noScroll: true });
});

test('cover crop is biased toward the bottom and long names ellipsis in the adventure card', async t => {
  const { browser, page } = await openHub(1440, 700);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const st = document.querySelector('.voyage-stage');
    const strong = document.querySelector('.d-pinfo strong');
    return {
      transform: st.style.transform, w: parseFloat(st.style.width), h: parseFloat(st.style.height),
      iw: innerWidth, ih: innerHeight, full: document.documentElement.classList.contains('voyage-full'),
      ellip: getComputedStyle(strong).textOverflow, nowrap: getComputedStyle(strong).whiteSpace
    };
  });
  assert.equal(r.full, true, 'desktop fullscreen layout active');
  assert.ok(r.h > r.ih, 'this fixture viewport needs vertical crop, got ' + JSON.stringify(r));
  const expect = Math.min((r.h - r.ih) * 0.2, Math.max((r.ih - r.h) / 2, (r.h + r.ih) / 2 - Math.min(r.h, r.h * 0.97)));
  const got = parseFloat(r.transform.match(/translateY\((-?[\d.]+)px\)/)?.[1] || '0');
  assert.ok(Math.abs(got - expect) < 1, 'crop keeps the boat band visible (top takes the extra crop), got transform=' + r.transform + ' expected ~' + expect.toFixed(1));
  const boat = await page.evaluate(() => { const b = document.getElementById('boatShopBtn').getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, iw: innerWidth, ih: innerHeight } });
  assert.ok(boat.l >= -1 && boat.r <= boat.iw + 1 && boat.t >= -1 && boat.t <= boat.ih - 60, 'boat shop entry stays visible and tappable at 1440x700: ' + JSON.stringify(boat));
  assert.equal(r.ellip, 'ellipsis', 'long adventurer names ellipsis instead of overflowing');
  assert.equal(r.nowrap, 'nowrap');
});
