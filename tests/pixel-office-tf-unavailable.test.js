'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { startTfSource } = require('../labs/pixel-office-3d/tf-source.js');
const INDEX = fs.readFileSync(require('node:path').join(__dirname, '../labs/pixel-office-3d/index.html'), 'utf8');
const res = (data, status = 200) => ({ status, json: async () => data });
const tick = () => new Promise((r) => setTimeout(r, 15));
const issuesOk = () => res({ issues: [{ id: 'i1', title: 'T', status_category: 'in_progress' }], total: 1 });

function run(fetchImpl, extra = {}) {
  globalThis.window = { fetch: fetchImpl, localStorage: { getItem: () => null } };
  const boards = [], states = [];
  const snap = { loaded: false };
  const p = startTfSource({
    intervalSec: 3600, apiBase: 'https://api.example', workspace: 'ws',
    getEmbeddedJwt: () => 'jwt',
    onData: (d) => { boards.push(d); snap.loaded = true; },
    onState: (s) => states.push(s),
    hasSnapshot: () => snap.loaded,
    ...extra,
  });
  return { p, boards, states, snap };
}

test('first read fails (network): one empty snapshot flagged tasksUnavailable with the error note', async () => {
  const { p, boards, states } = run(async () => { throw new Error('Failed to fetch'); });
  await tick();
  assert.equal(boards.length, 1);
  assert.equal(boards[0].tasksUnavailable, true);
  assert.equal(boards[0].sessions.length, 0);
  assert.match(boards[0].sourceNote, /Failed to fetch/);
  assert.match(boards[0].sourceNote, /任務資料暫時取不到，這不代表沒有任務/);
  assert.ok(states[0].error);
  p.stop(); delete globalThis.window;
});

test('first read HTTP 503: flagged unavailable, never a plain empty board', async () => {
  const { p, boards } = run(async () => res({ error: 'suspended' }, 503));
  await tick();
  assert.equal(boards.length, 1);
  assert.equal(boards[0].tasksUnavailable, true);
  p.stop(); delete globalThis.window;
});

test('later successful kick clears the flag; success then failure does not overwrite', async () => {
  let mode = 'fail';
  const f = async (u) => {
    if (mode === 'fail') throw new Error('down');
    if (u.includes('/api/issues')) return issuesOk();
    return res({});
  };
  const { p, boards } = run(f);
  await tick();
  assert.equal(boards.length, 1); assert.equal(boards[0].tasksUnavailable, true);
  mode = 'ok'; p.kick(); await tick();
  assert.equal(boards.length, 2);
  assert.equal(boards[1].tasksUnavailable, undefined);
  assert.equal(boards[1].sessions.length, 1);
  mode = 'fail'; p.kick(); await tick();
  assert.equal(boards.length, 2, 'failure after a good snapshot sends no empty overwrite');
  p.stop(); delete globalThis.window;
});

test('restart (new startTfSource) while page already has a snapshot: first failure does not wipe it', async () => {
  const { p, boards } = run(async () => { throw new Error('down'); }, { hasSnapshot: () => true });
  await tick();
  assert.equal(boards.length, 0);
  p.stop(); delete globalThis.window;
});

test('logged-out / auth-required still delivers a plain empty snapshot (wipe), not flagged unavailable', async () => {
  const { p, boards } = run(async () => res({}), { getEmbeddedJwt: () => null });
  await tick();
  assert.equal(boards.length, 1);
  assert.equal(boards[0].tasksUnavailable, undefined);
  p.stop(); delete globalThis.window;
});

test('request cadence unchanged: one poll per start, no retry loop on failure', async () => {
  let n = 0;
  const { p } = run(async () => { n++; throw new Error('down'); });
  await tick(); await tick();
  assert.equal(n, 1);
  p.stop(); delete globalThis.window;
});

test('index wiring: unavailable text/dash shown, note rendered as escaped text, hasSnapshot passed', () => {
  assert.match(INDEX, /hasSnapshot: \(\) => !!state\.loaded/);
  assert.match(INDEX, /TASKS_NA_TEXT = '任務資料暫時取不到，這不代表沒有任務。'/);
  assert.match(INDEX, /tasksNA\(\) \? '—' : n/);
  assert.match(INDEX, /sb\.innerHTML = `<b>\$\{esc\(state\.data\.sourceNote\)\}<\/b>`/);
  assert.equal((INDEX.match(/esc\(TASKS_NA_TEXT\)/g) || []).length >= 1, true);
});
