const test = require('node:test'), assert = require('node:assert/strict'), path = require('path');
const { chromium } = require('playwright');
const { fixtureURL, resolveBrowserExecutable } = require('./browser-executable');

const CHENGYU = path.resolve(__dirname, '../apps/chengyu-quest/site/index.html');
// Internally consistent fixture: total equals the sum of per-stage stars (2 + 1 = 3).
const STARS = {
  ok: true, total: 3, stagePassed: [1], villageExamUnlocked: false, villagePassed: false,
  stages: [1, 2, 3, 4, 5, 6, 7].map(z => ({ zone: z, stars: z === 1 ? 2 : z === 2 ? 1 : 0, diverse_words: z === 1 ? 2 : 0, pass_days: z === 1 ? 2 : 0, first_star: z <= 2 }))
};
const EXAM = { ok: true, exam: { id: 'e1', questions: Array.from({ length: 10 }, (_, i) => ({ stem: '測驗題' + (i + 1), choices: ['甲', '乙', '丙', '丁'] })) } };

async function openChengyu(width, height) {
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*.supabase.co/**', route => {
    let action = '';
    try { action = route.request().postDataJSON()?.action || ''; } catch (e) {}
    if (action === 'getStageStars') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(STARS) });
    if (action === 'startStageExam') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(EXAM) });
    return route.abort();
  });
  await page.goto((await fixtureURL(CHENGYU)) + '#f=' + 'a'.repeat(41));
  await page.evaluate(() => { document.querySelectorAll('.player-gate').forEach(e => e.hidden = true); });
  await page.waitForSelector('.adventure-stage');
  // A selected adventurer, then the real sync pipeline paints stars into the cards.
  await page.evaluate(() => {
    window.chengyuProgressState = () => ({ learners: [{ id: 'hero1', name: '測試勇士', xp: 120 }], attempts: [], selectedId: 'hero1' });
    return window.learningStarsRefresh(true);
  });
  await page.waitForFunction(() => document.querySelector('.adventure-stage .stars') && document.querySelector('.adventure-stage [data-stage-exam]'));
  return { browser, page };
}

async function readCards(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.adventure-stage')];
    const at = n => cards.find(c => c.dataset.zone === String(n));
    return {
      count: cards.length,
      demoLayout: cards.every(c => c.querySelector('.stage-main') && c.querySelector('.stage-side')),
      starsInSide: cards.slice(0, 7).every(c => c.querySelector('.stage-side .stars') && !c.querySelector('.star-progress')),
      card1stars: at(1).querySelector('.stars').textContent,
      card1state: at(1).querySelector('.state').textContent,
      card1pass: at(1).querySelector('.stage-side .stage-pass')?.textContent || '',
      card1exam: at(1).querySelector('[data-stage-exam]')?.textContent || '',
      card2stars: at(2).querySelector('.stars').textContent,
      card2exam: at(2).querySelector('[data-stage-exam]')?.textContent || '',
      card3state: at(3).querySelector('.state').textContent,
      card3exam: !!at(3).querySelector('[data-stage-exam]'),
      laterExams: cards.slice(3, 7).filter(c => c.querySelector('[data-stage-exam]')).length,
      noLongButtons: ![...document.querySelectorAll('.adventure-stage button')].some(b => /先完成|取得第/.test(b.textContent)),
      zone3locked: at(3).getAttribute('aria-disabled') === 'true',
      zone8copy: at(8).textContent,
      zone8examBtn: !!at(8).querySelector('[data-village-exam]'),
      title: document.querySelector('.entry-map summary')?.textContent || '',
      help: document.getElementById('stageHelp')?.textContent || '',
      oldPanelGone: !document.querySelector('.village-grid') && !document.getElementById('villagePanel'),
      pagerHidden: document.getElementById('stagePager')?.hidden,
      entryZone: document.getElementById('entryZone')?.textContent || '',
      visibleCards: [...document.querySelectorAll('.adventure-stage')].filter(c => !c.classList.contains('stage-page-hide')).map(c => c.dataset.zone),
      noWideScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
}

test('stage cards are state-driven: stars, what is missing, and the exam entry only when earned; total sits with the map title', async t => {
  const { browser, page } = await openChengyu(1280, 900);
  t.after(() => browser.close());
  const r = await readCards(page);
  assert.equal(r.count, 8);
  assert.ok(r.demoLayout, 'every card uses the compact demo anatomy: main column + side column');
  assert.ok(r.starsInSide, 'stars sit in the card side, no long progress paragraph on the card face');
  assert.equal(r.card1stars, '★★☆', 'card shows the earned and the empty stars');
  assert.match(r.card1state, /PASS/, 'a passed stage carries a clear PASS mark');
  assert.equal(r.card1pass, '✓PASS', 'a passed stage shows the PASS mark in the side');
  assert.equal(r.card1exam, '再測一次', 'a passed stage keeps a small retake link');
  assert.equal(r.card2stars, '★☆☆');
  assert.equal(r.card2exam, '總結測驗', 'earned exam entry uses the short compact label');
  assert.equal(r.card3state, '🔒 未解鎖', 'locked stage says so in one short line');
  assert.equal(r.card3exam, false, 'no exam button before the first star is earned');
  assert.equal(r.laterExams, 0, 'later stages show no disabled long-text exam buttons');
  assert.ok(r.noLongButtons, 'no long disabled explanation buttons anywhere');
  assert.equal(r.zone3locked, true, 'stage 3 stays locked until stage 2 summary passes');
  assert.equal(r.zone8examBtn, false, 'no village-exam button before 21 stars');
  assert.match(r.zone8copy, /集滿 21 星開放/, 'village exam prerequisite stays visible as text');
  assert.match(r.zone8copy, /90 分通過/, 'village exam passing rule stays visible');
  assert.match(r.zone8copy, /3\/21/, 'village progress shows inside the final card');
  assert.doesNotMatch(r.zone8copy, /出村考驗已通過/, 'no false sense that the final stage is cleared');
  assert.match(r.title, /新手村集星 3 \/ 21/, 'total stars sit with the map title');
  assert.match(r.help, /達90%開下一關/, 'rules move into the 說明 details');
  assert.match(r.help, /集滿21星開放出村大考驗，90分通過才開放第8關/, '說明 keeps the full unlock contract');
  assert.ok(r.oldPanelGone, 'no second stacked progress panel remains');
  assert.match(r.entryZone, /第 2 關/, 'stage 1 passed, so the mission recommends stage 2, got ' + r.entryZone);
  assert.equal(r.pagerHidden, false, 'desktop keeps the pager visible once the mission and bottom actions reserve their space');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('stagePager')).display), 'flex', 'desktop computed style really shows the pager');
  assert.equal(r.visibleCards.length, 6, 'desktop shows two measured rows (six cards), got ' + r.visibleCards.join(','));
  const oneScreen = await page.evaluate(() => {
    const pg = document.getElementById('stagePager').getBoundingClientRect();
    const mission = document.querySelector('.entry-mission').getBoundingClientRect();
    const row = document.querySelector('.app-library-row')?.getBoundingClientRect();
    const help = document.getElementById('stageHelp').getBoundingClientRect();
    const options = document.querySelector('.entry-options')?.getBoundingClientRect();
    return { missionBottom: mission.bottom, helpBottom: help.bottom, pagerBottom: pg.bottom, rowBottom: row ? row.bottom : null, optionsBottom: options ? options.bottom : null, scrollH: document.documentElement.scrollHeight, ih: innerHeight };
  });
  assert.ok(oneScreen.missionBottom <= oneScreen.ih + 1, 'start-practice card stays in the window: ' + JSON.stringify(oneScreen));
  assert.ok(oneScreen.helpBottom <= oneScreen.ih + 1, 'rules details stay in the window');
  assert.ok(oneScreen.pagerBottom <= oneScreen.ih + 1, 'pager stays in the window');
  assert.ok(oneScreen.rowBottom === null || oneScreen.rowBottom <= oneScreen.ih + 1, 'library / handwriting row stays in the window: ' + JSON.stringify(oneScreen));
  assert.ok(oneScreen.optionsBottom === null || oneScreen.optionsBottom <= oneScreen.ih + 1, 'practice options stay in the window: ' + JSON.stringify(oneScreen));
  assert.ok(oneScreen.scrollH <= oneScreen.ih + 1, 'no vertical scrolling through the main entry: ' + JSON.stringify(oneScreen));
  assert.ok(r.noWideScroll);

  // The in-card exam entry drives the real exam flow.
  await page.click('.adventure-stage[data-zone="2"] [data-stage-exam]');
  await page.waitForSelector('.village-exam:not([hidden])');
  const modal = await page.evaluate(() => document.querySelector('.village-exam').textContent);
  assert.match(modal, /第 2 關總結測驗/);
  assert.match(modal, /第 1 \/ 10 題/);
  await page.click('.village-exam [data-village-close]');
  assert.equal(await page.evaluate(() => document.querySelector('.village-exam').hidden), true);

  // Clicking a card body still selects the stage for practice.
  await page.click('.adventure-stage[data-zone="2"] .stage-icon');
  assert.equal(await page.evaluate(() => document.querySelector('.adventure-stage[data-zone="2"]').getAttribute('aria-pressed')), 'true');
});

test('stage cards stay readable and tappable on a phone', async t => {
  const { browser, page } = await openChengyu(390, 844);
  t.after(() => browser.close());
  const r = await readCards(page);
  assert.equal(r.count, 8);
  assert.ok(r.demoLayout, 'phone cards keep the compact demo anatomy');
  const cols = await page.evaluate(() => getComputedStyle(document.getElementById('adventureStages')).gridTemplateColumns);
  assert.ok(!cols.includes(' '), 'phone shows one card per row, got ' + cols);
  assert.equal(r.card2exam, '總結測驗', 'phone shows the short exam label');
  assert.match(r.title, /新手村集星 3 \/ 21/);
  assert.ok(r.noWideScroll, 'no horizontal scrolling on the phone');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.adventure-stage .stage-exam:not(.stage-exam-retake)')].map(b => b.getBoundingClientRect().height));
  assert.ok(sizes.length >= 1 && sizes.every(h => h >= 40), 'exam entries stay tappable: ' + sizes.join(','));
  const fit = await page.evaluate(() => {
    const pg = document.getElementById('stagePager');
    const pgr = pg.getBoundingClientRect();
    const vis = [...document.querySelectorAll('.adventure-stage')].filter(c => !c.classList.contains('stage-page-hide'));
    const lastBottom = Math.max(...vis.map(c => c.getBoundingClientRect().bottom));
    return { label: document.querySelector('#stagePager span').textContent, pagerHidden: pg.hidden, pagerInView: pgr.top >= 0 && pgr.bottom <= innerHeight + 1, cardsAbovePager: lastBottom <= pgr.top + 1, visCount: vis.length, ih: innerHeight, pagerBottom: pgr.bottom };
  });
  assert.equal(fit.pagerHidden, false, 'phone shows the card pager instead of a long list');
  assert.ok(fit.visCount >= 1 && fit.visCount < 8, 'phone paginates a measured number of cards: ' + JSON.stringify(fit));
  assert.ok(fit.pagerInView, 'pager controls stay inside the phone viewport without scrolling: ' + JSON.stringify(fit));
  assert.ok(fit.cardsAbovePager, 'cards never slide under the pager: ' + JSON.stringify(fit));
  await page.click('#stagePager [data-pg="1"]');
  const pg2 = await page.evaluate(() => {
    const pg = document.getElementById('stagePager');
    const vis = [...document.querySelectorAll('.adventure-stage')].filter(c => !c.classList.contains('stage-page-hide')).map(c => c.dataset.zone);
    return { page: document.querySelector('#stagePager span').textContent, vis, pagerInView: pg.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  assert.ok(pg2.page.startsWith('第 2 / '), 'pager advances to page 2: ' + pg2.page);
  assert.deepEqual(pg2.vis[0], String(fit.visCount + 1), 'page 2 continues where page 1 stopped: ' + JSON.stringify(pg2));
  assert.ok(pg2.pagerInView, 'pager stays in view on page 2');
});

test('desktop map, rules and pager fit one screen without scrolling', async t => {
  const { browser, page } = await openChengyu(1280, 800);
  t.after(() => browser.close());
  const fit = await page.evaluate(() => {
    const pg = document.getElementById('stagePager');
    const pgr = pg.getBoundingClientRect();
    const vis = [...document.querySelectorAll('.adventure-stage')].filter(c => !c.classList.contains('stage-page-hide'));
    const lastBottom = Math.max(...vis.map(c => c.getBoundingClientRect().bottom));
    const help = document.getElementById('stageHelp').getBoundingClientRect();
    return { visCount: vis.length, pagerHidden: pg.hidden, pagerInView: pg.hidden || (pgr.top >= 0 && pgr.bottom <= innerHeight + 1), cardsAbovePager: pg.hidden || lastBottom <= pgr.top + 1, helpInView: help.bottom <= (pg.hidden ? innerHeight + 1 : pgr.top + 1) || help.bottom <= innerHeight + 1, ih: innerHeight, lastBottom };
  });
  assert.equal(fit.visCount >= 6, true, 'desktop shows most or all cards per page: ' + JSON.stringify(fit));
  assert.ok(fit.pagerInView, 'when a desktop pager is needed it stays in the viewport: ' + JSON.stringify(fit));
  assert.ok(fit.cardsAbovePager, 'desktop cards never slide under the pager');
  assert.ok(fit.helpInView, 'the rules details stay on screen too');
});
