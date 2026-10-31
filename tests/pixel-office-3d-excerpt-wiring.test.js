"use strict";
// Regression: 對話摘錄 minimal wiring, fully isolated (no network, fixture
// tokens). The fixtures follow the server's own serialization contract
// (pkg/protocol/messages.go TaskMessagePayload; ListTaskMessagesByUser
// returns a bare JSON array). A fixture 200 proves ONLY that this client
// wiring handles the documented shape — it is not evidence that any real
// workspace task returns content; live workspaces today have no bound
// taskflow_task_id, and the honest empty state covers that.
const test = require("node:test");
const assert = require("node:assert/strict");
const TfSource = require("../labs/pixel-office-3d/tf-source.js");

const reply = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test("normalizeTfIssues carries taskflow_task_id as tf.taskflowTaskId, null when unbound", () => {
  const issues = [
    { id: "i-bound", title: "bound", status_category: "in_progress", assignee_type: "agent" },
    { id: "i-free", title: "free", status_category: "todo", assignee_type: "agent" },
  ];
  const nativeByIssueId = { "i-bound": { issue_id: "i-bound", executor_id: "CO-01", taskflow_task_id: "queue-uuid-1", taskflow_task_status: "running" } };
  const sessions = TfSource.normalizeTfIssues(issues, { nativeByIssueId, now: 0 });
  assert.equal(sessions[0].tf.taskflowTaskId, "queue-uuid-1");
  assert.equal(sessions[1].tf.taskflowTaskId, null);
});

test("fetchTaskMessages maps the protocol payload into plain display entries", async () => {
  const payload = [
    { task_id: "queue-uuid-1", issue_id: "i-bound", seq: 1, type: "text", content: "先查來源", created_at: "2026-11-01T00:00:01Z" },
    { task_id: "queue-uuid-1", issue_id: "i-bound", seq: 2, type: "tool_use", tool: "web_search", input: { q: "x" }, created_at: "2026-11-01T00:00:02Z" },
    { task_id: "queue-uuid-1", issue_id: "i-bound", seq: 3, type: "tool_result", tool: "web_search", output: "3 hits", output_truncated: true, created_at: "2026-11-01T00:00:03Z" },
    { task_id: "queue-uuid-1", issue_id: "i-bound", seq: 4, type: "error", content: "boom", created_at: "2026-11-01T00:00:04Z" },
    { task_id: "queue-uuid-1", issue_id: "i-bound", seq: 5, type: "text", content: "   " }, // blank skipped
  ];
  let calledUrl = null;
  const fetchStub = async (url) => { calledUrl = String(url); return reply(200, payload); };
  const r = await TfSource.fetchTaskMessages(fetchStub, "https://tf.example", { authorization: "Bearer j" }, "queue-uuid-1");
  assert.equal(r.ok, true);
  assert.equal(calledUrl, "https://tf.example/api/tasks/queue-uuid-1/messages", "reads only the given task id");
  assert.deepEqual(r.messages.map((m) => m.role), ["assistant", "tool", "tool", "assistant"]);
  assert.equal(r.messages[0].text, "先查來源");
  assert.equal(r.messages[1].text, "web_search");
  assert.equal(r.messages[2].text, "web_search: 3 hits…", "truncated tool output is marked");
  assert.equal(r.messages[0].at, Date.parse("2026-11-01T00:00:01Z"));
});

