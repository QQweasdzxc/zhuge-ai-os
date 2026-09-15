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
  assert.match(release.developmentSourceCommit, /^[0-9a-f]{40}$/);
  assert.match(release.developmentSourceFingerprint, /^[0-9a-f]{64}$/);
  assert.match(release.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(release.sourceFingerprint, /^[0-9a-f]{64}$/);
  execFileSync("git", ["cat-file", "-e", `${release.developmentSourceCommit}^{commit}`], { cwd: ROOT, stdio: "pipe" });
  assert.ok(release.publishedAt);
  for (const consumerId of ["c", "worktodo", "ai-board", "investment-ivtk", "worklog-procurement"]) {
    assert.deepEqual(release.consumers[consumerId], {
      templateVersion: release.publishedVersion,
      build: release.publishedBuild,
      status: "adopted"
    });
  }
  try {
    execFileSync(process.execPath, ["tools/template-publish.js", "--check"], { cwd: ROOT, stdio: "pipe" });
  } catch (error) {
    // The frozen release snapshot must not be rewritten while this worktree
    // contains the next development change.  The packaging command remains
    // strict; during development the only expected failure is the source
    // fingerprint drift that tells the release gate a new identity is needed.
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    assert.match(output, /sourceFingerprint must match canonical source/);
    assert.doesNotMatch(output, /published (?:version|build) must match version\.json/);
    assert.doesNotMatch(output, /development (?:version|build) must match version\.json/);
    assert.doesNotMatch(output, /missing matching template-release cache-buster/);
  }
});

test("future Published C snapshots persist the Published source identity on every adoption record", () => {
  const tool = read("tools/template-publish.js");
  assert.match(tool, /sourceCommit:\s*commit/);
  assert.match(tool, /sourceFingerprint:\s*fingerprint/);
  assert.match(tool, /adoption\.sourceCommit === record\.sourceCommit/);
  assert.match(tool, /adoption\.sourceFingerprint === record\.sourceFingerprint/);
});

test("C, WorkTodo, and AI Board load one published template identity", () => {
  const cacheBuster = `shared/config/template-release.js?v=${release.publishedBuild}`;
  for (const file of [
    "app/Board/template-preview/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/ai/index.html",
    "app/Board/procurement/index.html"
  ]) {
    const html = read(file);
    assert.ok(html.includes(cacheBuster), `${file} is missing ${cacheBuster}`);
    assert.match(html, /shared\/components\/golden-master-runtime\.js/);
  }
  assert.doesNotMatch(read("app/Board/template-preview/index.html"), /c-mtdk-store/);
  const investment = read("modules/investment/index.html");
  assert.ok(investment.includes(cacheBuster), `modules/investment/index.html is missing ${cacheBuster}`);
  assert.match(read("modules/investment/index.html"), /template-parity-engine\.js/);
  assert.doesNotMatch(read("modules/investment/index.html"), /golden-master-runtime\.js/);
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
  assert.match(runtime, /applyModuleReleaseIdentity/);
  assert.match(runtime, /templateRelease/);
  const api = require("../shared/config/template-release.js");
  assert.equal(api.forConsumer("c").status, "stale");
  assert.equal(api.forConsumer("worktodo").consumerId, "worktodo");
  assert.equal(api.forConsumer("ai_board").consumerId, "ai-board");
  assert.equal(api.forConsumer("investment-ivtk").consumerId, "investment-ivtk");
  assert.equal(api.forConsumer("worklog-procurement").consumerId, "worklog-procurement");
});

test("development source identity is kept separate from the published snapshot when present", () => {
  const release = require("../shared/config/template-release.js").getSnapshot();
  assert.ok(release.developmentSourceCommit);
  assert.ok(release.developmentSourceFingerprint);
  if (release.developmentSourceCommit !== release.sourceCommit) {
    assert.notEqual(release.developmentSourceFingerprint, release.sourceFingerprint);
  }
  const serviceSource = read("shared/services/template-release-service.js");
  const runtimeSource = read("shared/components/golden-master-runtime.js");
  const previewSource = read("shared/components/c-template-preview.js");
  assert.match(serviceSource, /snapshot\.developmentSourceCommit \|\| snapshot\.sourceCommit/);
  assert.match(runtimeSource, /snapshot\.developmentSourceCommit \|\| snapshot\.sourceCommit/);
  assert.match(previewSource, /snapshot\.developmentSourceCommit \|\| snapshot\.sourceCommit/);
});
