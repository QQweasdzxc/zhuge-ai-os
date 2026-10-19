'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = fs.readFileSync(path.join(__dirname, '..', 'integrations/habblaud/build.mjs'),'utf8');
const furnishings = fs.readFileSync(path.join(__dirname, '..', 'assets/zhuge-office-furnishings.js'),'utf8');
test('native camera starts mobile portrait focused without replacing overview controls',()=>{
  assert.match(build,/firstScreenOfficeTarget/);
  assert.match(build,/firstScreenPortrait/);
  assert.match(build,/firstScreenOffice\(false\)/);
  assert.match(build,/if \(framed && !userMoved && oldPortrait !== newPortrait\) firstScreenOffice\(false\)/);
  assert.match(build,/const overview = \(animate = true\)/);
  assert.match(build,/faa1a012b5fbf632c66dc6801c5383e53a542406/);
  assert.doesNotMatch(build,/Phaser/);
});
test('Cockpit pending shortcut no longer claims to be a second meeting room',()=>{
  assert.match(furnishings,/furniture\("AI 指揮艙", "艙"/);
  assert.doesNotMatch(furnishings,/furniture\("會議室"/);
  assert.match(furnishings,/cockpit: "接待區內已設置獨立會議室/);
});
