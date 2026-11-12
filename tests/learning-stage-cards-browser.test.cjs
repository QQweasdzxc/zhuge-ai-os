const test = require('node:test'), assert = require('node:assert/strict'), path = require('path');
const { chromium } = require('playwright');
const { fixtureURL, resolveBrowserExecutable } = require('./browser-executable');

const CHENGYU = path.resolve(__dirname, '../apps/chengyu-quest/site/index.html');
const STARS = {
  ok: true, total: 4, stagePassed: [1], villageExamUnlocked: false, villagePassed: false,
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
      starsEvery: cards.slice(0, 7).every(c => c.querySelector('.stars') && c.querySelector('.star-progress')),
      examEvery: cards.slice(0, 7).every(c => c.querySelector('button[data-stage-exam]')),
      card1stars: at(1).querySelector('.stars').textContent,
      card2progress: at(2).querySelector('.star-progress').textContent,
      exam1open: !at(1).querySelector('[data-stage-exam]').disabled,
      exam2open: !at(2).querySelector('[data-stage-exam]').disabled,
      exam3locked: at(3).querySelector('[data-stage-exam]').disabled,
      zone3locked: at(3).getAttribute('aria-disabled') === 'true',
      zone8copy: at(8).textContent,
      zone8examDisabled: at(8).querySelector('[data-village-exam]').disabled,
      title: document.querySelector('.entry-map summary')?.textContent || '',
      oldPanelGone: !document.querySelector('.village-grid') && !document.getElementById('villagePanel'),
      noWideScroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
}

test('stage cards carry their own stars, progress and summary-exam entry; total sits with the map title', async t => {
  const { browser, page } = await openChengyu(1280, 900);
  t.after(() => browser.close());
  const r = await readCards(page);
  assert.equal(r.count, 8);
  assert.ok(r.starsEvery && r.examEvery, 'every level card shows its stars and its exam entry');
  assert.equal(r.card1stars, '★★☆', 'card shows the earned and the empty stars');
  assert.match(r.card2progress, /兩種角度|過關日/, 'card shows what is still missing for the next star');
  assert.ok(r.exam1open && r.exam2open, 'exam entry follows the real gating (first star + previous stage passed)');
  assert.equal(r.exam3locked, true, 'stage 3 exam stays disabled until stage 2 summary passes');
  assert.equal(r.zone3locked, true, 'stage 3 stays locked');
  assert.equal(r.zone8examDisabled, true, 'village exam stays disabled before 21 stars');
  assert.match(r.zone8copy, /集滿 21 星開放/, 'village exam entry states its prerequisite');
  assert.match(r.zone8copy, /新手村集星 4 \/ 21/, 'village progress shows inside the final card');
  assert.doesNotMatch(r.zone8copy, /出村大考驗已通過/, 'no false sense that the final stage is cleared');
  assert.match(r.title, /新手村集星 4 \/ 21/, 'total stars sit with the map title');
  assert.ok(r.oldPanelGone, 'no second stacked progress panel remains');
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
  assert.ok(r.starsEvery && r.examEvery, 'phone cards show stars and exam entries too');
  assert.match(r.title, /新手村集星 4 \/ 21/);
  assert.ok(r.noWideScroll, 'no horizontal scrolling on the phone');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.adventure-stage .stage-exam')].map(b => b.getBoundingClientRect().height));
  assert.ok(sizes.every(h => h >= 40), 'exam entries stay tappable: ' + sizes.join(','));
});