test("fetchTaskMessages never fires a request without a bound task id", async () => {
  let calls = 0;
  const r = await TfSource.fetchTaskMessages(async () => { calls++; throw new Error("must not fetch"); }, "https://tf.example", {}, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-task");
  assert.equal(calls, 0);
});

test("fetchTaskMessages is best-effort: http error, network error, bad shape all yield ok:false", async () => {
  assert.deepEqual(await TfSource.fetchTaskMessages(async () => reply(404, { error: "task not found" }), "https://tf.example", {}, "x"),
    { ok: false, reason: "http", status: 404 });
  assert.equal((await TfSource.fetchTaskMessages(async () => { throw new Error("down"); }, "https://tf.example", {}, "x")).reason, "network");
  assert.equal((await TfSource.fetchTaskMessages(async () => reply(200, { not: "an array" }), "https://tf.example", {}, "x")).reason, "bad-shape");
});

test("fetchTaskMessages on a bound-but-empty task returns ok with zero messages (honest empty state)", async () => {
  const r = await TfSource.fetchTaskMessages(async () => reply(200, []), "https://tf.example", {}, "queue-uuid-1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.messages, []);
});

// --- detail-panel loadConvo guards, sliced VERBATIM from index.html --------
// These cover the browser wiring that switches cards and handles failures;
// the marker assert fails loudly if the function moves or is renamed.
const fs = require("node:fs");
const nodePath = require("node:path");
const vm = require("node:vm");
const INDEX = fs.readFileSync(nodePath.join(__dirname, "..", "labs/pixel-office-3d/index.html"), "utf8");
const lcStart = INDEX.indexOf("async function loadConvo(s) {");
const lcEnd = INDEX.indexOf("document.getElementById('sideHide').addEventListener");
assert.ok(lcStart > 0 && lcEnd > lcStart, "loadConvo markers must exist verbatim in index.html");
const LOADCONVO_SRC = INDEX.slice(lcStart, lcEnd);

function makeConvoWorld() {
  const calls = { renderDetail: 0 };
  const sandbox = {
    console,
    TF_MODE: true,
    sel: null,
    renderDetail: () => { calls.renderDetail++; },
    window: {},
    fetch: async () => { throw new Error("no network in this test"); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext("var convo = { key: null, at: null, messages: null, private: false, busy: false, failed: false };\n" + LOADCONVO_SRC, sandbox, { filename: "loadconvo.js" });
  return { sandbox, calls };
}

const boundCard = (key, tid) => ({ key, tf: { isAgentCard: true, taskflowTaskId: tid }, lastEventAt: 1 });

test("a slow excerpt fetch for card A never writes into card B after switching (verbatim loadConvo)", async () => {
  const { sandbox, calls } = makeConvoWorld();
  let resolveA;
  sandbox.window.loadTfTaskExcerpts = (tid) => tid === "task-A" ? new Promise((res) => { resolveA = res; }) : Promise.resolve({ ok: true, messages: [{ role: "assistant", text: "B 內容", at: 1 }] });
  sandbox.sel = "zhuge:A";
  const pA = sandbox.loadConvo(boundCard("zhuge:A", "task-A"));
  // User switches to card B before A resolves: openDetail resets convo to B.
  sandbox.sel = "zhuge:B";
  vm.runInContext("convo = { key: 'zhuge:B', at: null, messages: null, private: false, busy: false, failed: false };", sandbox);
  const pB = sandbox.loadConvo(boundCard("zhuge:B", "task-B"));
  resolveA({ ok: true, messages: [{ role: "assistant", text: "A 私密內容", at: 1 }] });
  await Promise.all([pA, pB]);
  const c = vm.runInContext("convo", sandbox);
  assert.equal(c.key, "zhuge:B");
  assert.ok(!JSON.stringify(c).includes("A 私密內容"), "card A content never lands in card B state");
  assert.equal(JSON.stringify(c.messages), JSON.stringify([{ role: "assistant", text: "B 內容", at: 1 }]));
});

test("auth failure / 404 replaces content with an explicit failed state, never stale private content (verbatim loadConvo)", async () => {
  const { sandbox } = makeConvoWorld();
  sandbox.window.loadTfTaskExcerpts = async () => ({ ok: false, reason: "auth" });
  sandbox.sel = "zhuge:A";
  // Pre-existing content from an earlier card must be replaced, not retained.
  vm.runInContext("convo = { key: 'zhuge:OLD', at: 0, messages: [{ role: 'assistant', text: '前卡私密內容', at: 0 }], private: false, busy: false, failed: false };", sandbox);
  await sandbox.loadConvo(boundCard("zhuge:A", "task-A"));
  const c = vm.runInContext("convo", sandbox);
  assert.equal(c.failed, true);
  assert.equal(JSON.stringify(c.messages), "[]", "failed read leaves no messages behind");
  assert.ok(!JSON.stringify(c).includes("前卡私密內容"));
  assert.ok(!JSON.stringify(c).includes("fixture") && !JSON.stringify(c).includes("token"), "no token material in panel state");
});

test("fetchTaskMessages results carry no token material (keys are ok/messages/reason/status only)", async () => {
  const ok = await TfSource.fetchTaskMessages(async () => reply(200, []), "https://tf.example", { authorization: "Bearer secret-jwt" }, "t1");
  assert.deepEqual(Object.keys(ok).sort(), ["messages", "ok"]);
  const bad = await TfSource.fetchTaskMessages(async () => reply(401, {}), "https://tf.example", { authorization: "Bearer secret-jwt" }, "t1");
  assert.deepEqual(Object.keys(bad).sort(), ["ok", "reason", "status"]);
  assert.ok(!JSON.stringify([ok, bad]).includes("secret-jwt"));
});
