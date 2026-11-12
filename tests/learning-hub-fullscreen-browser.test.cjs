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
  assert.ok(r.stage.w <= r.iw + 1 && r.stage.h <= r.ih + 1, 'whole map stays inside the viewport, no side is cropped: ' + JSON.stringify(r.stage) + ' in ' + r.iw + 'x' + r.ih);
  assert.ok(r.stage.w >= 0.97 * r.iw || r.stage.h >= 0.97 * r.ih, 'map still spans the viewport edge to edge in at least one dimension');
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
  assert.ok(hot.every(e => e.l >= -1 && e.r <= 1280 + 1 && e.t >= -1 && e.b <= 800 + 1), 'all island entries stay inside the viewport with the whole map visible: ' + JSON.stringify(hot));

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

test('any viewport ratio keeps the whole map visible with no crop and no inline sizing', async t => {
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
  const deck = await page.evaluate(() => {
    const R = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right } };
    return { stage: R('.voyage-stage'), boat: R('#boatShopBtn'), face: R('.m-face'), hud: R('.m-hud'), tasks: R('#mTasksBtn'), iw: innerWidth, ih: innerHeight };
  });
  assert.ok(Math.abs(deck.stage.t) < 1 && Math.abs(deck.stage.b - Math.min(1.7768 * deck.iw, deck.ih)) < 2, 'portrait art plane is top-anchored at its native ratio, HUD deck below: ' + JSON.stringify(deck.stage));
  assert.ok(deck.boat.b <= deck.face.t + 1, 'boat entry fully clears the avatar/HUD zone: ' + JSON.stringify(deck));
  assert.ok(deck.face.b <= deck.ih - 8, 'hero avatar no longer flush against the window edge: ' + JSON.stringify(deck.face));
  assert.ok(deck.boat.r <= deck.tasks.l + 1, 'boat entry does not collide with the tasks button: ' + JSON.stringify(deck));
  assert.ok(deck.boat.t >= deck.stage.t - 1 && deck.boat.b <= deck.stage.b + 2, 'boat entry stays on the art plane');
});


test('sign chips match the in-art wooden signs, nails stay clear of text, and the map never double-tap zooms', async t => {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const { browser, page } = await openHub(w, h);
    t.after(() => browser.close());
    const r = await page.evaluate(() => {
      const cs = (el, pseudo) => getComputedStyle(el, pseudo);
      const signs = [...document.querySelectorAll('.voyage-sign')].map(sign => {
        const s = sign.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(sign);
        const t = range.getBoundingClientRect();
        const before = cs(sign, '::before');
        const nw = parseFloat(before.width), nl = parseFloat(before.left), nt = parseFloat(before.top);
        const leftNail = { l: s.left + nl, r: s.left + nl + nw, t: s.top + nt, b: s.top + nt + nw };
        const rightNail = { l: s.right - nl - nw, r: s.right - nl, t: s.top + nt, b: s.top + nt + nw };
        const overlap = n => !(n.r <= t.left || n.l >= t.right || n.b <= t.top || n.t >= t.bottom);
        return { label: sign.textContent.trim(), border: parseFloat(cs(sign).borderTopWidth), nail: nw,
          clear: !overlap(leftNail) && !overlap(rightNail) };
      });
      return {
        taShell: cs(document.querySelector('.voyage-shell')).touchAction,
        taStage: cs(document.querySelector('.voyage-stage')).touchAction,
        taHot: cs(document.querySelector('.voyage-hot')).touchAction,
        signs
      };
    });
    assert.equal(r.taShell, 'manipulation', 'shell blocks double-tap zoom at ' + w);
    assert.equal(r.taStage, 'manipulation', 'stage blocks double-tap zoom at ' + w);
    assert.equal(r.taHot, 'manipulation', 'entries block double-tap zoom at ' + w);
    assert.ok(r.signs.length >= 2, 'both board signs present at ' + w + ': ' + JSON.stringify(r.signs));
    for (const s of r.signs) {
      assert.ok(s.border <= 2.5, s.label + ' thin frame like the in-art signs: ' + JSON.stringify(s));
      assert.ok(s.nail <= 4.5, s.label + ' small nails: ' + JSON.stringify(s));
      assert.ok(s.clear, s.label + ' nails clear of glyphs: ' + JSON.stringify(s));
    }
  }
});

