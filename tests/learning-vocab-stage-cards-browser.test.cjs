const test = require('node:test'), assert = require('node:assert/strict'), path = require('path');
const { chromium } = require('playwright');
const { fixtureURL, resolveBrowserExecutable } = require('./browser-executable');

const VOCAB = path.resolve(__dirname, '../apps/vocab-quest/site/index.html');
// Internally consistent fixtures: total equals the sum of per-stage stars.
const STARS_A = {
  ok: true, total: 3, stagePassed: [1], villageExamUnlocked: false, villagePassed: false,
  stages: [1, 2, 3, 4, 5, 6, 7].map(z => ({ zone: z, stars: z === 1 ? 2 : z === 2 ? 1 : 0, diverse_words: z === 1 ? 2 : 0, pass_days: z === 1 ? 2 : 0, first_star: z <= 2 }))
};
const STARS_B = {
  ok: true, total: 3, stagePassed: [1, 2], villageExamUnlocked: false, villagePassed: false,
  stages: [1, 2, 3, 4, 5, 6, 7].map(z => ({ zone: z, stars: z === 1 ? 2 : z === 2 ? 1 : 0, diverse_words: z === 1 ? 2 : 0, pass_days: z === 1 ? 2 : 0, first_star: z <= 2 }))
};
const EXAM = { ok: true, exam: { id: 'e1', questions: Array.from({ length: 10 }, (_, i) => ({ stem: '測驗題' + (i + 1), choices: ['甲', '乙', '丙', '丁'] })) } };
let CURRENT = STARS_A;

