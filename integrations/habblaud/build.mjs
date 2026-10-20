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
  'adapters/zhuge-bridge.ts', 'adapters/zhuge-entry.ts', 'adapters/zhuge-weather.ts', 'adapters/zhuge-weather.test.ts',
  'adapters/zhuge-taskflow-run-status.ts', 'adapters/zhuge-taskflow-run-status.test.ts',
  'adapters/zhuge-gpt-helper-lifecycle.ts', 'adapters/zhuge-gpt-helper-lifecycle.test.ts',
  'ui/zhuge-hud.ts', 'ui/zhuge-hud.css', 'i18n/zh-TW.ts', 'i18n/zh-TW.test.ts',
  'world/layout/zhuge-reception.ts', 'world/layout/zhuge-reception.test.ts',
  'world/sim/zhuge-safe-path.test.ts',
]) {
  const target = file('client/src/' + r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(overlay, r), target);
}
// UI-only locales can exceed the independently versioned Habblaud World wire
// protocol. Keep zh-TW local while sending a protocol-supported locale outward.
for (const r of ['world/locale.ts', 'world/locale.test.ts']) {
  const target = file('shared/' + r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'integrations/habblaud/overrides/shared', r), target);
}
change('client/src/ui/world/settings-world.ts',
  "import { getLocale, intlLocale, tr } from '../../../../shared/i18n';",
  "import { getLocale, intlLocale, tr } from '../../../../shared/i18n';\nimport { toWorldLocale } from '../../../../shared/world/locale';");
change('client/src/ui/world/settings-world.ts',
  "locale: getLocale() }), email.input);",
  "locale: toWorldLocale(getLocale()) }), email.input);");
change('server/index.ts',
  "import type { WorldLocale } from '../shared/world/protocol';",
  "import type { WorldLocale } from '../shared/world/protocol';\nimport { toWorldLocale } from '../shared/world/locale';");
change('server/index.ts',
  "locale: () => getLocale() as WorldLocale,",
  "locale: () => toWorldLocale(getLocale()),");
change('server/world/service.ts',
  "import { getLocale, tr } from '../../shared/i18n';",
  "import { getLocale, tr } from '../../shared/i18n';\nimport { toWorldLocale } from '../../shared/world/locale';");
change('server/world/service.ts',
  "const locale = input.locale ?? this.o.locale?.() ?? (getLocale() as WorldLocale);",
  "const locale = input.locale ?? this.o.locale?.() ?? toWorldLocale(getLocale());");
change('shared/world/protocol.test.ts',
  "it('ids fixos do contrato: 14 traços, 5 pares que não combinam, 20 frases, 10 cumprimentos, 4 idiomas', () => {",
  "it('ids fixos do contrato: 14 traços, 5 pares que não combinam, 20 frases, 10 cumprimentos e idiomas do protocolo', () => {");
change('shared/world/protocol.test.ts',
  "expect([...WORLD_LOCALES]).toEqual(UI_LOCALES.map((l) => l.id));",
  "expect([...WORLD_LOCALES].every((locale) => UI_LOCALES.some((ui) => ui.id === locale))).toBe(true);\n    // zh-TW is a local UI locale; it is normalized to a supported World locale at the boundary.\n    expect(UI_LOCALES.some((ui) => ui.id === 'zh-TW')).toBe(true);");
change('client/src/world/layout/core.ts',
  "import type { WallStyle } from '../../art/api';",
  "import type { WallStyle } from '../../art/api';\nimport { integrateZhugeReception } from './zhuge-reception';");
change('client/src/world/layout/core.ts',
  "  return a;\n}\n\nexport function layoutRestroom()",
  "  return integrateZhugeReception(a, wall);\n}\n\nexport function layoutRestroom()");
change('client/src/ui/help.ts',
  "h('section', {}, h('h3', { text: 'Status' }), statusList),",
  "h('section', {}, h('h3', { text: tr('Status') }), statusList),");
// P0: expose the actual lighting state for deterministic visual regression.
change('client/src/world/debug.ts',
  "  readonly camera: Camera;",
  "  readonly camera: Camera;\n  /** Effective testable daylight state from the real native renderer. */\n  lightingSnapshot(): { hourOverride: number | null; renderedHour: number; ambientNight: number };");
change('client/src/world/debug.ts',
  "    sim,\n    camera,\n  };",
  "    sim,\n    camera,\n    lightingSnapshot: () => ({ hourOverride: renderer.hourOverride, renderedHour: renderer.lighting.ambient.hour, ambientNight: renderer.night }),\n  };");
// P0: restore accurate labels on Habblaud's existing native core rooms.
change('client/src/world/render/overlay.ts',
  "import { tr } from '../../../../shared/i18n';",
  "import { tr } from '../../../../shared/i18n';\nimport { activityTextForLocale } from '../../i18n/zh-TW';");