test('wide viewport keeps the whole map visible without crop and long names ellipsis in the adventure card', async t => {
  const { browser, page } = await openHub(1440, 700);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const st = document.querySelector('.voyage-stage');
    const sr = st.getBoundingClientRect();
    const strong = document.querySelector('.d-pinfo strong');
    return {
      transform: st.style.transform, inlineW: st.style.width, w: sr.width, h: sr.height,
      iw: innerWidth, ih: innerHeight, full: document.documentElement.classList.contains('voyage-full'),
      ellip: getComputedStyle(strong).textOverflow, nowrap: getComputedStyle(strong).whiteSpace
    };
  });
  assert.equal(r.full, true, 'desktop fullscreen layout active');
  assert.equal(r.inlineW, '', 'no inline cover sizing overrides the CSS contain fit');
  assert.equal(r.transform, '', 'no cover-bias transform remains');
  assert.ok(r.w <= r.iw + 1 && r.h <= r.ih + 1, 'wide viewport keeps the whole art inside, left and right edges never cropped: ' + JSON.stringify(r));
  assert.ok(Math.abs(r.w / r.h - 1672 / 941) < 0.02, 'stage keeps the art ratio at wide viewports');
  assert.ok(r.h >= 0.97 * r.ih || r.w >= 0.97 * r.iw, 'map still spans the viewport in one dimension: ' + JSON.stringify(r));
  const boat = await page.evaluate(() => { const b = document.getElementById('boatShopBtn').getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, iw: innerWidth, ih: innerHeight } });
  assert.ok(boat.l >= -1 && boat.r <= boat.iw + 1 && boat.t >= -1 && boat.t <= boat.ih - 60, 'boat shop entry stays visible and tappable at 1440x700: ' + JSON.stringify(boat));
  assert.equal(r.ellip, 'ellipsis', 'long adventurer names ellipsis instead of overflowing');
  assert.equal(r.nowrap, 'nowrap');
});

test('desktop 1280x800 shows the whole shared role poster without scrolling', async t => {
  const { browser, page } = await openHub(1280, 800);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const ov = document.getElementById('overlay');
    const dlg = document.getElementById('dialog');
    ov.style.display = '';
    dlg.classList.add('poster-dialog');
    ov.dataset.mode = 'rolePoster';
    dlg.innerHTML = '<div class="poster-scene shared-role-scene" data-appearance="boy"><img class="poster-art shared-master-art" src="' + window.ARCHIPELAGO_SHARED_MASTER + '"><button class="poster-hotspot role-ranger"></button><button class="poster-hotspot role-guardian"></button><button class="poster-hotspot poster-accept"></button></div>';
    ov.hidden = false;
    const dr = dlg.getBoundingClientRect();
    const scene = dlg.querySelector('.shared-role-scene').getBoundingClientRect();
    const accept = dlg.querySelector('.poster-accept').getBoundingClientRect();
    const guardian = dlg.querySelector('.role-guardian').getBoundingClientRect();
    return { dw: dr.width, sh: scene.height, ih: innerHeight, pageScroll: document.documentElement.scrollHeight, sceneTop: scene.top, acceptBottom: accept.bottom, guardianBottom: guardian.bottom };
  });
  assert.ok(r.dw > 400, 'poster has a real width (layout actually applied): ' + JSON.stringify(r));
  assert.ok(r.sh <= r.ih - 8 && r.sceneTop >= 0 && r.sceneTop + r.sh <= r.ih + 1, 'whole poster fits the viewport without scrolling: ' + JSON.stringify(r));
  assert.ok(r.guardianBottom <= r.ih && r.acceptBottom <= r.ih, 'ranger/guardian cards and the accept button are on screen: ' + JSON.stringify(r));
  assert.ok(r.pageScroll <= r.ih, 'no page scroll at 1280x800: ' + JSON.stringify(r));
});

