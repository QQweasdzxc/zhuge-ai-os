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
      demoLayout: cards.every(c => c.querySelector('.village-main') && c.querySelector('.village-side')) && cards.filter(c => !c.classList.contains('village-final')).every(c => c.querySelector('.village-side .village-stars')),
      lockedCards: cards.filter(c => c.classList.contains('village-locked')).length,
      lockedWithButtons: cards.filter(c => c.classList.contains('village-locked') && c.querySelector('button')).length,
      final: cards.find(c => c.classList.contains('village-final'))?.textContent || '',
      finalBtn: !!cards.find(c => c.classList.contains('village-final') && c.querySelector('button')),
      disabledExamButtons: [...document.querySelectorAll('.village-panel button:disabled:not([data-vpage])')].length,
      pager: document.getElementById('villagePager')?.hidden,
      visibleCards: [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide')).length,
      noWideScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
}

test('vocab stage cards are state-driven with PASS marks, short labels and rules in 說明', async t => {
  CURRENT = STARS_A;
  const { browser, page } = await openVocab(1280, 900);
  t.after(() => browser.close());
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
  assert.match(r.final, /集滿 21 星開放 · 90 分通過/, 'village exam card states the rule');
  assert.match(r.final, /目前集星 3 \/ 21/, 'village exam card shows live progress');
  assert.equal(r.finalBtn, false, 'village exam button only appears when unlocked');
  assert.equal(r.disabledExamButtons, 0, 'no disabled buttons anywhere in the panel');
  assert.equal(r.pager, true, 'desktop hides the pager');
  assert.equal(r.visibleCards, 8, 'desktop shows all cards');
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
  assert.equal(r.visibleCards, 4, 'phone page 1 shows four cards');
  assert.ok(r.noWideScroll);
  await page.click('#villagePager [data-vpage="1"]');
  const pg2 = await page.evaluate(() => ({ page: document.querySelector('#villagePager span').textContent, vis: [...document.querySelectorAll('.village-grid .village-cell')].filter(c => !c.classList.contains('vp-hide')).length }));
  assert.equal(pg2.page, '第 2 / 2 頁');
  assert.equal(pg2.vis, 4, 'phone page 2 shows the remaining cards');
});
