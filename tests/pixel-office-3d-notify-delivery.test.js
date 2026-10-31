"use strict";
// Regression: 「完成時通知我」delivery chain, fully isolated (no network, no
// real session, no real task; every HTTP call is a stub and every token a
// fixture string). Covers the ACTUAL production delivery path: the real
// tf-source.js pollTfOnce builds sessions, the real notify-rules.js decides,
// and the alert-delivery block is sliced VERBATIM out of
// labs/pixel-office-3d/index.html (the marker assert fails loudly if that
// block moves). A real task reaching done=核定完成 in production is verified
// separately and is not claimed here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "labs/pixel-office-3d/index.html"), "utf8");

// Slice the exact production alert block out of index.html: from the decide
// call through the delivery loop, stopping before state.feed assignment.
const startMark = "const decided = NotifyRules.decide(state.prev, data.sessions);";
const endMark = "state.feed = data;";
const si = INDEX.indexOf(startMark);
const ei = INDEX.indexOf(endMark);
assert.ok(si > 0 && ei > si, "alert block markers must exist verbatim in index.html");
const ALERT_BLOCK = INDEX.slice(si, ei);

function makeWorld(issuesByPoll) {
  const calls = { notification: [], chime: [] };
  let poll = 0;
  const reply = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  const fetchStub = async (url) => {
    const u = String(url);
    if (u.endsWith("/auth/zhuge")) return reply(200, { token: "fixture-jwt" });
    if (u.includes("/api/issues?")) return reply(200, { issues: issuesByPoll[Math.min(poll++, issuesByPoll.length - 1)] });
    if (u.includes("/api/projects")) return reply(200, { projects: [] });
    if (u.includes("/api/zhuge/native-ai-tasks")) return reply(200, { tasks: [] });
    if (u.includes("/comments")) return reply(200, { comments: [] });
    throw new Error("unexpected fetch: " + u);
  };
  function NotificationStub(title, opts) { calls.notification.push({ title, opts }); }
  NotificationStub.permission = "granted";
  const sandbox = {
    console,
    PIP: false,
    L: { doneNote: (p) => `完成：${p}`, stuck: (n) => `卡住 ${n}`, waiting: '需要你' },
    state: { prev: new Map(), flash: new Set(), notify: true, sound: true },
    Notification: NotificationStub,
    chime: (kind) => calls.chime.push(kind),
    fetch: fetchStub,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const tfSrc = fs.readFileSync(path.join(ROOT, "labs/pixel-office-3d/tf-source.js"), "utf8");
  const nrSrc = fs.readFileSync(path.join(ROOT, "labs/pixel-office-3d/notify-rules.js"), "utf8");
  vm.runInContext(tfSrc + "\n;\n" + nrSrc + "\n;this.__TfSource = TfSource;", sandbox, { filename: "bundle.js" });
  const runAlertBlock = (sessions) => vm.runInContext(
    "{ data = { sessions: " + JSON.stringify(sessions) + " };\n" + ALERT_BLOCK + "\n}",
    Object.assign(sandbox, { data: null }), { filename: "alert-block.js" });
  const pollOpts = { apiBase: "https://tf.example", workspace: "demo-ws", supabaseToken: "fixture-supa-token" };
  const pollOnce = () => sandbox.__TfSource.pollTfOnce(fetchStub, "", Date.now(), pollOpts);
  return { sandbox, calls, runAlertBlock, pollOnce };
}

const issue = (status) => ({
  id: "11111111-2222-3333-4444-555555555555",
  identifier: "ZG-T1",
  title: "隔離測試卡",
  status_category: status,
  assignee_type: "agent",
  project_id: null,
  updated_at: "2026-11-01T00:00:00Z",
});

test("in_progress -> done across two polls fires exactly one done Notification + done chime (simulated)", async () => {
  const w = makeWorld([[issue("in_progress")], [issue("done")], [issue("done")]]);
  const r1 = await w.pollOnce();
  assert.equal(r1.state, "ok");
  assert.equal(r1.sessions[0].tf.issueStatus, "in_progress");
  w.runAlertBlock(r1.sessions);
  assert.equal(w.calls.notification.length, 0, "first snapshot never alerts");

  const r2 = await w.pollOnce();
  assert.equal(r2.sessions[0].tf.issueStatus, "done");
  w.runAlertBlock(r2.sessions);
  assert.equal(w.calls.notification.length, 1, "one done notification");
  assert.equal(w.calls.notification[0].opts.tag, r2.sessions[0].key);
  assert.deepEqual(w.calls.chime, ["done"]);

  w.runAlertBlock((await w.pollOnce()).sessions);
  assert.equal(w.calls.notification.length, 1, "unchanged done card does not re-alert");
  assert.equal(w.calls.chime.length, 1);
});

test("in_progress -> in_review fires attention (待稽核需要你), in_review -> done fires done (核定完成) (simulated)", async () => {
  const w = makeWorld([[issue("in_progress")], [issue("in_review")], [issue("done")]]);
  w.runAlertBlock((await w.pollOnce()).sessions); // first snapshot
  w.runAlertBlock((await w.pollOnce()).sessions); // -> in_review
  assert.equal(w.calls.notification.length, 1, "in_review alerts as attention, not done");
  assert.deepEqual(w.calls.chime, ["attention"]);
  w.runAlertBlock((await w.pollOnce()).sessions); // -> done
  assert.equal(w.calls.notification.length, 2, "in_review -> done counts as completion");
  assert.deepEqual(w.calls.chime, ["attention", "done"]);
});

test("gating: notify off, permission denied, sound off each suppress their channel (simulated)", async () => {
  const w = makeWorld([[issue("in_progress")], [issue("done")]]);
  w.runAlertBlock((await w.pollOnce()).sessions);
  w.sandbox.state.notify = false;
  w.sandbox.state.sound = false;
  w.runAlertBlock((await w.pollOnce()).sessions);
  assert.equal(w.calls.notification.length, 0, "notify toggle off suppresses Notification");
  assert.equal(w.calls.chime.length, 0, "sound off suppresses chime");
});

test("notification permission not granted suppresses Notification but chime still fires (simulated)", async () => {
  const w = makeWorld([[issue("in_progress")], [issue("done")]]);
  w.sandbox.Notification.permission = "denied";
  w.runAlertBlock((await w.pollOnce()).sessions);
  w.runAlertBlock((await w.pollOnce()).sessions);
  assert.equal(w.calls.notification.length, 0);
  assert.deepEqual(w.calls.chime, ["done"]);
});
