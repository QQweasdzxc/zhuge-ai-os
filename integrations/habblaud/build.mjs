#!/usr/bin/env node
/**
 * Pinned MIT Habblaud integration for AI OS. Fail closed if upstream layout
 * changed. Requires an already-fetched checkout at the pinned commit.
 *
 * Usage: node integrations/habblaud/build.mjs <upstream-worktree> <pages-artifact-directory>
 * This is an artifact-only build, not a Production deployment or git commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const EXPECTED_UPSTREAM = 'faa1a012b5fbf632c66dc6801c5383e53a542406';
const UPSTREAM = path.resolve(process.argv[2] || '');
const OUTPUT = path.resolve(process.argv[3] || '');
const assert = (ok, label) => { if (!ok) throw new Error('PIXEL_BUILD_FAIL_CLOSED: ' + label); };
assert(process.argv[2] && process.argv[3], 'missing upstream/source output argument');
assert(!OUTPUT.startsWith(ROOT + path.sep), 'artifact output must not be inside tracked repo source');
assert(fs.statSync(UPSTREAM).isDirectory(), 'upstream source missing');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: UPSTREAM, encoding: 'utf8' }).trim();
assert(sha === EXPECTED_UPSTREAM, 'Habblaud upstream SHA mismatch: ' + sha);
const license = fs.readFileSync(path.join(UPSTREAM, 'LICENSE'), 'utf8');
assert(license.startsWith('MIT License') && license.includes('Copyright (c) 2026'), 'upstream MIT LICENSE not found');
const file = relative => path.join(UPSTREAM, relative);
function change(relative, oldPart, newPart) {
  const p = file(relative);
  const input = fs.readFileSync(p, 'utf8');
  assert(input.includes(oldPart), 'upstream API changed: ' + relative);
  fs.writeFileSync(p, input.replace(oldPart, newPart));
}
const overlay = path.join(ROOT, 'integrations/habblaud/overrides/client/src');
for (const r of [
  'adapters/zhuge-bridge.ts', 'adapters/zhuge-entry.ts',
  'adapters/zhuge-p3-bridge.ts', 'world/layout/zhuge-p3-layout.ts',
  'ui/zhuge-hud.ts', 'ui/zhuge-hud.css', 'i18n/zh-TW.ts',
]) {
  const target = file('client/src/' + r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(overlay, r), target);
}
change('client/src/app.ts',
  "import { OfficeStore } from './net/store';",
  "import { OfficeStore } from './net/store';\nimport { createZhugeStream, createP3DisplayStream, bootAiOsPixelHomepage } from './adapters/zhuge-entry';");
change('client/src/app.ts',
  "const store = new OfficeStore({ mock: params.has('mock') });",
  "const p3Preview = params.get('p3') === '1';\n  const store = new OfficeStore({ mock: params.has('mock'), ...(!params.has('mock') ? { eventSource: p3Preview ? createP3DisplayStream : createZhugeStream } : {}) });");
change('client/src/app.ts',
  "  if (store.mock) store.connect();\n  else {",
  "  if (store.mock || p3Preview) store.connect();\n  else {");
change('client/src/app.ts',
  "  createUI(uiRoot, store, world, city);",
  "  createUI(uiRoot, store, world, city);\n  bootAiOsPixelHomepage(store, world);");

// Apply the unique P3 interior only to the pinned build tree. P2 continues to
// use its original layoutProjectRoom/assembleBuilding code path unchanged.
for (const [before, after] of [
  ["import { assembleBuilding, type BuildingLayout } from '../layout/building';", "import { assembleBuilding, type BuildingLayout } from '../layout/building';\nimport { assembleP3Building, layoutP3ProjectRoom } from '../layout/zhuge-p3-layout';"],
  ["  private lastSnapshot: OfficeSnapshot | null = null;", "  private lastSnapshot: OfficeSnapshot | null = null;\n  private p3Layout = false;"],
  ["    this.lastSnapshot = input;", "    this.lastSnapshot = input;\n    this.p3Layout = input.meta.version === 'Zhuge Pixel P3';"],
  ["    const layout = layoutProjectRoom({ id: r.id, slot, seed: r.seed }, theme);", "    const layout = this.p3Layout ? layoutP3ProjectRoom({ id: r.id, slot, seed: r.seed }, theme) : layoutProjectRoom({ id: r.id, slot, seed: r.seed }, theme);"],
  ["    const building = assembleBuilding(\n      cols,\n      present.map((r) => r.layout),\n      this.layoutVersion + 1,\n    );", "    const building = this.p3Layout\n      ? assembleP3Building(cols, present.map((r) => r.layout), this.layoutVersion + 1)\n      : assembleBuilding(cols, present.map((r) => r.layout), this.layoutVersion + 1);"]
]) change('client/src/world/sim/sim.ts', before, after);

// Portfolio medals are pixel art rendered by native wall furniture in the
// temporary output; no Habblaud vendor file in the repository is edited.
change('client/src/art/api.ts',
  "  | 'poster' // 1 tile. variants: 'code' | 'coffee' | 'rocket' | 'cat' | 'bug' | 'ship_it'",
  "  | 'poster' // 1 tile. variants: 'code' | 'coffee' | 'rocket' | 'cat' | 'bug' | 'ship_it' | indoor awards");
change('client/src/art/api.ts',
  "poster: { mount: 'wall', footprint: { w: 1, h: 0 }, blocks: false, variants: ['code', 'coffee', 'rocket', 'cat', 'bug', 'ship_it'] },",
  "poster: { mount: 'wall', footprint: { w: 1, h: 0 }, blocks: false, variants: ['code', 'coffee', 'rocket', 'cat', 'bug', 'ship_it', 'award_gold', 'award_silver', 'award_bronze'] },");
change('client/src/art/furniture/wall.ts',
  "    case 'ship_it': {\n      b.rect(ix, iy, iw, ih, '#bfe3f2');",
  "    case 'award_gold':\n    case 'award_silver':\n    case 'award_bronze': {\n      const medal = variant === 'award_gold' ? '#d7aa3e' : variant === 'award_silver' ? '#9aa8b5' : '#b8784d';\n      b.rect(ix, iy, iw, ih, '#f0e7d6');\n      b.hline(ix, ix + iw - 1, iy, '#fffaf0');\n      b.rect(ix + 3, iy + 2, 2, 3, '#bb4b57');\n      b.rect(ix + 7, iy + 2, 2, 3, '#4267a2');\n      b.ellipse(ix + 6, iy + 8, 4, 4, medal);\n      b.ellipse(ix + 6, iy + 8, 2.2, 2.2, '#f7ebbd');\n      b.set(ix + 6, iy + 8, medal);\n      b.rect(ix + 4, iy + 12, 2, 2, medal);\n      b.rect(ix + 7, iy + 12, 2, 2, medal);\n      break;\n    }\n    case 'ship_it': {\n      b.rect(ix, iy, iw, ih, '#bfe3f2');");

// Preserve upstream i18n. Add an explicit Chinese locale without changing the PT/EN/ES/FR dictionaries.
change('shared/i18n.ts',
  "export type Locale = 'pt-BR' | 'en' | 'es' | 'fr';",
  "export type Locale = 'pt-BR' | 'en' | 'es' | 'fr' | 'zh-TW';");
change('shared/i18n.ts',
  "export const LOCALES: { id: Locale; name: string }[] = [",
  "export const LOCALES: { id: Locale; name: string }[] = [\n  { id: 'zh-TW', name: '繁體中文' },");
change('shared/i18n.ts',
  "  if (!s) return undefined;",
  "  if (!s) return undefined;\n  if (s === 'zh' || s === 'zh-tw' || s.startsWith('zh-hant')) return 'zh-TW';");
change('shared/i18n.ts',
  "    return 'pt-BR';\n  }\n  const env = g.process?.env ?? {};",
  "    return 'zh-TW';\n  }\n  const env = g.process?.env ?? {};");
change('shared/i18n.ts',
  "return current === 'fr' ? 'fr-FR' : current === 'en' ? 'en-US' : current === 'es' ? 'es' : 'pt-BR';",
  "return current === 'zh-TW' ? 'zh-TW' : current === 'fr' ? 'fr-FR' : current === 'en' ? 'en-US' : current === 'es' ? 'es' : 'pt-BR';");
// Keep the native World protocol's supported-locale contract aligned with the
// locally selected P3 UI locale. No World payload or remote data behavior changes.
change('shared/world/protocol.ts',
  "export const WORLD_LOCALES = ['pt-BR', 'en', 'es', 'fr'] as const;",
  "export const WORLD_LOCALES = ['zh-TW', 'pt-BR', 'en', 'es', 'fr'] as const;");
change('client/src/main.ts',
  "const LOADERS: Partial<Record<Locale, () => Promise<Readonly<Record<string, string>>>>> = {",
  "const LOADERS: Partial<Record<Locale, () => Promise<Readonly<Record<string, string>>>>> = {\n  'zh-TW': () => import('./i18n/zh-TW').then(m => m.zhTW),");
change('vite.config.ts', "export default defineConfig({", "export default defineConfig({\n  base: './',");

// The upstream hardcodes root asset URLs. On a GitHub Pages project path,
// these would resolve outside /zhuge-ai-os/. Rewrite ONLY static /assets/ URLs
// in the imported checkout, not the repository's frozen vendor Source.
function fixAssets(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) fixAssets(p);
    else if (/\.(?:ts|tsx|js|css|html)$/.test(d.name)) {
      const before = fs.readFileSync(p, 'utf8');
      const after = before.replace(/(["'])\/assets\//g, '$1./assets/').replaceAll('`/assets/', '`./assets/').replaceAll('url(/assets/', 'url(./assets/');
      if (after !== before) fs.writeFileSync(p, after);
    }
  }
}
fixAssets(file('client/src'));
fs.writeFileSync(file('client/index.html'), fs.readFileSync(file('client/index.html'), 'utf8').replace(/(["'])\/assets\//g, '$1./assets/'));

// CI installs the pinned upstream lockfile prior to this step.
execFileSync('npm', ['run', 'build:client'], { cwd: UPSTREAM, stdio: 'inherit' });
const dist = file('dist/client');
assert(fs.existsSync(path.join(dist, 'index.html')), 'upstream Vite did not output index.html');
assert(fs.readdirSync(path.join(dist, 'bundle')).some(name => name.endsWith('.js')), 'no compiled game JS');
for (const dest of [path.join(OUTPUT, 'pixel-office'), path.join(OUTPUT, 'docs/pixel-office')]) {
  fs.cpSync(dist, dest, { recursive: true, force: false, errorOnExist: false });
  fs.copyFileSync(file('LICENSE'), path.join(dest, 'LICENSE.txt'));
}
for (const route of ['status', 'docs/status']) {
  fs.mkdirSync(path.join(OUTPUT, route), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'docs/status/project-status.json'), path.join(OUTPUT, route, 'project-status.json'));
}
fs.mkdirSync(path.join(OUTPUT, 'docs'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'docs/index.html'), path.join(OUTPUT, 'docs/index.html'));
fs.copyFileSync(path.join(ROOT, 'docs/status-classic.html'), path.join(OUTPUT, 'docs/status-classic.html'));
const p3Preview = path.join(OUTPUT, 'labs/pixel-office-p3-preview');
fs.cpSync(path.join(ROOT, 'labs/pixel-office-p3-preview'), p3Preview, { recursive: true, force: true });
const p3Native = path.join(p3Preview, 'native');
fs.cpSync(dist, p3Native, { recursive: true, force: true });
fs.copyFileSync(file('LICENSE'), path.join(p3Native, 'LICENSE.txt'));
console.log(JSON.stringify({ result: 'PIXEL_ARTIFACT_READY', upstreamSha: sha, output: OUTPUT, routes: ['/', '/docs/index.html'], staticPollMs: 15000 }));
