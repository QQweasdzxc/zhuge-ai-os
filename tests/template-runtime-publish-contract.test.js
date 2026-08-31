const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("C runtime exposes the shared persistent module publish action", () => {
  const cPage = read("app/Board/template-preview/index.html");
  const cComponent = read("shared/components/c-template-preview.js");
  assert.match(cPage, /shared\/services\/template-release-service\.js\?v=/);
  assert.match(cComponent, /data-module-publish/);
  assert.match(cComponent, /ZhugeModulePublishService/);
  assert.match(cComponent, /service\.publish\(/);
  assert.match(cComponent, /data-module-adopt/);
  assert.match(cComponent, /service\.adopt\(/);
  assert.match(cComponent, /Cloud Read-back PASS/);
  assert.match(cComponent, /zhuge-module-release-updated/);
  assert.match(cComponent, /WorkTodo \/ AI Board 等待重新載入新版/);
  assert.match(cComponent, /data-module-publish-progress/);
  assert.match(cComponent, /aria-valuetext/);
  assert.match(cComponent, /is-indeterminate/);
  assert.match(cComponent, /publishProgressModel/);
});

test("publish progress is derived from persisted release and adoption state", () => {
  const component = require(path.join(ROOT, "shared/components/c-template-preview.js"));
  const service = {
    compareSourceIdentity: () => ({ status: "matched" }),
  };
  const development = {
    version: "0.9.0-alpha.9.13",
    build: "20260829-1024",
    sourceCommit: "commit-1",
    sourceFingerprint: "fingerprint-1",
  };
  const pendingRelease = {
    publishedVersion: development.version,
    publishedBuild: development.build,
    sourceCommit: development.sourceCommit,
    sourceFingerprint: development.sourceFingerprint,
    consumers: {
      c: { status: "adopted", identityMatches: true },
      worktodo: { status: "published_pending_reload", identityMatches: true },
      "ai-board": { status: "published_pending_reload", identityMatches: true },
    },
  };
  const pending = component.publishProgressModel(pendingRelease, development, service);
  assert.equal(pending.indeterminate, false);
  assert.equal(pending.completed, 3);
  assert.equal(pending.total, 5);
  assert.equal(pending.percent, 60);
  assert.match(pending.summary, /等待 Consumer 載入/);

  const busy = component.publishProgressModel(null, development, service, true);
  assert.equal(busy.indeterminate, true);
  assert.equal(busy.percent, null);
  assert.match(busy.ariaValueText, /等待 Cloud 回應/);

  const completeRelease = {
    ...pendingRelease,
    consumers: Object.fromEntries(Object.keys(pendingRelease.consumers).map(id => [id, { status: "adopted", identityMatches: true }])),
  };
  const complete = component.publishProgressModel(completeRelease, development, service);
  assert.equal(complete.completed, 5);
  assert.equal(complete.percent, 100);
  assert.equal(complete.summary, "發布流程已完成");
});

test("C publish status accepts registry consumers beyond the built-in consumers", () => {
  const component = require(path.join(ROOT, "shared/components/c-template-preview.js"));
  const service = { compareSourceIdentity: () => ({ status: "matched" }) };
  const identity = {
    version: "0.9.0-alpha.9.13",
    build: "20260829-1024",
    sourceCommit: "commit-1",
    sourceFingerprint: "fingerprint-1",
  };
  const release = {
    publishedVersion: identity.version,
    publishedBuild: identity.build,
    sourceCommit: identity.sourceCommit,
    sourceFingerprint: identity.sourceFingerprint,
    consumers: {
      c: { status: "adopted", identityMatches: true },
      worktodo: { status: "adopted", identityMatches: true },
      "ai-board": { status: "adopted", identityMatches: true },
      "qa-instance": { status: "adopted", identityMatches: true },
    },
  };
  const progress = component.publishProgressModel(release, identity, service, false, {
    consumerEntries: [
      { id: "c", label: "C 母版" },
      { id: "worktodo", label: "WorkTodo" },
      { id: "ai-board", label: "AI Board" },
      { id: "qa-instance", label: "QA Template Board（QAT）" },
    ],
  });
  assert.equal(progress.total, 6);
  assert.equal(progress.completed, 6);
  assert.equal(progress.percent, 100);
  assert.equal(progress.stages.find(stage => stage.id === "qa-instance").label, "QA Template Board（QAT）");
});

test("C publish status is registry-driven rather than a fixed consumer list", () => {
  const component = read("shared/components/c-template-preview.js");
  assert.match(component, /listModuleConsumers/);
  assert.match(component, /consumerEntries/);
  assert.doesNotMatch(component, /CORE_CONSUMER_ENTRIES/);
  assert.doesNotMatch(component, /consumerIds: CONSUMER_IDS/);
});

test("formal consumers load the same shared module publish service", () => {
  for (const file of ["app/Board/template-preview/index.html", "app/Board/worktodo/index.html", "app/Board/ai/index.html"]) {
    assert.match(read(file), /shared\/services\/template-release-service\.js\?v=/, file);
  }
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /hydrateModuleRelease/);
  assert.match(runtime, /templateReleaseEventsBound/);
  assert.match(runtime, /releaseService\.adopt/);
  assert.match(runtime, /data-template-adopt/);
  assert.match(runtime, /C 母版有新版可採用/);
  assert.match(runtime, /visibilitychange/);
  assert.match(read("shared/services/template-release-service.js"), /BroadcastChannel/);
  assert.match(runtime, /templateSourceFingerprint/);
  assert.match(runtime, /templateSourceCommit/);
  assert.match(runtime, /templateLoadedSourceFingerprint/);
  assert.match(runtime, /templatePublishedSourceFingerprint/);
  assert.match(runtime, /templateSourceIntegrity/);
  assert.match(runtime, /templateIdentitySource/);
  assert.doesNotMatch(read("app/Board/template-preview/index.html"), /ZhugeCanonicalCTemplatePreview\.mountBanner\(/);
});

test("shared publish migration is module-generic and preserves governed adoption", () => {
  const migration = read("docs/supabase/20260829_module_runtime_publish_framework.sql");
  assert.match(migration, /create table if not exists public\.module_releases/);
  assert.match(migration, /create table if not exists public\.module_release_history/);
  assert.match(migration, /create or replace function public\.get_published_module_release/);
  assert.match(migration, /create or replace function public\.publish_module_release/);
  assert.match(migration, /create or replace function public\.record_module_adoption/);
  assert.match(migration, /lower\(trim\(au\.role\)\) in \('creator', 'owner'\)/);
  assert.match(migration, /p_consumer_ids jsonb/);
  assert.doesNotMatch(migration, /Only the canonical C template may be published/);
});
