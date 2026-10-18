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
  'ui/zhuge-hud.ts', 'ui/zhuge-hud.css', 'i18n/zh-TW.ts',
]) {
  const target = file('client/src/' + r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(overlay, r), target);
}
change('client/src/app.ts',
  "import { OfficeStore } from './net/store';",
  "import { OfficeStore } from './net/store';\nimport { createZhugeStream, bootAiOsPixelHomepage } from './adapters/zhuge-entry';");
change('client/src/app.ts',
  "const store = new OfficeStore({ mock: params.has('mock') });",
  "const store = new OfficeStore({ mock: params.has('mock'), ...(!params.has('mock') ? { eventSource: createZhugeStream } : {}) });");
change('client/src/app.ts',
  "  createUI(uiRoot, store, world, city);",
  "  createUI(uiRoot, store, world, city);\n  bootAiOsPixelHomepage(store, world);");

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
console.log(JSON.stringify({ result: 'PIXEL_ARTIFACT_READY', upstreamSha: sha, output: OUTPUT, routes: ['/', '/docs/index.html'], staticPollMs: 15000 }));
