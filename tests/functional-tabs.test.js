const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const AUTHORITY = 'shared/theme/zhuge-functional-tabs.css';
const TAB_TOKEN = /(?:^|[.#:\s>+~])(?:(?:[\w-]+-)?tabs?|workspace-subnav|investment-(?:primary-nav|content-tabs))(?=$|[\s.:#\[])/;
const VISUAL = /(?:^|;)\s*(?:display|align-items|justify-content|flex(?:-[\w-]+)?|grid(?:-[\w-]+)?|gap|(?:min-|max-)?(?:height|width)|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|border(?:-[\w-]+)?|background(?:-[\w-]+)?|color|font(?:-[\w-]+)?|line-height|letter-spacing|outline(?:-[\w-]+)?|box-shadow|overflow(?:-[\w-]+)?|white-space|text-decoration|position|transform|inset(?:-[\w-]+)?|top|right|bottom|left)\s*:/;
function violations(css) {
  const found = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!VISUAL.test(match[2])) continue;
    for (const selector of match[1].split(',')) {
      const normalized = selector.trim();
      const target = normalized.split(/[>+~]/).at(-1).trim().split(/\s+/).at(-1);
      const affectsTabParent = /[>+~]/.test(normalized) && TAB_TOKEN.test(normalized) && !/\.investment-tool-nav\s*\[[^\]]+\]\s+\.investment-tool-nav-(?:summary|label|chevron)/.test(normalized);
      if (TAB_TOKEN.test(target) || affectsTabParent) found.push(normalized);
    }
  }
  return found;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.name === 'vendor' ? [] : entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

test('Functional Tabs visual CSS has one source authority and no private rhythm declarations', () => {
  const errors = [];
  for (const dir of ['shared', 'modules', 'app', 'labs']) for (const file of files(path.join(ROOT, dir))) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (relative === AUTHORITY || !/\.(css|html)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const css = file.endsWith('.css') ? source : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
    for (const selector of violations(css)) errors.push(relative + ': ' + selector);
  }
  assert.deepEqual(errors, []);
  assert.doesNotMatch(read('shared/theme/zhuge-shell.css'), /@import[^;]*zhuge-functional-tabs\.css/);
  for (const file of ['app/Board/ai/index.html','app/Board/worktodo/index.html','app/Board/template-preview/index.html','app/Board/procurement/index.html','app/Board/investment/index.html','modules/investment/index.html','modules/skyeye/index.html','app/dashboard/index.html','labs/investment/index.html']) {
    const source = read(file);
    const links = [...source.matchAll(/<link[^>]+rel="stylesheet"[^>]+>/g)].map(match => match[0]);
    assert.match(links.at(-1) || '', /zhuge-functional-tabs\.css/, `${file} must load shared authority last`);
  }
  const worklogStyles = read('modules/worklog/index.html').match(/const appStyles = \[([\s\S]*?)\];/)[1];
  assert.match(worklogStyles.trim().split(',').at(-1), /zhuge-functional-tabs\.css/);
});

test('Static authority guard rejects private tab and parent-rhythm CSS', () => {
  for (const selector of ['.workspace-tab','.workspace-tabs','.workspace-subnav','.procurement-content-tab','.investment-primary-nav','.investment-content-tabs','.mobile-worklog-tabs','.console-tabs','.zhuge-functional-tab','.future-feature-tab']) {
    for (const property of ['padding:12px','border:1px solid red','background:red','font-size:18px','height:30px','display:grid','margin-top:8px','transform:translateY(1px)']) assert.equal(violations(selector + '{' + property + '}').length, 1, `${selector} ${property}`);
  }
  assert.deepEqual(violations('.workspace-tab-search-trigger{width:44px}.investment-tool-nav{position:relative}.investment-tool-nav-summary{min-height:44px}.investment-tool-nav[open] .investment-tool-nav-summary{color:red}'), []);
});

test('Formal tab rows share canonical nav structure and retain consumer actions', () => {
  for (const file of ['app/Board/ai/index.html','app/Board/worktodo/index.html','app/Board/template-preview/index.html','app/Board/procurement/index.html','modules/investment/components/module-shell.js','modules/worklog/worklog-app.js','labs/investment/index.html']) assert.match(read(file), /zhuge-functional-tabs/);
  for (const file of ['app/Board/ai/index.html','app/Board/worktodo/index.html','app/Board/template-preview/index.html']) assert.match(read(file), /<nav class="workspace-tabs[^>]*zhuge-functional-tabs/);
  assert.match(read('app/Board/procurement/index.html'), /<nav class="procurement-content-tabs zhuge-functional-tabs"/);
  assert.match(read('modules/investment/components/module-shell.js'), /class="zhuge-functional-tabs-actions"/);
  const investmentShell = read('modules/investment/components/module-shell.js');
  assert.match(investmentShell, /class="investment-tool-menu" role="menu"/);
  assert.match(investmentShell, /role="menuitem"/);
  assert.doesNotMatch(investmentShell, /class="investment-tool-nav[^\"]*zhuge-functional-tab/);
  assert.match(read('shared/components/golden-master-runtime.js'), /createElement\("nav"\)/);
  assert.match(read('modules/worklog/worklog-app.js'), /<nav data-worklog-navigation class="workspace-tabs workspace-subnav zhuge-functional-tabs"/);
  assert.doesNotMatch(read('modules/worklog/worklog-app.js'), /data-worklog-navigation class="workspace-tabs workspace-subnav empty zhuge-functional-tabs"/);
  assert.match(read('shared/components/zhuge-functional-tabs.js'), /zhuge-functional-tab-icon/);
  assert.match(read('shared/components/zhuge-functional-tabs.js'), /zhuge-functional-tab-label/);
  assert.match(read('shared/components/zhuge-functional-tabs.js'), /tabs\[next\]\.focus\(\)/);
  assert.doesNotMatch(read('shared/components/zhuge-functional-tabs.js'), /\.rpc\(|localStorage|location\.|history\./);
});
