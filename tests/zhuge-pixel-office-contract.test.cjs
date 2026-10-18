"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const text = p => fs.readFileSync(path.join(root, p), 'utf8');
test('main and docs home immediately embed original Habblaud world route', () => {
  for (const p of ['index.html', 'docs/index.html']) {
    assert.match(text(p), /pixel-office\/index\.html/);
    assert.match(text(p), /lang="zh-TW"/);
    assert.match(text(p), /status-classic\.html/);
  }
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
