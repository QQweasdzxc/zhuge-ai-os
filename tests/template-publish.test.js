const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const release = require("../shared/config/template-release.js").getSnapshot();

test("C publish metadata is generated and internally consistent", () => {
  assert.equal(release.templateId, "c");
  assert.equal(release.templateVersion, release.publishedVersion);
  assert.equal(release.build, release.publishedBuild);
  assert.equal(release.developmentVersion, release.publishedVersion);
  assert.equal(release.developmentBuild, release.publishedBuild);
  assert.match(release.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(release.sourceFingerprint, /^[0-9a-f]{64}$/);
  assert.ok(release.publishedAt);
  for (const consumerId of ["c", "worktodo", "ai-board"]) {
    assert.deepEqual(release.consumers[consumerId], {
      templateVersion: release.publishedVersion,
      build: release.publishedBuild,
      status: "adopted"
    });
  }
  execFileSync(process.execPath, ["tools/template-publish.js", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("C, WorkTodo, and AI Board load one published template identity", () => {
  const cacheBuster = `shared/config/template-release.js?v=${release.publishedBuild}`;
  for (const file of [
    "app/Board/template-preview/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/ai/index.html"
  ]) {
    const html = read(file);
    assert.ok(html.includes(cacheBuster), `${file} is missing ${cacheBuster}`);
    assert.match(html, /shared\/components\/golden-master-runtime\.js/);
  }
  assert.doesNotMatch(read("app/Board/template-preview/index.html"), /c-mtdk-store/);
});

test("Template Management Center exposes the published mother-template identity", () => {
  const management = read("shared/components/template-management-center.js");
  assert.match(management, /ZhugeMotherTemplateRelease/);
  assert.match(management, /data-template-release-summary/);
  assert.match(read("modules/worklog/index.html"), /shared\/config\/template-release\.js\?v=/);
});

test("Shared runtime exposes published adoption identity for every consumer", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /ZhugeMotherTemplateRelease/);
  assert.match(runtime, /applyTemplateReleaseIdentity/);
  assert.match(runtime, /templateRelease/);
  const api = require("../shared/config/template-release.js");
  assert.equal(api.forConsumer("c").status, "stale");
  assert.equal(api.forConsumer("worktodo").consumerId, "worktodo");
  assert.equal(api.forConsumer("ai_board").consumerId, "ai-board");
});
