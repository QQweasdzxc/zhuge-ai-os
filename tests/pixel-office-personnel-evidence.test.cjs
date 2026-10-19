"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "labs/pixel-office-p3-preview/personnel-evidence.js"), "utf8");
const handoff = JSON.parse(fs.readFileSync(path.join(root, "labs/pixel-office-p3-preview/personnel-handoff.json"), "utf8"));
const githubSnapshot = JSON.parse(fs.readFileSync(path.join(root, "labs/pixel-office-p3-preview/personnel-github-snapshot.json"), "utf8"));
function handoffAt(updatedAt, validUntil, states = {}) {
  return {
    schemaVersion: 1,
    recordedAt: updatedAt,
    agentUpdates: ["co", "gem"].map(roleId => ({
      roleId, state: states[roleId] || "working", label: "Synthetic contract case", updatedAt, validUntil,
      ref: "Synthetic unit-test case", sourceUrl: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65"
    }))
  };
}

function makeContext({ handoffDoc = handoff, snapshotDoc = githubSnapshot, apiResponses = {}, now = "2026-10-18T22:36:00.000Z", prNumber = null, locationSearch = '' } = {}) {
  const requests = [];
  const fixedNow = Date.parse(now);
  class FixedDate extends Date {
    constructor(value) { super(value === undefined ? fixedNow : value); }
    static now() { return fixedNow; }
  }
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === "./personnel-handoff.json") {
      if (handoffDoc === null) throw new Error("not found");
      return { ok: true, json: async () => handoffDoc };
    }
    if (String(url) === "./personnel-github-snapshot.json") {
      if (snapshotDoc === null) throw new Error("not found");
      return { ok: true, json: async () => snapshotDoc };
    }
    const requestPath = String(url).split("?")[0];
    const matched = Object.entries(apiResponses).find(([key]) => requestPath.endsWith(key));
    if (!matched) throw new Error("unexpected endpoint");
    return { ok: true, json: async () => matched[1] };
  };
  const context = {
    window: { P3_CONFIG: { pullRequestNumber: prNumber }, location: { search: locationSearch } }, URL, URLSearchParams, Date: FixedDate, AbortController, fetch,
    setTimeout: () => 1, clearTimeout: () => {}, console
  };
  vm.runInNewContext(source, context, { filename: "personnel-evidence.js" });
  return { loader: context.window.P3PersonnelEvidence, requests };
}

test("role catalogue separates agents, operator, and residents without assigning residents work status", async () => {
  const { loader } = makeContext();
  const data = await loader.load();
  const byId = Object.fromEntries(data.roles.map(role => [role.id, role]));
  assert.deepEqual(["pm", "co", "gem", "gpt", "betty", "anan", "kaka"].sort(), Object.keys(byId).sort());
  assert.equal(byId.pm.kind, "operator");
  for (const id of ["co", "gem", "gpt"]) assert.equal(byId[id].kind, "agent");
  for (const id of ["betty", "anan", "kaka"]) {
    assert.equal(byId[id].kind, "resident");
    assert.equal(byId[id].statusEvidence, null);
    assert.match(byId[id].visualActivity, /虛擬活動/);
  }
});

test("a current handoff is time-bounded and carries its source reference", async () => {
  const { loader } = makeContext({
    now: "2026-10-18T22:25:00.000Z",
    handoffDoc: handoffAt("2026-10-18T22:24:00.000Z", "2026-10-18T22:54:00.000Z", { gem: "completed" })
  });
  const data = await loader.load();
  const co = data.roles.find(role => role.id === "co");
  const gem = data.roles.find(role => role.id === "gem");
  assert.equal(co.statusEvidence.state, "working");
  assert.match(co.statusEvidence.label, /^工作中 · /);
  assert.equal(gem.statusEvidence.state, "completed");
  assert.match(gem.statusEvidence.label, /^已交付 · /);
  assert.equal(co.statusEvidence.sourceType, "confirmed_handoff");
  assert.equal(co.statusEvidence.sourceUrl, "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65");
  assert.equal(co.statusEvidence.ref, "Synthetic unit-test case");
  assert.equal(Date.parse(co.statusEvidence.validUntil) - Date.parse(co.statusEvidence.updatedAt), 30 * 60 * 1000);
});