test('mobile gap below the art continues the ocean scene instead of a flat band', async t => {
  const { browser, page } = await openHub(390, 844);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const shell = document.querySelector('.voyage-shell');
    const cs = getComputedStyle(shell, '::before');
    const ov = getComputedStyle(shell, '::after');
    const stage = document.querySelector('.voyage-stage').getBoundingClientRect();
    return {
      content: cs.content, bg: cs.backgroundImage, transform: cs.transform, repeat: cs.backgroundRepeat,
      top: parseFloat(cs.top), bottom: parseFloat(cs.bottom),
      stageB: stage.bottom, ih: innerHeight, iw: innerWidth,
      shellOverflow: getComputedStyle(shell).overflowY,
      filter: cs.filter, mask: cs.maskImage || cs.webkitMaskImage,
      overlay: ov.backgroundImage, overlayTop: parseFloat(ov.top)
    };
  });
  assert.ok(r.content !== 'none' && r.content !== 'normal', 'continuation layer exists below the art');
  assert.ok(r.bg.includes('1-6-archipelago-balanced-20261109.webp'), 'continuation reuses the same ocean art, got ' + r.bg);
  assert.ok(/matrix\(1, 0, 0, -1/.test(r.transform), 'continuation is vertically mirrored for a seamless water join: ' + r.transform);
  assert.equal(r.repeat, 'no-repeat', 'single mirrored slice, no tiling artifacts');
  assert.ok(Math.abs(r.top - Math.min(1.7768 * r.iw, r.ih)) < 2, 'continuation starts exactly at the art bottom: ' + JSON.stringify(r));
  assert.ok(Math.abs(r.bottom) < 1 && r.ih - r.top > 20, 'continuation fills from the art bottom to the window bottom: ' + JSON.stringify(r));
  assert.ok(r.shellOverflow === 'hidden' || r.shellOverflow === 'clip', 'shell clips the mirrored layer');
  assert.ok(r.filter === 'none', 'mirrored slice keeps the art unfiltered so the join has no seam line: ' + r.filter);
  assert.ok(r.mask.includes('linear-gradient'), 'mirrored slice fades out before deep-sea rows: ' + r.mask);
  assert.ok(/linear-gradient\(rgb\(0, 0, 0\).*rgba\(0, 0, 0, 0\)/.test(r.mask), 'mirrored slice fades to fully transparent below the join band: ' + r.mask);
  assert.ok(r.overlay.includes('linear-gradient'), 'deep-sea gradient overlay sinks the mirrored scene into depth: ' + r.overlay);
  assert.ok(r.overlayTop === r.top, 'gradient overlay covers the same continuation band');
});


test('hero profile drawer links both islands original settings pages with identity carried', async t => {
  const { browser, page } = await openHub(1280, 800);
  t.after(() => browser.close());
  const r = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('#profileDrawer .drawer-section')].find(s => s.textContent.includes('設定與聲音'));
    const c = document.getElementById('settingsChengyuLink'), e = document.getElementById('settingsEnglishLink');
    return { hasSec: !!sec, c: c?.href || '', e: e?.href || '',
      subtitle: (document.querySelector('meta[name=description]')?.content || '').includes('同一位勇者'),
      oldSub: document.documentElement.innerHTML.includes('同一位勇士'),
      trial: document.body.innerHTML.includes('勇者試煉批改中'), oldTrial: document.documentElement.innerHTML.includes('勇士試煉批改中') };
  });
  assert.ok(r.hasSec, '勇者檔案 drawer has a 設定與聲音 section');
  assert.ok(r.c.includes('chengyu-quest-family.onrender.com') && r.c.includes('s=settings'), 'chengyu settings link carries s=settings, got ' + r.c);
  assert.ok(r.e.includes('vocab-quest-family.onrender.com') && r.e.includes('s=settings'), 'vocab settings link carries s=settings, got ' + r.e);
  assert.ok(r.subtitle && !r.oldSub, 'map subtitle calls the player 同一位勇者');
  assert.ok(r.trial && !r.oldTrial, 'grading dialog calls it 勇者試煉');
});
