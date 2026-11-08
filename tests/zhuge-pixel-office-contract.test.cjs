"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const text = p => fs.readFileSync(path.join(root, p), 'utf8');
test('docs home embeds current 3D office without legacy furnishings overlay', () => {
  const s = text('docs/index.html');
  assert.match(s, /\.\.\/labs\/pixel-office-3d\/index\.html\?source=tf/);
  assert.doesNotMatch(s,/zhuge-office-furnishings/);
  assert.match(s, /lang="zh-TW"/);
  assert.match(s, /status-classic\.html/);
});
test('root home immediately embeds the 3D office route', () => {
  const s = text('index.html');
  assert.match(s, /labs\/pixel-office-3d\/index\.html/);
  assert.match(s, /lang="zh-TW"/);
  assert.match(s, /status-classic\.html/);
});
test('classic status preserves original root HTML', () => {
  assert.match(text('status-classic.html'), /id="tf-projects"/);
  assert.match(text('docs/status-classic.html'), /id="tf-projects"/);
  assert.doesNotMatch(text('index.html'), /id="tf-projects"/);
});
test('project status is structured and identifies source time', () => {
  const v = JSON.parse(text('docs/status/project-status.json'));
  assert.equal(v.project_name, 'Zhuge AI OS');
  assert.ok(Number.isFinite(Date.parse(v.updated_at)));
  for (const f of ['active_modules', 'blocked_items', 'next_actions', 'recent_prs'])
    assert.ok(Array.isArray(v[f]));
});
test('pixel adapter drives upstream OfficeSnapshot, not an inert array', () => {
  const bridge = text('integrations/habblaud/overrides/client/src/adapters/zhuge-bridge.ts');
  assert.match(bridge, /toOfficeSnapshot/);
  assert.match(bridge, /RoomInfo/);
  assert.match(bridge, /isFreshStatus/);
  const entry = text('integrations/habblaud/overrides/client/src/adapters/zhuge-entry.ts');
  assert.match(entry, /new EventSource/);
  assert.match(entry, /15_000/);
  assert.match(entry, /toOfficeSnapshot/);
});
test('read-only HUD does not inject project text through innerHTML', () => {
  const hud = text('integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts');
  assert.doesNotMatch(hud, /innerHTML/);
  assert.match(hud, /textContent/);
  assert.match(hud, /showZhugeDecisions/);
});
test('pinned MIT source with separated candidate artifact, no automatic deployment', () => {
  const build = text('integrations/habblaud/build.mjs');
  const flow = text('.github/workflows/zhuge-pixel-office-review.yml');
  assert.match(build, /faa1a012b5fbf632c66dc6801c5383e53a542406/);
  assert.match(build, /MIT License/);
  assert.match(flow, /NO DEPLOY/);
  assert.doesNotMatch(flow, /deploy-pages|render deploy|gh-pages/);
});

test('OAuth callbacks are routed before Pixel iframe loads', () => {
  for (const p of ['index.html','docs/index.html']) {
    const source=text(p);
    assert.ok(source.includes('zhuge-home-router.js"></script>'));
    assert.ok(!source.includes('<script defer src='));
  }
  assert.ok(text('docs/status-classic.html').includes('const root = new URL("..", current.href);'));
});
test('pixel office HUD chrome uses canonical TRQN tokens, preserves semantic colors', () => {
  const hud = text('integrations/habblaud/overrides/client/src/ui/zhuge-hud.css');
  const tokens = text('shared/theme/tokens.css');
  const dark = tokens.match(/:root\s*\{[\s\S]*?color-scheme:\s*dark/);
  assert.ok(dark, 'canonical dark token block must exist');
  for (const hex of ['#2fd7f5', '#ff9a3c']) {
    assert.ok(dark[0].includes(hex), 'canonical dark tokens must define ' + hex);
    assert.ok(hud.includes(hex), 'pixel office HUD chrome must use canonical TRQN accent ' + hex);
  }
  for (const surface of ['#0b1520', '#0d1a24'])
    assert.ok(hud.includes(surface), 'pixel office HUD chrome must use TRQN surface ' + surface);
  assert.ok(hud.includes('rgba(47,215,245,'), 'pixel office HUD borders must use TRQN border rgba');
  assert.doesNotMatch(hud, /#38bdf8/i, 'legacy slate-blue accent must not remain in pixel office HUD chrome');
  for (const semantic of ['#9f2834', '#22c55e', '#eab308', '#ef4444'])
    assert.ok(hud.includes(semantic), 'semantic status color must be preserved: ' + semantic);
});
test('pixel office HUD displays TRQN as product name without touching backend identifier', () => {
  const hud = text('integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts');
  assert.match(hud, /function displayProjectName\(/, 'display-layer mapping must exist');
  assert.match(hud, /displayProjectName\(status\.project_name\)/, 'HUD title must go through the display mapping');
  assert.match(hud, /projectName === 'Zhuge AI OS'\) return 'TRQN'/, 'mapping must render the approved TRQN name');
  const status = JSON.parse(text('docs/status/project-status.json'));
  assert.equal(status.project_name, 'Zhuge AI OS', 'backend project identifier stays unchanged');
});
