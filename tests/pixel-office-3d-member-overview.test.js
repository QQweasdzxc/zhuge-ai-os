"use strict";
// ZG-56 member work overview (supersedes the ZG-48 board-wide fallback):
// a member's panel lists ONLY cards whose assignee_id resolves to the agent
// bound to that member; unassigned or unmapped cards belong to no one and
// are never attributed; agents-directory failure degrades to 尚未綁定.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const TfSource = require("../labs/pixel-office-3d/tf-source.js");

const AGENT_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const AGENT_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const agentsById = {
  [AGENT_A]: { id: AGENT_A, name: "CC-01" },
  [AGENT_B]: { id: AGENT_B, name: "CO-01" },
};

const issues = [
  { id: "i1", identifier: "ZG-1", title: "a", status_category: "todo", assignee_type: "agent", assignee_id: AGENT_A },
  { id: "i2", identifier: "ZG-2", title: "b", status_category: "in_progress", assignee_type: "agent", assignee_id: AGENT_A },
  { id: "i3", identifier: "ZG-3", title: "c", status_category: "in_review", assignee_type: "agent", assignee_id: AGENT_B },
  { id: "i4", identifier: "ZG-4", title: "d", status_category: "todo", assignee_type: "agent", assignee_id: "cccccccc-0000-0000-0000-00000000000c" }, // not in directory
  { id: "i5", identifier: "ZG-5", title: "e", status_category: "todo" }, // unassigned
  { id: "i6", identifier: "ZG-6", title: "f", status_category: "done", assignee_type: "agent", assignee_id: AGENT_B },
];

const sessions = TfSource.normalizeTfIssues(issues, { agentsById, now: 0 });

test("normalizeTfIssues resolves assignee via the agents directory, by UUID only", () => {
  assert.equal(sessions[0].tf.assigneeAgent.name, "CC-01");
  assert.equal(sessions[2].tf.assigneeAgent.name, "CO-01");
  assert.equal(sessions[3].tf.assigneeAgent, null, "id absent from directory stays unbound");
  assert.equal(sessions[4].tf.assigneeId, null, "unassigned card has no assigneeId");
});

test("different assignees land in different member overviews", () => {
  const a = TfSource.memberOverview(sessions, { boundAgentId: AGENT_A });
  const b = TfSource.memberOverview(sessions, { boundAgentId: AGENT_B });
  assert.deepEqual(a.rows.map((r) => r.key), ["zhuge:i2", "zhuge:i1"]);
  assert.deepEqual(b.rows.map((r) => r.key), ["zhuge:i3", "zhuge:i6"]);
  assert.deepEqual(a.counts, { todo: 1, in_progress: 1, in_review: 0, done: 0, backlog: 0, blocked: 0, cancelled: 0 });
});

test("every status bucket is counted so the overview reconciles with the list", () => {
  const more = TfSource.normalizeTfIssues([
    { id: "j1", identifier: "ZG-11", title: "p", status_category: "backlog", assignee_type: "agent", assignee_id: AGENT_A },
    { id: "j2", identifier: "ZG-12", title: "q", status_category: "blocked", assignee_type: "agent", assignee_id: AGENT_A },
    { id: "j3", identifier: "ZG-13", title: "r", status_category: "cancelled", assignee_type: "agent", assignee_id: AGENT_A },
  ], { agentsById, now: 0 });
  const ov = TfSource.memberOverview(more, { boundAgentId: AGENT_A });
  assert.equal(ov.rows.length, 3, "backlog/blocked/cancelled cards are listed");
  assert.deepEqual(ov.counts, { todo: 0, in_progress: 0, in_review: 0, done: 0, backlog: 1, blocked: 1, cancelled: 1 },
    "no listed card may fall outside the displayed counts");
});

test("unassigned or unmapped cards are attributed to no one", () => {
  const a = TfSource.memberOverview(sessions, { boundAgentId: AGENT_A });
  const b = TfSource.memberOverview(sessions, { boundAgentId: AGENT_B });
  assert.ok(!a.rows.concat(b.rows).some((r) => ["zhuge:i4", "zhuge:i5"].includes(r.key)));
  assert.equal(a.unboundCount, 2, "unmapped-id and unassigned cards counted as unbound");
});

test("no confirmed binding yields an honest unbound state, never the whole board", () => {
  const ov = TfSource.memberOverview(sessions);
  assert.equal(ov.bound, false);
  assert.deepEqual(ov.rows, []);
  assert.deepEqual(ov.counts, { todo: 0, in_progress: 0, in_review: 0, done: 0, backlog: 0, blocked: 0, cancelled: 0 });
  assert.equal(ov.boardTotal, 6, "board total reported separately, not mixed into personal stats");
});

