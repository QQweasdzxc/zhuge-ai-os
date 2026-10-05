const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { resolveBrowserExecutable, fixtureURL } = require('./browser-executable');
const ROOT = path.join(__dirname, '..');
const EVIDENCE = process.env.NAVIGATION_QA_EVIDENCE_DIR;

test('Shared Navigation child metrics match across element types, active states and mobile/desktop', async t => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, 'A real Chromium executable is required');
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'navigation-child-qa-'));
  t.after(async () => { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const route of ['app/Board/template-preview/index.html', 'app/Board/worktodo/index.html', 'app/Board/procurement/index.html', 'modules/investment/index.html', 'modules/worklog/index.html']) {
    const source = fs.readFileSync(path.join(ROOT, route), 'utf8');
    const hrefs = route.startsWith('modules/worklog')
      ? [...source.match(/const appStyles = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1])
      : [...source.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]);
    const links = hrefs.map(href => `<link rel="stylesheet" href="/${path.posix.normalize(path.posix.join(path.posix.dirname(route), href))}">`).join('');
    const fixture = path.join(directory, 'navigation.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="UTF-8">${links}</head><body><main class="zhuge-module-shell workspace-shell"><div id="nav"></div><div class="app"></div></main><script src="/shared/components/zhuge-navigation.js"></script></body></html>`);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(await fixtureURL(fixture));
        const result = await page.evaluate(({ internal }) => {
          const boards = [{ id: 'qa-work', name: '晨光計畫', taskCodePrefix: 'QA', projectAssignment: 'worklog' }, { id: 'qa-invest', name: '遠山研究', taskCodePrefix: 'OTHER', projectAssignment: 'investment' }];
          document.getElementById('nav').outerHTML = ZhugeSharedNavigation.render({ boardInstances: boards, externalRoot: internal ? '' : '/', activeBoardInstanceId: 'qa-work' });
          const shell = document.querySelector('main');
          shell.classList.add('sidebar-open');
          const ids = ['tasks-new', 'procurement', 'consumer-board:qa-work', 'consumer-board:qa-invest'];
          const element = id => document.querySelector(`[data-shared-nav-item="${id}"]`);
          const metrics = id => {
            const node = element(id), style = getComputedStyle(node), icon = getComputedStyle(node.querySelector('.side-item-icon'));
            const label = node.querySelector('.side-item-label'), textStyle = getComputedStyle(label);
            const range = document.createRange(); range.selectNodeContents(label);
            const textRect = range.getBoundingClientRect(), rowRect = node.getBoundingClientRect();
            return { text: { fontFamily: textStyle.fontFamily, fontSize: textStyle.fontSize, fontWeight: textStyle.fontWeight, lineHeight: textStyle.lineHeight, letterSpacing: textStyle.letterSpacing, glyphHeight: textRect.height, centerOffset: textRect.height ? Math.round((textRect.y + textRect.height / 2 - rowRect.y - rowRect.height / 2) * 100) / 100 : null }, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, minHeight: style.minHeight, height: node.getBoundingClientRect().height, padding: style.padding, marginLeft: style.marginLeft, width: style.width, iconFontSize: icon.fontSize, iconWidth: icon.width, borderRadius: style.borderRadius };
          };
          const expanded = ids.map(metrics);
          const active = element('consumer-board:qa-work').getAttribute('aria-current');
          const noEmptyHeading = !document.querySelector('[data-nav-group="consumer-boards"]');
          element('consumer-board:qa-work').classList.remove('on');
          const inactive = metrics('consumer-board:qa-work');
          // Save the real Mobile/desktop presentation before stress-testing scroll.
          window.navigationExpandedEvidence = { expanded, labels: ids.map(id => element(id).querySelector('.side-item-label').textContent) };
          shell.classList.add('zhuge-nav-collapsed');
          const collapsed = ids.map(metrics);
          shell.classList.remove('zhuge-nav-collapsed');
          const scroll = document.querySelector('.sidebar-scroll');
          for (let index = 0; index < 40; index++) scroll.appendChild(element('consumer-board:qa-work').cloneNode(true));
          scroll.scrollTop = scroll.scrollHeight;
          const sidebar = document.querySelector('.os-sidebar');
          sidebar.scrollTop = sidebar.scrollHeight;
          return { expanded, inactive, collapsed, active, noEmptyHeading, scrollMetrics: {position: getComputedStyle(sidebar).position, top: getComputedStyle(sidebar).top, bottom: getComputedStyle(sidebar).bottom, minHeight: getComputedStyle(sidebar).minHeight, maxHeight: getComputedStyle(sidebar).maxHeight, inner: [scroll.clientHeight, scroll.scrollHeight, scroll.scrollTop], outer: [sidebar.clientHeight, sidebar.scrollHeight, sidebar.scrollTop]}, scrolls: scroll.scrollTop > 0 || sidebar.scrollTop > 0, noHorizontalOverflow: scroll.scrollWidth <= scroll.clientWidth, mobileVisible: getComputedStyle(document.querySelector('.os-sidebar')).transform };
        }, { internal: route.startsWith('modules/worklog') });
        for (const value of result.expanded) assert.deepEqual(value, result.expanded[0], `${route} ${viewport.width}: child geometry mismatch`);
        assert.deepEqual(result.inactive, result.expanded[2], 'Active state must not change typography or geometry');
        for (const value of result.collapsed) assert.deepEqual(value, result.collapsed[0], 'Collapsed children must share row and icon geometry');
        assert.equal(result.expanded[0].fontSize, '14px');
        assert.equal(result.expanded[0].text.fontSize, '14px');
        assert.equal(result.expanded[0].text.letterSpacing, 'normal');
        assert.equal(result.expanded[0].fontWeight, '750');
        assert.equal(result.expanded[0].height, 44);
        assert.equal(result.collapsed[0].height, 46);
        assert.equal(result.collapsed[0].iconWidth, '20px');
        assert.equal(result.active, 'page');
        assert.equal(result.noEmptyHeading, true);
        assert.equal(result.scrolls, true, JSON.stringify({route, viewport, metrics: result.scrollMetrics}));
        assert.equal(result.noHorizontalOverflow, true);
        if (EVIDENCE) {
          fs.mkdirSync(EVIDENCE, {recursive:true});
          const label = route.replaceAll('/', '-').replace('.html', '') + '-' + viewport.width;
          await page.evaluate(() => {
            const scroll=document.querySelector('.sidebar-scroll');
            [...scroll.children].filter(node=>node.matches('[data-shared-nav-item]')).forEach(node=>node.remove());
            scroll.scrollTop=0; document.querySelector('.os-sidebar').scrollTop=0;
          });
          await page.screenshot({path:path.join(EVIDENCE,label+'.png')});
          fs.writeFileSync(path.join(EVIDENCE,label+'.json'),JSON.stringify(result,null,2));
        }
        if (viewport.width === 390) assert.equal(result.mobileVisible, 'matrix(1, 0, 0, 1, 0, 0)');
      } finally { await page.close(); }
    }
  }
});
