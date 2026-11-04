const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const three = fs.readFileSync(path.join(root, 'labs/pixel-office-3d/office3d.js'), 'utf8');
const two = fs.readFileSync(path.join(root, 'labs/pixel-office-3d/office.js'), 'utf8');
test('ERP poster has independent 3D and 2D same-tab entry', () => {
  assert.ok(three.includes('y.erpPoster&&(this.erpWall=A)'));
  assert.ok(three.includes('this.pushWallHit(this.erpWall,"erp-wall",.9,1)'));
  assert.ok(three.includes('this.hoverKey==="erp-wall"'));
  assert.ok(two.includes("click && key === 'erp-wall'"));
  for (const source of [three, two]) assert.ok(source.includes('https://qqweasdzxc.github.io/zhuge-ai-os/ZG-ERP/'));
});
test('padded ERP/TF hits stay separate and at least 44 CSS px on narrow viewport', () => {
  const start = three.indexOf('pushTfWallHit(){');
  const end = three.indexOf('build(){', start);
  const body = three.slice(start + 'pushTfWallHit(){'.length, end - 1);
  const context = { hit: [], pushWallHit(_mesh, key) { this.hit.push(key === 'tf-wall'
    ? { key, x0:54, x1:98, y0:325, y1:369 }
    : { key, x0:83, x1:127, y0:310, y1:354 }); } };
  vm.runInNewContext('(function(){' + body + '}).call(ctx)', { ctx: context });
  const [tf, erp] = context.hit;
  for (const h of [tf, erp]) { assert.ok(h.x1-h.x0 >= 44); assert.ok(h.y1-h.y0 >=44); }
  assert.ok(tf.x1 <= erp.x0);
  assert.ok(105 >= erp.x0 && 105 <= erp.x1, 'visible ERP center remains in ERP target');
  assert.ok(76 >= tf.x0 && 76 <= tf.x1, 'visible TF center remains in TF target');
});