test("agents-directory failure degrades to unbound, not mis-assignment", () => {
  const degraded = TfSource.normalizeTfIssues(issues, { agentsById: {}, now: 0 });
  assert.ok(degraded.every((s) => s.tf.assigneeAgent === null));
  const ov = TfSource.memberOverview(degraded, { boundAgentId: AGENT_A });
  assert.deepEqual(ov.rows, [], "no resolved agent means no attribution even with a binding");
  assert.equal(ov.unboundCount, 6);
});

test("memberOverview ignores member/owner sessions that carry no card payload", () => {
  const mixed = sessions.concat([{ key: "member:ai:Codex", member: true, ai: true }, { key: "member:owner:u", member: true, owner: true }]);
  const ov = TfSource.memberOverview(mixed, { boundAgentId: AGENT_A });
  assert.equal(ov.rows.length, 2, "member sessions add no cards");
  assert.equal(ov.boardTotal, 6);
});

test("memberOverview orders attention first, finished last", () => {
  const b = TfSource.memberOverview(sessions, { boundAgentId: AGENT_B });
  assert.deepEqual(b.rows.map((r) => r.issueStatus), ["in_review", "done"]);
});

// --- index.html wiring markers (fail loudly if the panel code moves) -------
const INDEX = fs.readFileSync(nodePath.join(__dirname, "..", "labs/pixel-office-3d/index.html"), "utf8");
test("index.html renders the overview only for AI members and stays honest when unbound", () => {
  assert.ok(INDEX.includes("window.ZhugeTfSource.memberOverview"), "panel calls the pure helper");
  assert.ok(INDEX.includes("s.member && s.ai"), "overview is gated to AI member sessions");
  assert.ok(INDEX.includes("boundAgentId"), "call passes an explicit binding");
  assert.ok(INDEX.includes("!ov.bound"), "unbound state renders without rows");
  assert.ok(INDEX.includes("data-open-key"), "rows drill into the real card detail");
  assert.ok(!INDEX.includes("不是這位成員的指派"), "board-wide fallback copy is gone");
});

test("index.html derives the member description from the actual binding state", () => {
  assert.ok(INDEX.includes("ov && ov.bound"), "member note is conditional on the resolved binding");
  assert.ok(INDEX.includes("memberBoundNote"), "bound members get a bound-truth note, not the static unbound claim");
  assert.ok(INDEX.includes("ovStatusNote"), "bound overview clarifies TF status is not live runtime");
  assert.ok(!INDEX.includes("No member-to-agent binding is\n"), "stale pre-binding comment is gone");
});

// ZG-56 member->agent binding: only source-evidenced identities bind, by
// system_key. Bound: Instinct (user-approved INSTINCT-01 identity, ZG-45),
// Codex-01/02/03 (user's 2026-11-03 roster statement + governance doc naming
// CO-01/02/03 as the three Codex executors), Gem (same doc: GEM-01). GPT and
// GitHub小幫手 binds to GH-HELPER, the single existing agent of the
// documented GH-HELPER-* class (user's 2026-11-03 direction + governance
// doc). GPT binds to CTO-01, the identity-only record the user approved on
// 2026-11-03 (no runtime, account or permission).
test("resolveMemberAgentId binds only source-evidenced members by system_key", () => {
  const agents = [
    { id: "dddddddd-0000-0000-0000-00000000000d", name: "Instinct", system_key: "INSTINCT-01" },
    { id: "eeeeeeee-0000-0000-0000-00000000000e", name: "GH-HELPER", system_key: "GH-HELPER" },
    { id: "c0c0c0c0-0000-0000-0000-000000000001", name: "CO-01", system_key: "CO-01" },
    { id: "c0c0c0c0-0000-0000-0000-000000000002", name: "CO-02", system_key: "CO-02" },
    { id: "c0c0c0c0-0000-0000-0000-000000000003", name: "CO-03", system_key: "CO-03" },
    { id: "90909090-0000-0000-0000-00000000000a", name: "GEM-01", system_key: "GEM-01" },
  ];
  assert.equal(TfSource.resolveMemberAgentId("Instinct", agents), "dddddddd-0000-0000-0000-00000000000d");
  assert.equal(TfSource.resolveMemberAgentId("Codex-01", agents), "c0c0c0c0-0000-0000-0000-000000000001");
  assert.equal(TfSource.resolveMemberAgentId("Codex-02", agents), "c0c0c0c0-0000-0000-0000-000000000002");
  assert.equal(TfSource.resolveMemberAgentId("Codex-03", agents), "c0c0c0c0-0000-0000-0000-000000000003");
  assert.equal(TfSource.resolveMemberAgentId("Gem", agents), "90909090-0000-0000-0000-00000000000a");
  assert.equal(TfSource.resolveMemberAgentId("GitHub小幫手", agents), "eeeeeeee-0000-0000-0000-00000000000e", "GH-HELPER is the single existing agent of the documented GH-HELPER-* class");
  const withGpt = [...agents, { id: "b420a00e-0000-0000-0000-0000000000a1", name: "GPT", system_key: "CTO-01" }];
  assert.equal(TfSource.resolveMemberAgentId("GPT", withGpt), "b420a00e-0000-0000-0000-0000000000a1", "user-approved identity-only CTO-01 record binds the GPT figure");
});

