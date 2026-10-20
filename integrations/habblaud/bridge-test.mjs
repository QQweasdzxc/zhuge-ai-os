#!/usr/bin/env node
/** Execute the real Zhuge bridge module against isolated provenance fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const upstreamRoot = process.argv[2];
if (!upstreamRoot) throw new Error('usage bridge-test.mjs <pinned-upstream-root>');
const require = createRequire(path.join(path.resolve(upstreamRoot), 'package.json'));
const esbuild = require('esbuild');
const bridgePath = path.resolve('integrations/habblaud/overrides/client/src/adapters/zhuge-bridge.ts');
const { outputFiles } = await esbuild.build({
  entryPoints: [bridgePath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  write: false,
});
const code = outputFiles[0].text;
const bridge = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const now = Date.now();
const snapshot = (overrides = {}) => ({
  rev: 7,
  serverTime: now,
  rooms: [{ id: 'repo-room', name: 'zhuge-ai-os', slot: 0, seed: 7, createdAt: now }],
  agents: [{
    id: 'codex-main:thread-1', kind: 'main', provider: 'codex', roomId: 'repo-room',
    name: 'Codex Cloud Session', look: 'm', role: 'Agente principal', title: 'Issue #70',
    sessionId: 'codex-thread-1', account: 'codex-main', status: 'working',
    recent: [], tasks: [], startedAt: now - 20_000, lastEventAt: now, statusSince: now - 10_000,
    stats: { toolCalls: 1, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: 7,
  }],
  accounts: [{ id: 'codex-main', provider: 'codex', short: 'C', name: 'Codex account', color: '#123456',
    email: 'private@example.invalid', organization: 'private org', configDir: '/private/path', sessions: 1, usageStatus: 'disabled' }],
  meta: { demo: false, sources: [{ label: 'codex-main', provider: 'codex', path: '/private/path', sessions: 1, ok: true }], startedAt: now - 60_000, version: 'fixture', terminal: true, messages: true },
  ...overrides,
});
const status = {
  project_name: 'Zhuge AI OS', overall_status: 'blocked', current_phase: 'test', current_milestone: 'test',
  updated_at: new Date(now).toISOString(), summary: 'fixture only',
  active_modules: [{ name: 'TaskFlow', status: 'working', owner: 'Co', description: 'fixture' }],
  blocked_items: [], next_actions: [], recent_prs: [{ id: '#70', title: 'fixture PR', status: 'open', url: 'https://github.com/QQweasdzxc/zhuge-ai-os/pull/70' }],
};

assert.equal(bridge.convertStatusToPixelRooms(status, now).length, 0, 'static project and PR snapshots must never create people');
const staticOnly = bridge.toOfficeSnapshot(status, null, 1, now, now, false);
assert.equal(staticOnly.rooms.length, 1);
assert.equal(staticOnly.agents.length, 8);
assert.deepEqual(Array.from(staticOnly.agents, a => a.name), ['Jackal', 'GPT', 'Codex', 'Gem', '背地裡', '安安', '卡卡', '黑灰色小貓']);
assert.ok(staticOnly.agents.slice(0, 4).every(a => a.status === 'idle' && a.provider === undefined && a.account === 'zhuge-fixed-cast'));
assert.ok(staticOnly.agents.slice(4).every(a => a.status === 'idle' && a.provider === undefined && a.account === 'zhuge-family-cast' && a.zhugeResident));

assert.equal(bridge.verifiedHabblaudSnapshot(snapshot(), false, now), null, 'closed SSE fails closed');
assert.equal(bridge.verifiedHabblaudSnapshot(snapshot({ meta: { demo: true, sources: [], startedAt: now, version: 'demo' } }), true, now), null, 'demo data fails closed');
assert.equal(bridge.verifiedHabblaudSnapshot(snapshot({ serverTime: now - 61_000 }), true, now), null, 'stale live snapshot fails closed');
assert.equal(bridge.verifiedHabblaudSnapshot(snapshot({ meta: { demo: false, sources: [{ label: 'other', provider: 'codex', path: '/x', sessions: 1, ok: true }], startedAt: now, version: 'test' } }), true, now), null, 'source/account mismatch fails closed');
assert.equal(bridge.verifiedHabblaudSnapshot(snapshot({ agents: [{ ...snapshot().agents[0], kind: 'sub' }] }), true, now), null, 'subagents are excluded from permanent cast');

const verified = bridge.verifiedHabblaudSnapshot(snapshot(), true, now);
assert.ok(verified, 'matching live main agent with active source/account is accepted');
assert.equal(verified.agents.length, 1);
assert.equal(verified.agents[0].status, 'working');
assert.equal(verified.accounts[0].email, undefined);
assert.equal(verified.accounts[0].configDir, '');
assert.equal(verified.meta.sources[0].path, '');
const merged = bridge.toOfficeSnapshot(status, snapshot(), 2, now, now, true);
assert.equal(merged.agents.filter(a => a.id === 'codex-main:thread-1').length, 1);
assert.equal(merged.meta.terminal, false);
assert.equal(merged.meta.messages, false);
console.log('PASS P2 #70 bridge authority/provenance fixtures: static snapshots excluded; Jackal/GPT/Codex/Gem fixed; only fresh non-demo SSE with matching active source/account can provide live agent state; private source paths stripped.');
