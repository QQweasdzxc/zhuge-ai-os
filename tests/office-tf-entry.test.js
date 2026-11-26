const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const officeSource = fs.readFileSync(path.join(__dirname, '../labs/pixel-office-3d/index.html'), 'utf8');
const office3dSource = fs.readFileSync(path.join(__dirname, '../labs/pixel-office-3d/office3d.js'), 'utf8');
const destination = 'https://qqweasdzxc.github.io/HELM/';
test('office preserves the original wall hook and has no duplicate toolbar links', () => {
  assert.ok(!officeSource.includes('id="classicLink"'));
  assert.ok(!officeSource.includes('id="tfLink"'));
  assert.ok(office3dSource.includes('hoverKey==="tf-wall"'));
  assert.ok(office3dSource.includes('window.zhugeOpenTfBoard'));
  assert.ok(!office3dSource.includes('window.open(document.getElementById("tfLink")'));
});
const hook = officeSource.match(/window\.zhugeOpenTfBoard = function \(\) \{[\s\S]*?\n\};/);
assert.ok(hook, 'original wall entry hook must exist');
for (const storedSession of [null, 'stale-session', 'existing-session']) {
  test(`original wall opens own board in the same top tab without reading credentials: ${storedSession}`, () => {
    const navigations = [];
    let storageReads = 0, networkCalls = 0, newTabs = 0;
    const sandbox = {
      localStorage: {getItem() {storageReads++; return storedSession;}},
      fetch() {networkCalls++; throw new Error('entry must not exchange credentials');},
      window: {top: {location: {assign(url) {navigations.push(url);}}}, open() {newTabs++;}},
    };
    vm.createContext(sandbox);
    vm.runInContext(hook[0], sandbox, {timeout: 1000});
    sandbox.window.zhugeOpenTfBoard();
    assert.deepEqual(navigations, [destination]);
    assert.equal(storageReads, 0);
    assert.equal(networkCalls, 0);
    assert.equal(newTabs, 0);
    const url = new URL(navigations[0]);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  });
}
test('account-menu fallback points to the same own board without a token', () => {
  const link = officeSource.match(/<a\b[^>]*id="accountHome"[^>]*>/);
  assert.ok(link);
  assert.ok(link[0].includes(`href="${destination}"`));
  assert.ok(link[0].includes('target="_top"'));
});