change('client/src/world/render/overlay.ts',
  "const text = room ? room.info.name : vis.id === 'core:recepcao' ? 'Habblaud' : null;",
  "const text = room ? room.info.name : CORE_NAMES[vis.id] ?? null;");
change('client/src/world/render/overlay.ts',
  "if (room ? readable : zoom >= 1.4) continue;",
  "if (vis.id === 'core:recepcao' && zoom >= 0.75) {\n        // The meeting room is a real partitioned bay inside Reception. Place its\n        // label just inside the north wall, away from the doorway and furniture.\n        const mx = this.sx((r.x + 12) * TILE);\n        const my = this.sy((r.y + 2.65) * TILE);\n        if (mx > -120 && mx < vw + 120 && my > -30 && my < vh + 30) this.drawCorePill(tr('Sala de reuniões'), mx, my, 7 * TILE * zoom - 8);\n      }\n      if (room ? readable : readable || zoom < 0.55) continue;");
change('client/src/world/render/overlay.ts',
  "        this.drawCorePill(CORE_NAMES[vis.id], cx, cy, colW - 8);\n      }\n    }\n  }",
  "        this.drawCorePill(CORE_NAMES[vis.id], cx, cy, colW - 8);\n      }\n    }\n  }");
change('client/src/world/render/overlay.ts',
  "this.takeBubble(ch, head, act.icon, act.text,",
  "this.takeBubble(ch, head, act.icon, activityTextForLocale(act),");
change('client/src/world/render/overlay.ts',
  "this.takeBubble(ch, head, act.icon, act.text,",
  "this.takeBubble(ch, head, act.icon, activityTextForLocale(act),");
change('client/src/world/render/overlay.ts',
  "this.takeBubble(ch, head, act.icon, act.text,",
  "this.takeBubble(ch, head, act.icon, activityTextForLocale(act),");
change('client/src/world/render/overlay.ts',
  "this.takeBubble(ch, head, act.icon, act.text,",
  "this.takeBubble(ch, head, act.icon, activityTextForLocale(act),");
// Localize actual event summaries across native UI surfaces. Raw user-authored
// terminal transcripts remain untouched; zh-TW omits untranslated PT details.
change('client/src/ui/feed.ts',
  "import { tr } from '../../../shared/i18n';",
  "import { tr } from '../../../shared/i18n';\nimport { activityDetailForLocale, activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/feed.ts',
  "latest.activity.icon} ${latest.activity.text}` : ''",
  "latest.activity.icon} ${activityTextForLocale(latest.activity)}` : ''");
change('client/src/ui/feed.ts', "setText(text, f.activity.text);", "setText(text, activityTextForLocale(f.activity));");
change('client/src/ui/feed.ts',
  "setTitle(btn, `${formatClock(f.activity.at)} · ${f.agentName} em ${f.roomName}\\n${f.activity.text}${f.activity.detail ? `\\n${f.activity.detail}` : ''}`);",
  "const activityText = activityTextForLocale(f.activity);\n    const detail = activityDetailForLocale(f.activity);\n    setTitle(btn, `${formatClock(f.activity.at)} · ${f.agentName} em ${f.roomName}\\n${activityText}${detail ? `\\n${detail}` : ''}`);");
