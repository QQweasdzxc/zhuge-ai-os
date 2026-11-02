"use strict";
// 3D-1 (ZG-48) member work overview. Counts and rows come straight from the
// real card list; no member-to-executor binding is inferred, so unassigned
// or unmapped cards are never attributed to a character.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const TfSource = require("../labs/pixel-office-3d/tf-source.js");

const sessions = TfSource.normalizeTfIssues([
  { id: "i1", identifier: "ZG-1", title: "a", status_category: "todo" },
  { id: "i2", identifier: "ZG-2", title: "b", status_category: "todo" },
  { id: "i3", identifier: "ZG-3", title: "c", status_category: "in_progress" },
  { id: "i4", identifier: "ZG-4", title: "d", status_category: "in_review" },
  { id: "i5", identifier: "ZG-5", title: "e", status_category: "done" },
  { id: "i6", identifier: "ZG-6", title: "f", status_category: "backlog" },
  { id: "i7", identifier: "ZG-7", title: "g", status_category: "cancelled" },
  { id: "i8", identifier: "ZG-8", title: "h", status_category: "blocked" },
], { now: 0 });

test("memberOverview counts exactly the four promised statuses from real cards", () => {
  const ov = TfSource.memberOverview(sessions);
  assert.deepEqual(ov.counts, { todo: 2, in_progress: 1, in_review: 1, done: 1 });
});

test("memberOverview rows keep every card with its own status, none invented or dropped", () => {
  const ov = TfSource.memberOverview(sessions);
  assert.equal(ov.rows.length, 8);
  for (const r of ov.rows) assert.ok(r.key && r.title && r.issueStatus, "row carries key/title/issueStatus");
  assert.ok(!ov.rows.some((r) => "owner" in r || "assignee" in r), "rows never claim an owner");
});

test("memberOverview ignores member/owner sessions that carry no card payload", () => {
  const mixed = sessions.concat([{ key: "member:ai:Codex", member: true, ai: true }, { key: "member:owner:u", member: true, owner: true }]);
  const ov = TfSource.memberOverview(mixed);
  assert.equal(ov.rows.length, 8, "member sessions add no cards");
  assert.deepEqual(ov.counts, { todo: 2, in_progress: 1, in_review: 1, done: 1 });
});

test("memberOverview orders attention first, finished last", () => {
  const ov = TfSource.memberOverview(sessions);
  assert.deepEqual(ov.rows.map((r) => r.issueStatus),
    ["in_review", "blocked", "in_progress", "todo", "todo", "backlog", "done", "cancelled"]);
});

test("memberOverview tolerates empty and missing statuses honestly", () => {
  assert.deepEqual(TfSource.memberOverview([]), { counts: { todo: 0, in_progress: 0, in_review: 0, done: 0 }, rows: [] });
  assert.deepEqual(TfSource.memberOverview(null).rows, []);
});

// --- index.html wiring markers (fail loudly if the panel code moves) -------
const INDEX = fs.readFileSync(nodePath.join(__dirname, "..", "labs/pixel-office-3d/index.html"), "utf8");
test("index.html renders the overview only for AI members and labels it unmapped", () => {
  assert.ok(INDEX.includes("window.ZhugeTfSource.memberOverview"), "panel calls the pure helper");
  assert.ok(INDEX.includes("s.member && s.ai"), "overview is gated to AI member sessions");
  assert.ok(INDEX.includes("memberOverviewHtml"), "renderer exists");
  assert.ok(INDEX.includes("data-open-key"), "rows drill into the real card detail");
});

test("memberOverview with executorIds counts only that member's verified cards", () => {
  const withExec = TfSource.normalizeTfIssues([
    { id: "a1", identifier: "ZG-11", title: "mine-1", status_category: "todo", assignee_type: "agent" },
    { id: "a2", identifier: "ZG-12", title: "mine-2", status_category: "in_progress", assignee_type: "agent" },
    { id: "a3", identifier: "ZG-13", title: "theirs", status_category: "todo", assignee_type: "agent" },
    { id: "h1", identifier: "ZG-14", title: "unassigned", status_category: "todo" },
  ], {
    now: 0,
    nativeByIssueId: {
      a1: { executor_id: "CO-01" },
      a2: { executor_id: "CO-01" },
      a3: { executor_id: "GEM-01" },
    },
  });
  const ov = TfSource.memberOverview(withExec, { executorIds: ["CO-01"] });
  assert.deepEqual(ov.counts, { todo: 1, in_progress: 1, in_review: 0, done: 0 });
  assert.deepEqual(ov.rows.map((r) => r.title).sort(), ["ZG-11 mine-1", "ZG-12 mine-2"], "other executors and unassigned cards stay out");
});

test("memberOverview with executorIds and zero matches returns an empty overview, no invented rows", () => {
  const ov = TfSource.memberOverview(sessions, { executorIds: ["CO-99"] });
  assert.deepEqual(ov.counts, { todo: 0, in_progress: 0, in_review: 0, done: 0 });
  assert.equal(ov.rows.length, 0);
});