test("resolveMemberAgentId never binds unverified members or name-only matches", () => {
  const agents = [
    { id: "dddddddd-0000-0000-0000-00000000000d", name: "Codex", system_key: "CO-01" },
    { id: "ffffffff-0000-0000-0000-00000000000f", name: "Instinct", system_key: null },
  ];
  assert.equal(TfSource.resolveMemberAgentId("Codex", agents), null, "the retired single Codex figure has no binding; Codex-01/02/03 carry it");
  assert.equal(TfSource.resolveMemberAgentId("GPT", agents), null, "GPT unbound when the CTO-01 agent is absent from the directory");
  assert.equal(TfSource.resolveMemberAgentId("Gem", agents), null, "GEM-01 missing from this partial directory -> unbound, no guessing");
  assert.equal(TfSource.resolveMemberAgentId("Instinct", agents), null, "display-name match without system_key is not a binding");
  assert.equal(TfSource.resolveMemberAgentId("Instinct", []), null, "missing directory degrades to unbound");
  assert.equal(TfSource.resolveMemberAgentId("Instinct", null), null);
});

// ZG-56 dynamic roster: figures derive from the live agents directory, one
// per actual agent in the documented classes (user 2026-11-03: Codex 三人、
// GPT 一人、Gem 一人、GitHub 不一定一人). Unknown classes never render.
test("deriveAiRoster renders one figure per actual agent in documented classes only", () => {
  const agents = [
    { id: "d1", name: "Instinct", system_key: "INSTINCT-01" },
    { id: "d2", name: "GPT", system_key: "CTO-01" },
    { id: "d3", name: "CO-01", system_key: "CO-01" },
    { id: "d4", name: "CO-02", system_key: "CO-02" },
    { id: "d5", name: "CO-03", system_key: "CO-03" },
    { id: "d6", name: "GEM-01", system_key: "GEM-01" },
    { id: "d7", name: "GH-HELPER", system_key: "GH-HELPER" },
  ];
  const roster = TfSource.deriveAiRoster(agents);
  assert.deepEqual(roster.map((r) => r.name), ["Instinct", "GPT", "Codex-01", "Codex-02", "Codex-03", "Gem", "GitHub小幫手"]);
  assert.deepEqual(roster.map((r) => r.agentId), ["d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  assert.equal(roster[6].occasional, true, "GitHub小幫手 keeps the occasional presence flag");
});

test("deriveAiRoster grows and shrinks with the actual directory", () => {
  const agents = [
    { id: "d7", name: "GH-HELPER", system_key: "GH-HELPER" },
    { id: "d8", name: "GH-HELPER-02", system_key: "GH-HELPER-02" },
    { id: "d9", name: "CO-05", system_key: "CO-05" },
    { id: "da", name: "SLACK-BOT", system_key: "SLACK-BOT-01" },
    { id: "db", name: "no-key" },
    { id: "dc", name: "null-key", system_key: null },
  ];
  const roster = TfSource.deriveAiRoster(agents);
  assert.deepEqual(roster.map((r) => [r.name, r.systemKey]), [
    ["Codex-05", "CO-05"],
    ["GitHub小幫手", "GH-HELPER"],
    ["GitHub小幫手-02", "GH-HELPER-02"],
  ], "every GH-HELPER-* agent becomes its own figure; unknown classes and keyless agents never render");
});

test("deriveAiRoster tolerates a missing directory", () => {
  assert.deepEqual(TfSource.deriveAiRoster([]), []);
  assert.deepEqual(TfSource.deriveAiRoster(null), []);
  assert.deepEqual(TfSource.deriveAiRoster(undefined), []);
});

test("index.html derives the AI roster from the directory with a static unbound fallback", () => {
  assert.ok(INDEX.includes("deriveAiRoster(data.agents)"), "live roster derives from the agents directory");
  assert.ok(INDEX.includes("derived.length ? derived : BUILTIN_AI"), "static list is fallback-only");
  assert.ok(INDEX.includes("agentId"), "derived figures carry their agent id directly");
});