change('client/src/ui/widgets.ts',
  "import { tr } from '../../../shared/i18n';",
  "import { tr } from '../../../shared/i18n';\nimport { activityDetailForLocale, activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/widgets.ts', "setText(text, activity?.text ?? fallback);", "setText(text, activity ? activityTextForLocale(activity) : fallback);");
change('client/src/ui/widgets.ts',
  "setTitle(el, activity ? (activity.detail ? `${activity.text}\\n${activity.detail}` : activity.text) : fallback);",
  "const summary = activity ? activityTextForLocale(activity) : fallback;\n  const detail = activity ? activityDetailForLocale(activity) : undefined;\n  setTitle(el, activity ? (detail ? `${summary}\\n${detail}` : summary) : fallback);");
change('client/src/ui/drawer.ts',
  "import { roomTheme } from '../art';",
  "import { roomTheme } from '../art';\nimport { activityDetailForLocale, activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/drawer.ts',
  "setText(this.actText, act?.text ?? activityFallback(a));",
  "setText(this.actText, act ? activityTextForLocale(act) : activityFallback(a));");
change('client/src/ui/drawer.ts', "const detail = act?.detail ?? '';", "const detail = act ? activityDetailForLocale(act) ?? '' : '';");
change('client/src/ui/drawer.ts',
  "setText(text, who ? `${who}: ${a.text}` : a.text);",
  "setText(text, who ? `${who}: ${activityTextForLocale(a)}` : activityTextForLocale(a));");
change('client/src/ui/drawer.ts',
  "setTitle(li, `${formatClock(a.at)} · ${a.text}${a.detail ? `\\n${a.detail}` : ''}`);",
  "const activityText = activityTextForLocale(a);\n  const detail = activityDetailForLocale(a);\n  setTitle(li, `${formatClock(a.at)} · ${activityText}${detail ? `\\n${detail}` : ''}`);");
change('client/src/ui/termtabs.ts',
  "import { tr } from '../../../shared/i18n';",
  "import { tr } from '../../../shared/i18n';\nimport { activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/termtabs.ts',
  "return a.activity?.text ?? activityFallback(a);",
  "return a.activity ? activityTextForLocale(a.activity) : activityFallback(a);");
change('client/src/ui/rows.ts',
  "import { tr } from '../../../shared/i18n';",
  "import { tr } from '../../../shared/i18n';\nimport { activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/rows.ts',
  "agent.activity?.text;",
  "agent.activity ? activityTextForLocale(agent.activity) : undefined;");
change('client/src/ui/terminal.ts',
  "import { intlLocale, tr } from '../../../shared/i18n';",
  "import { intlLocale, tr } from '../../../shared/i18n';\nimport { activityTextForLocale } from '../i18n/zh-TW';");
change('client/src/ui/terminal.ts',
  "const act = agent.activity?.text?.trim().replace(/(?:…|\\.{1,3})$/, '');",
  "const act = agent.activity ? activityTextForLocale(agent.activity).trim().replace(/(?:…|\\.{1,3})$/, '') : undefined;");
// P2 #91: portrait balances the Reception entrance with the cafe/work and lounge
// rooms. The native awards/meeting room remain visible and fully reachable by pan.
change('client/src/world/index.ts',
  "  const overview = (animate = true) => {",
  `  const firstScreenOfficeTarget = () => {
    const b = buildingRect();
    // Show the east side of Reception plus most of the adjacent cafe/work and lounge
    // column. This keeps the awards/meeting room findable without making the restroom
    // the mobile home screen's largest room.
    const focus = { x: COL_W * TILE * 0.60, y: b.y - TILE * 0.75, w: COL_W * TILE * 1.14, h: b.h };
    // Fill the usable portrait height with the real rooms without cropping small screens.
    const freeHeight = Math.max(240, camera.viewH - camera.insets.top - camera.insets.bottom - 32);
    const detailZoom = Math.min(1.30, freeHeight / b.h);
    const z = Math.min(2.5, Math.max(camera.minZoom, detailZoom, camera.fitZoom(focus, 14)));
    const c = camera.centerFor(focus.x + focus.w / 2, focus.y + focus.h / 2, z);
    return { x: c.x, y: c.y, zoom: z };
  };
  const firstScreenPortrait = () => camera.viewW <= 980 && camera.viewH > camera.viewW * 1.12;
  const firstScreenOffice = (animate = false) => {
    camera.follow = null;
    const o = firstScreenPortrait() ? firstScreenOfficeTarget() : overviewTarget();
    if (animate) camera.animateTo(o.x, o.y, o.zoom, Date.now(), 420);
    else {
      camera.stop(); camera.x = o.x; camera.y = o.y; camera.zoom = o.zoom; camera.clamp();
    }
  };

  const overview = (animate = true) => {`);
change('client/src/world/index.ts',
  "          overview(false);\n          framed = true;",
  "          firstScreenOffice(false);\n          framed = true;");
change('client/src/world/index.ts',
  "        } else if (!userMoved) overview(true);",
  "        } else if (!userMoved) firstScreenOffice(true);");
change('client/src/world/index.ts',
  "      if (!userMoved && framed) overview(true);",
  "      if (!userMoved && framed) firstScreenOffice(true);");
change('client/src/world/index.ts',
  "    camera.setView(w, h, dpr);\n    updateBounds();",
  "    const oldPortrait = camera.viewW <= 980 && camera.viewH > camera.viewW * 1.12;\n    camera.setView(w, h, dpr);\n    updateBounds();\n    const newPortrait = camera.viewW <= 980 && camera.viewH > camera.viewW * 1.12;\n    if (framed && !userMoved && oldPortrait !== newPortrait) firstScreenOffice(false);");
// Native A* already follows the real WalkGrid. Its no-path fallback teleported
// a character onto an unreachable goal; keep the Habblaud Sim, but fail closed.
change('client/src/world/sim/sim.ts',
  "      if (!this.findPath(ch.tx, ch.ty, s.tx, s.ty, s.path)) {\n        // sem caminho (não deveria acontecer): teletransporta para não travar\n        ch.placeAtTile(s.tx, s.ty);\n        s.path.length = 0;\n      }",
  "      if (!this.findPath(ch.tx, ch.ty, s.tx, s.ty, s.path)) {\n        // P2 #72: no legal route means remain at the current tile. Release any\n        // temporary activity reservation and retry after a short bounded pause.\n        this.clearPlan(ch);\n        ch.thinkAt = this.now + 1500;\n        ch.setPose('stand', 'none');\n        return true;\n      }");
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