test("expired handoff is retained as historical evidence but cannot set a current status", async () => {
  const { loader } = makeContext({
    now: "2026-10-18T23:00:00.000Z",
    handoffDoc: handoffAt("2026-10-18T22:20:00.000Z", "2026-10-18T22:50:00.000Z")
  });
  const data = await loader.load();
  const co = data.roles.find(role => role.id === "co");
  assert.equal(co.statusEvidence, null);
  assert.equal(co.events[0].freshness, "stale");
  assert.equal(data.sourceStatus.handoff, "stale");
});

test("invalid or external handoff links never establish an agent status", async () => {
  const invalid = handoffAt("2026-10-18T22:24:00.000Z", "2026-10-18T22:54:00.000Z");
  invalid.agentUpdates[0].sourceUrl = "https://example.com/fake-source";
  const { loader } = makeContext({ handoffDoc: invalid });
  const data = await loader.load();
  const co = data.roles.find(role => role.id === "co");
  assert.equal(co.statusEvidence, null);
  assert.equal(co.events.length, 0);
});

test("public GitHub events are linked but never inferred as a specific engineer state", async () => {
  const head = "a".repeat(40);
  const { loader, requests } = makeContext({
    prNumber: 65,
    handoffDoc: null,
    apiResponses: {
      "/pulls/65": { html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65", title: "P3 lab", state: "open", updated_at: "2026-10-18T21:00:00.000Z", head: { sha: head } },
      "/pulls/65/commits": [{ sha: head, html_url: `https://github.com/QQweasdzxc/zhuge-ai-os/commit/${head}`, commit: { message: "P3 evidence", author: { date: "2026-10-18T20:00:00.000Z" }, committer: { date: "2026-10-18T20:00:00.000Z" } } }],
      "/issues/65/comments": [{ id: 7, html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65#issuecomment-7", body: "A verified review note", updated_at: "2026-10-18T19:00:00.000Z" }],
      "/check-runs": { check_runs: [{ id: 9, name: "Pixel QA", html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/9", conclusion: "success", completed_at: "2026-10-18T18:00:00.000Z", head_sha: head }] }
    }
  });
  const data = await loader.load();
  assert.equal(data.events.length, 4);
  assert.ok(data.events.every(event => event.sourceUrl.startsWith("https://github.com/")));
  assert.ok(data.events.every(event => event.roleId === null));
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
  assert.equal(data.sourceStatus.taskflow, "not-connected");
  assert.ok(requests.every(request => request.options.credentials === "omit"));
  assert.ok(requests.every(request => !request.options.headers.Authorization));
});

test("GitHub events are cached across UI refreshes to stay below public API rate limits", async () => {
  const head = "b".repeat(40);
  const { loader, requests } = makeContext({
    prNumber: 65,
    handoffDoc: handoffAt("2026-10-18T22:24:00.000Z", "2026-10-18T22:54:00.000Z"),
    apiResponses: {
      "/pulls/65": { html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65", title: "P3 lab", state: "open", updated_at: "2026-10-18T21:00:00.000Z", head: { sha: head } },
      "/pulls/65/commits": [{ sha: head, html_url: `https://github.com/QQweasdzxc/zhuge-ai-os/commit/${head}`, commit: { message: "P3 evidence", author: { date: "2026-10-18T20:00:00.000Z" }, committer: { date: "2026-10-18T20:00:00.000Z" } } }],
      "/issues/65/comments": [{ id: 7, html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/65#issuecomment-7", body: "A verified review note", updated_at: "2026-10-18T19:00:00.000Z" }],
      "/check-runs": { check_runs: [{ id: 9, name: "Pixel QA", html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/9", conclusion: "success", completed_at: "2026-10-18T18:00:00.000Z", head_sha: head }] }
    }
  });
  const first = await loader.load();
  const initialGithubRequests = requests.filter(request => request.url.startsWith("https://api.github.com/")).length;
  const second = await loader.load();
  const nextGithubRequests = requests.filter(request => request.url.startsWith("https://api.github.com/")).length;
  assert.equal(initialGithubRequests, 4);
  assert.equal(nextGithubRequests, initialGithubRequests);
  assert.equal(first.events.length, 4);
  assert.equal(second.events.length, 4);
  assert.ok(second.events.every(event => event.roleId === null));
});

test("unavailable GitHub and TaskFlow sources remain unknown without fabricated role activity", async () => {
  const { loader } = makeContext({ handoffDoc: null, snapshotDoc: null, prNumber: 65, apiResponses: {} });
  const data = await loader.load();
  assert.equal(data.sourceStatus.github, "unavailable");
  assert.equal(data.sourceStatus.taskflow, "not-connected");
  assert.equal(data.events.length, 0);
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
});

test("live GitHub failure falls back to a clearly pinned, unattributed readonly snapshot", async () => {
  const { loader } = makeContext({ handoffDoc: null, prNumber: 65, apiResponses: {} });
  const data = await loader.load();
  assert.equal(data.sourceStatus.github, "snapshot");
  assert.match(data.sourceStatus.note, /唯讀靜態快照/);
  assert.match(data.sourceStatus.note, new RegExp(githubSnapshot.headSha.slice(0, 12)));
  assert.ok(data.events.length > 0);
  assert.ok(data.events.every(event => event.roleId === null && event.sourceUrl.startsWith("https://github.com/QQweasdzxc/zhuge-ai-os/")));
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
  assert.equal(data.refreshedAt, githubSnapshot.verifiedAt);
});

test("invalid static source snapshot is rejected instead of assigning status", async () => {
  const bad = structuredClone(githubSnapshot);
  bad.repository = "another-owner/another-repo";
  const { loader } = makeContext({ handoffDoc: null, snapshotDoc: bad, prNumber: 65, apiResponses: {} });
  const data = await loader.load();
  assert.equal(data.sourceStatus.github, "unavailable");
  assert.equal(data.events.length, 0);
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
});

test("configured integration PR never falls back to the historical PR 65 snapshot", async () => {
  const { loader, requests } = makeContext({ handoffDoc: null, prNumber: 987654, apiResponses: {} });
  const data = await loader.load();
  assert.equal(data.sourceStatus.github, "unavailable");
  assert.equal(data.events.length, 0);
  assert.ok(requests.some(request => request.url.endsWith("/pulls/987654")));
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
});

test("isolated preview can select its public GitHub PR through the URL without credentials", async () => {
  const head = "c".repeat(40);
  const { loader, requests } = makeContext({
    handoffDoc: null,
    snapshotDoc: null,
    locationSearch: "?pr=987654",
    apiResponses: {
      "/pulls/987654": { html_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/987654", title: "P3 candidate", state: "open", updated_at: "2026-10-18T21:00:00.000Z", head: { sha: head } },
      "/pulls/987654/commits": [],
      "/issues/987654/comments": [],
      "/check-runs": { check_runs: [] }
    }
  });
  const data = await loader.load();
  assert.ok(requests.some(request => request.url.endsWith("/pulls/987654")));
  assert.ok(requests.every(request => request.options.credentials === "omit" && !request.options.headers.Authorization));
  assert.equal(data.events[0].sourceUrl, "https://github.com/QQweasdzxc/zhuge-ai-os/pull/987654");
  assert.equal(data.events[0].roleId, null);
  assert.ok(data.roles.filter(role => role.kind === "agent").every(role => role.statusEvidence === null));
});

test("no configured review PR means no guessed PR or unrelated historical snapshot", async () => {
  const { loader, requests } = makeContext({ handoffDoc: null, apiResponses: {} });
  const data = await loader.load();
  assert.equal(data.sourceStatus.github, "not-configured");
  assert.match(data.sourceStatus.note, /尚未綁定本次 P3 Review PR/);
  assert.equal(data.events.length, 0);
  assert.equal(requests.some(request => request.url.includes("api.github.com")), false);
});