async function openVocab(width, height) {
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*.supabase.co/**', route => {
    let action = '';
    try { action = route.request().postDataJSON()?.action || ''; } catch (e) {}
    if (action === 'getStageStars') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(CURRENT) });
    if (action === 'startStageExam') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(EXAM) });
    return route.abort();
  });
  await page.goto((await fixtureURL(VOCAB)) + '#f=' + 'a'.repeat(41) + '&p=' + encodeURIComponent('測試'));
  await page.evaluate(() => { document.querySelectorAll('.player-gate, #playerGate, #vocabPlayerGate').forEach(e => { e.hidden = true; e.style.display = 'none'; }); });
  // A selected adventurer, then the real sync pipeline paints stars into the cards.
  await page.evaluate(() => {
    window.vocabProgressState = () => ({ learners: [{ id: 'hero1', name: '測試勇士', xp: 120 }], attempts: [], selectedId: 'hero1' });
    return window.learningStarsRefresh(true);
  });
  await page.waitForSelector('.village-grid .village-card', { timeout: 15000 });
  return { browser, page };
}

async function readPanel(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.village-grid .village-card')];
    const at = n => cards.find(c => c.querySelector('strong')?.textContent.includes('第 ' + n + ' 關'));
    return {
      count: cards.length,
      grids: document.querySelectorAll('.village-grid').length,
      title: document.querySelector('.village-panel h2')?.textContent || '',
      help: document.querySelector('.village-help')?.textContent || '',
      card1: at(1)?.textContent || '',
      card2: at(2)?.textContent || '',
      card3: at(3)?.textContent || '',
      card1exam: at(1)?.querySelector('[data-stage-exam]')?.textContent || null,
      card2exam: at(2)?.querySelector('[data-stage-exam]')?.textContent || null,
      card3exam: at(3) ? !!at(3).querySelector('[data-stage-exam]') : null,
      card3practice: at(3) ? at(3).hasAttribute('data-village-stage') : null,
      card3state: at(3)?.querySelector('.village-state')?.textContent || null,
      pagerInViewDyn: (() => { const pg = document.getElementById('villagePager'); if (!pg || pg.hidden) return true; const r = pg.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })(),
      demoLayout: cards.every(c => c.querySelector('.village-main') && c.querySelector('.village-side')) && cards.filter(c => !c.classList.contains('village-final')).every(c => c.querySelector('.village-side .village-stars')),
      lockedCards: cards.filter(c => c.classList.contains('village-locked')).length,
      lockedWithButtons: cards.filter(c => c.classList.contains('village-locked') && c.querySelector('button')).length,
      final: cards.find(c => c.classList.contains('village-final'))?.textContent || '',
      finalBtn: !!cards.find(c => c.classList.contains('village-final') && c.querySelector('button')),
      disabledExamButtons: [...document.querySelectorAll('.village-panel button:disabled:not([data-vpage])')].length,
      pager: document.getElementById('villagePager')?.hidden,
      pagerDisplay: (pg => pg ? getComputedStyle(pg).display : null)(document.getElementById('villagePager')),
      visibleCards: [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide')).length,
      noWideScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
}

test('vocab stage cards are state-driven with PASS marks, short labels and rules in 說明', async t => {
  CURRENT = STARS_A;
  const { browser, page } = await openVocab(1280, 900);
  t.after(() => browser.close());
  // The fixture has no valid family token, so the offline sync banner shows; a healthy
  // connected family never renders it. Remove it and repaint so geometry matches production.
  await page.evaluate(() => { document.querySelector('.app-sync-issue')?.remove(); window.vocabVillageRepaint?.(); });
  await page.waitForTimeout(300);
  const r = await readPanel(page);
  assert.equal(r.count, 8, 'seven stage cards plus the village-exam card in one grid');
  assert.equal(r.grids, 1, 'one grid, no stacked exam-button panel');
  assert.match(r.title, /新手村集星 3 \/ 21/, 'total equals the sum of stage stars');
  assert.match(r.help, /達90%開下一關/, 'rules move into 說明');
  assert.match(r.card1, /PASS/, 'passed stage carries a PASS mark');
  assert.equal(r.card1exam, '再測一次', 'passed stage keeps a small retake link');
  assert.equal(r.card2exam, '總結測驗', 'earned exam entry uses the short compact label');
  assert.ok(r.demoLayout, 'cards use the compact demo anatomy: main column + side stars');
  assert.equal(r.card3exam, false, 'locked stage has no exam button');
  assert.ok(r.lockedCards >= 5, 'stages 3-7 sit locked behind stage 2');
  assert.equal(r.lockedWithButtons, 0, 'locked cards show no disabled long-text buttons');
  assert.match(r.final, /集滿 21 星開放/, 'village exam card states the unlock condition');
  assert.doesNotMatch(r.final, /90 分通過/, 'card face drops the passing score (rule stays in 說明)');
  assert.match(r.help, /出村大考驗：集滿21星開放，90分通過。/, '說明 keeps the passing-score rule');
  assert.match(r.final, /目前集星 3 \/ 21/, 'village exam card shows live progress');
  assert.equal(r.finalBtn, false, 'village exam button only appears when unlocked');
  assert.equal(r.disabledExamButtons, 0, 'no disabled buttons anywhere in the panel');
  assert.ok(r.visibleCards >= 6, 'desktop shows at least six cards per page, got ' + r.visibleCards);
  assert.ok(r.pagerInViewDyn, 'when a desktop pager is needed it stays in the viewport');
  assert.ok(r.noWideScroll);

  // The in-card exam entry drives the real exam flow.
  await page.click('.village-card [data-stage-exam="2"]');
  await page.waitForSelector('.village-exam:not([hidden])');
  const modal = await page.evaluate(() => document.querySelector('.village-exam').textContent);
  assert.match(modal, /第 2 關總結測驗/);
  assert.match(modal, /第 1 \/ 10 題/);
  await page.click('.village-exam [data-village-close]');
});

test('an unlocked unpracticed stage is tappable for practice and shows no exam entry', async t => {
  CURRENT = STARS_B;
  const { browser, page } = await openVocab(1280, 900);
  t.after(() => browser.close());
  const r = await readPanel(page);
  assert.equal(r.card3practice, true, 'the stage 3 card itself is the practice entry');
  assert.equal(r.card3exam, false, 'no exam button before the first star');
  assert.match(r.card3state, /挑戰中/, 'one short status line, no long explanation');
  assert.doesNotMatch(r.card3, /先完成本關練習取得第 1 星/, 'no long hint paragraph on the card face');
  assert.match(r.card1, /PASS/);
  assert.match(r.card2, /PASS/);
});

test('phone uses an explicit pager instead of a long two-column list', async t => {
  CURRENT = STARS_B;
  const { browser, page } = await openVocab(390, 844);
  t.after(() => browser.close());
  const r = await readPanel(page);
  assert.equal(r.pager, false, 'phone shows the pager');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('villagePager')).display), 'flex', 'phone computed style shows the pager');
  const fit = await page.evaluate(() => {
    const pg = document.getElementById('villagePager');
    const pgr = pg.getBoundingClientRect();
    const vis = [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide'));
    const lastBottom = Math.max(...vis.map(c => c.getBoundingClientRect().bottom));
    return { visCount: vis.length, pagerInView: pgr.top >= 0 && pgr.bottom <= innerHeight + 1, cardsAbovePager: lastBottom <= pgr.top + 1, ih: innerHeight, pagerBottom: pgr.bottom };
  });
  assert.ok(fit.visCount >= 1 && fit.visCount < 8, 'phone paginates a measured number of cards: ' + JSON.stringify(fit));
  assert.ok(fit.pagerInView, 'pager controls stay inside the phone viewport without scrolling: ' + JSON.stringify(fit));
  assert.ok(fit.cardsAbovePager, 'cards never slide under the pager');
  assert.ok(r.noWideScroll);
  await page.click('#villagePager [data-vpage="1"]');
  const pg2 = await page.evaluate(() => {
    const pg = document.getElementById('villagePager');
    return { page: document.querySelector('#villagePager span').textContent, vis: [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide')).length, pagerInView: pg.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  assert.ok(pg2.page.startsWith('第 2 / '), 'pager advances to page 2: ' + pg2.page);
  assert.ok(pg2.vis >= 1, 'phone page 2 shows the remaining cards');
  assert.ok(pg2.pagerInView, 'pager stays in view on page 2');
});

test('desktop village panel, rules and pager fit one screen without scrolling', async t => {
  CURRENT = STARS_B;
  const { browser, page } = await openVocab(1280, 800);
  t.after(() => browser.close());
  const fit = await page.evaluate(() => {
    const pg = document.getElementById('villagePager');
    const pgr = pg.getBoundingClientRect();
    const vis = [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide'));
    const lastBottom = Math.max(...vis.map(c => c.getBoundingClientRect().bottom));
    return { visCount: vis.length, pagerHidden: pg.hidden, pagerInView: pg.hidden || (pgr.top >= 0 && pgr.bottom <= innerHeight + 1), cardsAbovePager: pg.hidden || lastBottom <= pgr.top + 1, ih: innerHeight, lastBottom, pagerBottom: pgr.bottom, scrollH: document.documentElement.scrollHeight };
  });
  assert.equal(fit.visCount >= 3, true, 'desktop shows at least one full row of cards per page: ' + JSON.stringify(fit));
  assert.ok(fit.scrollH <= fit.ih + 1, 'desktop home fits one screen without scrolling: ' + JSON.stringify(fit));
  assert.ok(fit.pagerInView, 'when a desktop pager is needed it stays in the viewport: ' + JSON.stringify(fit));
  assert.ok(fit.cardsAbovePager, 'desktop cards never slide under the pager');
});

test('phone folds 查看單字庫/成績/聲音 into the other-modes shell and the collapsed home fits one screen', async t => {
  const { browser, page } = await openVocab(390, 844);
  try {
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const shell = document.querySelector('.entry-other-modes-shell');
      const links = [...document.querySelectorAll('.actions-inline')].find(e => e.querySelector('[data-action="list"]'));
      const sound = document.querySelector('.more-panel');
      const rOf = e => e?.getBoundingClientRect();
      const mission = rOf(document.querySelector('.entry-mission'));
      return {
        shellOpen: shell?.open,
        linksInShell: !!(links && links.closest('.entry-other-modes-shell')),
        soundInShell: !!(sound && sound.closest('.entry-other-modes-shell')),
        soundInSettings: !!(sound && sound.closest('.app-settings')),
        scrollH: document.documentElement.scrollHeight,
        ih: innerHeight,
        missionInView: mission && mission.top >= 0 && mission.bottom <= innerHeight + 1,
        shellInView: (() => { const s = rOf(shell); return s && s.top >= 0 && s.bottom <= innerHeight + 1; })(),
        strayBelow: !![...document.querySelectorAll('.more-panel')].find(e => !e.closest('.app-settings') && !e.closest('.entry-other-modes-shell'))
      };
    });
    assert.equal(r.linksInShell, true, '查看單字庫/成績 entries must live inside the collapsible shell');
    assert.equal(r.soundInShell, false, '聲音與進階設定 leaves the practice home (moves to 勇者→設定)');
    assert.equal(r.soundInSettings, true, '聲音與進階設定 lives in the 設定 page');
    assert.equal(r.strayBelow, false, 'no duplicate settings panel may linger on the home');
    assert.ok(r.scrollH <= r.ih + 1, `collapsed phone home must not scroll (scrollH=${r.scrollH} vs ${r.ih})`);
    assert.equal(r.missionInView, true, 'mission must be fully visible');
    assert.equal(r.shellInView, true, 'collapsed shell must be fully visible');
    // Expanded: the entries are usable and the village pager repaints instead of overlapping.
    await page.evaluate(() => { const s = document.querySelector('.entry-other-modes-shell'); s.open = true; s.dispatchEvent(new Event('toggle')); });
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => {
      const shell = document.querySelector('.entry-other-modes-shell');
      const listBtn = shell.querySelector('[data-action="list"]');
      const scoreLink = shell.querySelector('[data-action="scores"], a[href*="score"], [data-action="history"]');
      return { listBtnVisible: !!(listBtn && listBtn.offsetParent), entries: shell.textContent.includes('查看單字庫') };
    });
    assert.equal(open.entries, true, 'expanded shell exposes 查看單字庫');
    assert.equal(open.listBtnVisible, true, 'expanded 查看單字庫 button must be usable');
  } finally {
    await browser.close();
  }
});

test('stage cards repaint stays interactive: rAF heartbeat keeps firing (no mutation loop)', async t => {
  CURRENT = STARS_A;
  const { browser, page } = await openVocab(390, 844);
  t.after(() => browser.close());
  await page.evaluate(() => { document.querySelector('.app-sync-issue')?.remove(); window.vocabVillageRepaint?.(); });
  await page.waitForTimeout(300);
  const beats = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 800) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick);
  }));
  assert.ok(beats >= 10, 'rAF heartbeat keeps firing after repaint (a mutation loop would starve it), got ' + beats + ' beats in 800ms');
  const again = await page.evaluate(() => { window.vocabVillageRepaint?.(); return document.querySelectorAll('.village-grid .village-card').length; });
  assert.equal(again, 8, 'repaint is idempotent: same eight cards, no runaway');
});

test('arriving with s=settings opens the 勇者 settings page directly with the sound section', async t => {
  CURRENT = STARS_A;
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  t.after(() => browser.close());
  await page.route('**/*.supabase.co/**', route => {
    let action = ''; try { action = route.request().postDataJSON()?.action || ''; } catch (e) {}
    if (action === 'getStageStars') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(CURRENT) });
    return route.abort();
  });
  await page.goto((await fixtureURL(VOCAB)) + '#f=' + 'a'.repeat(41) + '&p=' + encodeURIComponent('測試') + '&s=settings');
  await page.evaluate(() => { document.querySelectorAll('.player-gate, #playerGate, #vocabPlayerGate').forEach(e => { e.hidden = true; e.style.display = 'none'; }); });
  await page.evaluate(() => { window.vocabProgressState = () => ({ learners: [{ id: 'hero1', name: '測試勇士', xp: 120 }], attempts: [], selectedId: 'hero1' }); return window.learningStarsRefresh(true); });
  await page.waitForSelector('html.app-settings-open .app-settings:not([hidden])', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const pg = document.querySelector('.app-settings');
    const titles = [...pg.querySelectorAll('.app-setting-section h2')].map(h => h.textContent.trim());
    return { titles, sound: titles.some(x => x.includes('聲音')), hero: titles.some(x => x.includes('勇者')), gearHidden: document.getElementById('appSettingsBtn').hidden };
  });
  assert.ok(r.hero, 'settings page leads with the 勇者與進度 section, got ' + r.titles.join('/'));
  assert.ok(r.sound, 'settings page carries the 聲音 section, got ' + r.titles.join('/'));
  assert.equal(r.gearHidden, true, 'the gear entry stays as the in-page opener while settings is open');
  // The arrival intent is consumed once by the lifecycle; post-arrival star refresh + rebuild keeps the final page open through the keepSettings path, with no force-reopen.
  await page.evaluate(() => window.learningStarsRefresh(true));
  await new Promise(r2 => setTimeout(r2, 1500));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-settings-open') && !document.querySelector('.app-settings').hidden), true, 'settings stays open through the post-arrival pipeline refresh');
  // Manual close within the arrival window must NOT be re-opened by the auto-open hook.
  await page.click('.app-settings .app-back');
  await page.waitForSelector('html:not(.app-settings-open)');
  await new Promise(r2 => setTimeout(r2, 3000));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-settings-open')), false, 'manual close is never re-opened by the arrival hook');  await page.evaluate(() => window.learningStarsRefresh(true));
  await new Promise(r3 => setTimeout(r3, 1500));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-settings-open')), false, 'a post-close pipeline rebuild must not re-open settings after the user left');
});

test('vocab shared assets call the player 勇者, never 冒險者', () => {
  const fs = require('fs');
  for (const f of ['archipelago.js', 'progress.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../apps/vocab-quest/site/' + f), 'utf8');
    assert.ok(!src.includes('冒險者'), f + ' must not call the player 冒險者');
  }
});
