'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const text = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('mobile HUD is compact by default, expandable and keeps real engineering controls', () => {
  const ts = text('integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts');
  const css = text('integrations/habblaud/overrides/client/src/ui/zhuge-hud.css');
  assert.match(ts, /zhuge-hud-menu-toggle/);
  assert.match(ts, /aria-expanded/);
  assert.match(ts, /bar\.dataset\.open/);
  assert.match(ts, /showZhugeDecisions/);
  assert.match(ts, /showZhugeRole/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /max-height:520px\) and \(max-width:900px/);
  assert.match(css, /data-open="true"/);
  assert.match(css, /safe-area-inset-top/);
});

test('real native awards remain and compact inspector opens only on demand', () => {
  const js = text('assets/zhuge-office-furnishings.js');
  const css = text('assets/zhuge-office-furnishings.css');
  assert.match(js, /setBoard\(false\)/);
  assert.match(js, /toggle\.textContent = open \? "−" : "🏆"/);
  assert.match(css, /\.zgf-awards\[data-open="false"\]/);
  assert.match(js, /dataset\.sceneAnchor = "core:recepcao"/);
  for (const key of ['taskflow','worklog','investment','lab']) assert.ok(js.includes('id: "'+key+'"'));
});

test('original Portuguese room labels have explicit zh-TW mappings without vendor source edits', () => {
  const dict = text('integrations/habblaud/overrides/client/src/i18n/zh-TW.ts');
  const build = text('integrations/habblaud/build.mjs');
  for (const title of ['Recepção','Copa','Banheiros','Lounge']) assert.ok(dict.includes("'"+title+"':"));
  assert.match(build, /faa1a012b5fbf632c66dc6801c5383e53a542406/);
});

test('visual screenshots wait for native snapshot, initialized scene and hidden Habblaud splash', () => {
  const smoke = text('integrations/habblaud/smoke.mjs');
  assert.match(smoke, /async function waitForNativeReady/);
  assert.match(smoke, /\.ui-splash/);
  assert.match(smoke, /pointerEvents === 'none'/);
  assert.match(smoke, /sim\?\.initialized/);
  assert.match(smoke, /store\?\.snapshot/);
  assert.match(smoke, /pixel-office\/index\.html\?hora=23/);
  assert.match(smoke, /waitForNativeViewport\(phone,390,844\)/);
  assert.match(smoke, /requestAnimationFrame/);
});
