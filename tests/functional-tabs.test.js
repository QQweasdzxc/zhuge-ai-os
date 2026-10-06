const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const AUTHORITY = 'shared/theme/zhuge-functional-tabs.css';
const TAB = /\.(?:[\w-]*-tabs?|[\w-]*-subnav|console-tab-list|tabs|tab|investment-nav-item|investment-local-nav)(?![\w-])/;
const VISUAL = /(?:^|;)\s*(?:display|align-items|justify-content|flex(?:-[\w-]+)?|grid(?:-[\w-]+)?|gap|(?:min-|max-)?(?:height|width)|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|border(?:-[\w-]+)?|background(?:-[\w-]+)?|color|font(?:-[\w-]+)?|line-height|letter-spacing|outline(?:-[\w-]+)?|box-shadow|overflow(?:-[\w-]+)?|white-space|text-decoration)\s*:/;
function violations(css) {
  const found = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!VISUAL.test(match[2])) continue;
    for (const selector of match[1].split(',')) {
      // Adjacent content and nested controls are not tab presentation.
      const target = selector.trim().split(/[>+~]/).at(-1).trim().split(/\s+/).at(-1);
      if (TAB.test(target)) found.push(selector.trim());
    }
  }
  return found;
}
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.name === 'vendor' ? [] : entry.isDirectory() ? files(path.join(dir,entry.name)) : [path.join(dir,entry.name)]);
}
test('Source-wide Functional Tabs visual authority is exactly one, including inline styles', () => {
  const errors = [];
  for (const dir of ['shared','modules','app','labs']) for (const file of files(path.join(ROOT,dir))) {
    const relative = path.relative(ROOT,file).split(path.sep).join('/');
    if (relative === AUTHORITY || !/\.(css|html)$/.test(file)) continue;
    const source = fs.readFileSync(file,'utf8');
    const css = file.endsWith('.css') ? source : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
    for (const selector of violations(css)) errors.push(relative + ': ' + selector);
  }
  assert.deepEqual(errors, []);
  assert.match(read('shared/theme/zhuge-shell.css'), /@import.*zhuge-functional-tabs.css/);
});
test('Static guard rejects old, canonical-outside-authority and newly invented tab geometry', () => {
  for (const selector of ['.workspace-tab','.procurement-content-tab','.investment-tab','.mobile-worklog-tab','.console-tab','.zhuge-functional-tab','.future-feature-tab','.workspace-subnav']) {
    for (const property of ['padding:12px','border:1px solid red','background:red','font-size:18px','height:30px','display:grid']) assert.equal(violations(selector+'{'+property+'}').length,1);
  }
  assert.deepEqual(violations('.workspace-tabs + .workspace-canvas{padding:10px}.workspace-tab-search-trigger{width:44px}'),[]);
});
test('Every current functional entry opts into canonical presentation without changing its action selectors', () => {
  for (const file of ['app/Board/ai/index.html','app/Board/worktodo/index.html','app/Board/template-preview/index.html','app/Board/procurement/index.html','modules/investment/components/module-shell.js','modules/worklog/worklog-app.js','labs/investment/index.html']) assert.match(read(file),/zhuge-functional-tabs/);
  for (const file of ['app/Board/ai/index.html','app/Board/worktodo/index.html','app/Board/template-preview/index.html']) assert.match(read(file),/data-board-nav="board"/);
  assert.match(read('app/Board/procurement/index.html'),/data-procurement-nav="vendors"/);
  assert.match(read('modules/investment/components/module-shell.js'),/href="\$\{hrefFor\(item\)\}"/);
  assert.match(read('modules/worklog/worklog-app.js'),/data-mobile-worklog-tab=/);
  assert.match(read('shared/components/zhuge-functional-tabs.js'),/tabs\[next\]\.focus\(\)/);
  assert.doesNotMatch(read('shared/components/zhuge-functional-tabs.js'),/\.rpc\(|localStorage|location\.|history\./);
});
