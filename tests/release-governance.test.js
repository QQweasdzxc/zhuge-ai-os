const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const Governance = require("../tools/release-governance.js");

const ROOT = path.join(__dirname, "..");
const VERSION = "0.9.0-alpha.9.13";
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build;
const PUBLISHED_BUILD = "20260915-1707";
const PUBLISHED_SOURCE_COMMIT = "d792b4b871450c87926c764ede7c1be8ce3684ec";
const PUBLISHED_SOURCE_FINGERPRINT = "0b0aee84d739cb2790aac5ea37820fb1e198c9c4086518f9d2110aec8f2d6516";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function fixture({
  candidateBuild = BUILD,
  cacheBuild = candidateBuild,
  moduleBuild = candidateBuild,
  runtimeBuild = candidateBuild,
  developmentBuild = candidateBuild,
  publishedBuild = PUBLISHED_BUILD,
  publishedSnapshotBuild = publishedBuild,
  publishedLoaderBuild = publishedBuild,
  publishedSourceCommit = PUBLISHED_SOURCE_COMMIT,
  snapshotSourceCommit = publishedSourceCommit,
  publishedSourceFingerprint = PUBLISHED_SOURCE_FINGERPRINT,
  snapshotSourceFingerprint = publishedSourceFingerprint
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-release-gate-fixture-"));
  const consumer = status => ({
    templateVersion: VERSION,
    build: publishedBuild,
    sourceCommit: publishedSourceCommit,
    sourceFingerprint: publishedSourceFingerprint,
    status
  });
  const publishedRelease = {
    schemaVersion: 1,
    templateId: "c",
    developmentVersion: VERSION,
    developmentBuild,
    publishedVersion: VERSION,
    publishedBuild,
    templateVersion: VERSION,
    build: publishedBuild,
    sourceCommit: publishedSourceCommit,
    sourceFingerprint: publishedSourceFingerprint,
    publishedAt: "2026-09-15T14:49:07.294293+00:00",
    publishedSnapshot: {
      schemaVersion: 1,
      version: VERSION,
      build: publishedSnapshotBuild,
      sourceCommit: snapshotSourceCommit,
      sourceFingerprint: snapshotSourceFingerprint
    },
    consumers: {
      c: consumer("adopted"),
      "ai-board": consumer("published_pending_reload"),
      worktodo: consumer("published_pending_reload"),
      "worklog-procurement": consumer("published_pending_reload"),
      "investment-ivtk": consumer("adopted")
    }
  };
  write(root, ".gitignore", "dist/\nnode_modules/\n.cache/\n");
  write(root, "version.json", JSON.stringify({ module: "Zhuge AI OS", version: VERSION, build: candidateBuild }));
  write(root, "index.html", `<!doctype html><script src="shared/config/template-release.js?v=${publishedLoaderBuild}"></script><link rel="stylesheet" href="shared/site.css?v=${cacheBuild}"><span>Version ${VERSION} · Build ${runtimeBuild}</span>`);
  write(root, "shared/site.css", `/* Historical annotation 20260916-1334 is not a Build Identity. */\nbody { color: black; }`);
  write(root, "shared/app-config.js", `const VERSION = "${VERSION}";\nconst BUILD_TIME = "${runtimeBuild}";`);
  write(root, "shared/config/version.js", `globalThis.version = { version: "${VERSION}", build: "${runtimeBuild}" };`);
  write(root, "shared/config/template-release.js", `const RELEASE = Object.freeze(${JSON.stringify(publishedRelease, null, 2)});`);
  write(root, "shared/runtime.js", `const runtime = "runtime.js?v=${cacheBuild}";`);
  write(root, "app/dashboard/index.html", `<meta name="application-version" content="${VERSION}">`);
  write(root, "app/dashboard/zhuge-dashboard.js", `const version = typeof VERSION !== "undefined" ? VERSION : "${VERSION}";\nconst build = typeof BUILD_TIME !== "undefined" ? BUILD_TIME : "${runtimeBuild}";`);
  write(root, "modules/worklog/version.json", JSON.stringify({ version: VERSION, build: moduleBuild }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "release-gate-fixture@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Release Gate Fixture"], { cwd: root });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "fixture parent"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: root });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: root });
  return root;
}

function passRegression() {
  return { governance: "PASS", checklist: "PASS", full: "PASS", gitDiffCheck: "PASS", browser: "PASS" };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function packageFixture(description = "Pair-Test") {
  const root = fixture();
  const result = Governance.packageCandidate({
    root,
    outputDir: path.join(root, "dist"),
    description,
    regression: passRegression()
  });
  return { root, result, filename: path.basename(result.zipFile) };
}

function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writePair(root, result, manifest = readManifest(result.manifestFile), { includeZip = true, includeManifest = true } = {}) {
  const pairRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-release-formal-pair-"));
  if (includeZip) fs.copyFileSync(result.zipFile, path.join(pairRoot, path.basename(result.zipFile)));
  fs.copyFileSync(result.sha256File, path.join(pairRoot, path.basename(result.sha256File)));
  if (includeManifest) fs.writeFileSync(path.join(pairRoot, path.basename(result.manifestFile)), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return pairRoot;
}

test("normal identity passes the Pre-Packaging Gate", () => {
  const gate = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(ROOT));
  assert.equal(gate.status, "PASS");
  assert.equal(gate.build, BUILD);
  assert.equal(gate.version, JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version);
  assert.equal(gate.publishedCIdentity.version, VERSION);
  assert.equal(gate.publishedCIdentity.build, PUBLISHED_BUILD);
  assert.equal(gate.publishedCIdentity.sourceCommit, PUBLISHED_SOURCE_COMMIT);
});

test("Candidate Build 20260916-1412 may validly differ from Published C Build 20260915-1707", () => {
  const root = fixture({ candidateBuild: "20260916-1412" });
  try {
    const gate = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root));
    assert.equal(gate.build, "20260916-1412");
    assert.equal(gate.publishedCIdentity.build, "20260915-1707");
    assert.equal(gate.publishedSnapshotLoaderCount, 1);
  } finally {
    cleanup(root);
  }
});

test("stale C Development Build identity fails independently of Published identity", () => {
  const root = fixture({ candidateBuild: "20260916-1450", developmentBuild: PUBLISHED_BUILD });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message)
        && error.details.mismatches.some(item => item.includes("developmentBuild"))
    );
  } finally {
    cleanup(root);
  }
});

test("Published Snapshot loader cache-buster follows Published Build, not Candidate Build", () => {
  const root = fixture({ candidateBuild: "20260916-1450", publishedLoaderBuild: PUBLISHED_BUILD });
  try {
    const gate = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root));
    assert.equal(gate.build, "20260916-1450");
    assert.equal(gate.publishedCIdentity.build, PUBLISHED_BUILD);
  } finally {
    cleanup(root);
  }
});

test("stale Candidate Runtime identity fails while Published identity remains valid", () => {
  const root = fixture({ candidateBuild: "20260916-1450", runtimeBuild: "20260916-1334" });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message)
        && error.details.mismatches.some(item => item.includes("shared/app-config.js BUILD_TIME"))
    );
  } finally {
    cleanup(root);
  }
});

test("new BUILD_ID is generated from Asia/Taipei time and cannot reuse the previous value", () => {
  const now = new Date("2026-08-26T06:43:12.000Z");
  assert.equal(Governance.buildIdFromTaipeiDate(now), "20260826-1443");
  assert.equal(
    Governance.generateNewBuildId({ now, previousBuild: "20260825-2359" }),
    "20260826-1443"
  );
  assert.throws(
    () => Governance.generateNewBuildId({ now, previousBuild: "20260826-1443" }),
    error => /must use a new BUILD_ID/.test(error.message)
  );
});

test("ZIP filename using a packaging timestamp instead of BUILD_ID fails the Post-Packaging Gate", () => {
  const root = fixture();
  try {
    const outputDir = path.join(root, "dist");
    const result = Governance.packageCandidate({ root, outputDir, description: "Identity-Test", regression: passRegression() });
    const wrongZip = path.join(outputDir, `20260101-0000_Zhuge_AI_OS-v${VERSION}-Identity-Test-FullSource-Candidate.zip`);
    fs.copyFileSync(result.zipFile, wrongZip);
    const wrongManifest = `${wrongZip}.manifest.json`;
    fs.copyFileSync(result.manifestFile, wrongManifest);
    assert.throws(
      () => Governance.validateCandidate({ root, zipFile: wrongZip, manifestFile: wrongManifest }),
      error => /ZIP filename BUILD_ID\/Version contract mismatch/.test(error.message)
    );
  } finally {
    cleanup(root);
  }
});

test("cache-buster different from BUILD_ID fails the Pre-Packaging Gate", () => {
  const root = fixture({ cacheBuild: "20260826-1443" });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message) && error.details.mismatches.some(item => item.includes("cache-buster"))
    );
  } finally {
    cleanup(root);
  }
});

test("module Build different from root Build fails the Pre-Packaging Gate", () => {
  const root = fixture({ moduleBuild: "20260826-1443" });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message) && error.details.mismatches.some(item => item.includes("modules/worklog/version.json.build"))
    );
  } finally {
    cleanup(root);
  }
});

test("wrong Published Snapshot identity fails independently of Candidate Build", () => {
  const root = fixture({ candidateBuild: "20260916-1450", publishedSnapshotBuild: "20260914-0601" });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message)
        && error.details.mismatches.some(item => item.includes("publishedSnapshot.build"))
    );
  } finally {
    cleanup(root);
  }
});

test("wrong Published Snapshot loader identity fails independently of Candidate cache-busters", () => {
  const root = fixture({ candidateBuild: "20260916-1450", publishedLoaderBuild: "20260916-1450" });
  try {
    assert.throws(
      () => Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root)),
      error => /PRE-PACKAGING GATE = FAIL/.test(error.message)
        && error.details.mismatches.some(item => item.includes("template-release.js loader"))
    );
  } finally {
    cleanup(root);
  }
});

test("ordinary CSS date annotation is not treated as a Build Identity", () => {
  const root = fixture({ candidateBuild: "20260916-1450" });
  try {
    const gate = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root));
    assert.equal(gate.status, "PASS");
  } finally {
    cleanup(root);
  }
});

test("Runtime Build is the Candidate filename identity", () => {
  const createdAt = new Date("2026-08-26T06:43:00.000Z");
  const filename = Governance.candidateFilename({
    build: BUILD,
    version: VERSION,
    description: "Timestamp-Test",
    artifactCreatedAt: createdAt
  });
  assert.equal(filename, `${BUILD}_Zhuge_AI_OS-v${VERSION}-Timestamp-Test-FullSource-Candidate.zip`);
  assert.doesNotMatch(filename, /^20260826-1443_/);
});

test("Artifact Created At may differ from BUILD_ID without changing Candidate identity", () => {
  const createdAt = new Date("2026-08-26T06:43:00.000Z");
  const filename = Governance.candidateFilename({
    build: BUILD,
    version: VERSION,
    description: "Artifact-Metadata",
    artifactCreatedAt: createdAt
  });
  assert.match(filename, new RegExp(`^${BUILD}_`));
  assert.notEqual(Governance.formatArtifactFilenameTimestamp(createdAt), BUILD);
});

test("Artifact Created At differing from BUILD_ID remains valid Post-Packaging metadata", () => {
  const root = fixture();
  try {
    const result = Governance.packageCandidate({
      root,
      outputDir: path.join(root, "dist"),
      description: "Artifact-Metadata-Gate",
      createdAt: new Date("2026-08-26T06:43:00.000Z"),
      regression: passRegression()
    });
    const gate = Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile });
    const manifest = readManifest(result.manifestFile);
    assert.equal(gate.postPackagingGate.status, "PASS");
    assert.match(path.basename(result.zipFile), new RegExp(`^${BUILD}_`));
    assert.notEqual(Governance.formatArtifactFilenameTimestamp(manifest.artifactCreatedAt), BUILD);
  } finally {
    cleanup(root);
  }
});

test("dirty Git working tree fails closed before packaging", () => {
  const root = fixture();
  try {
    write(root, "shared/site.css", "body { color: red; }\n");
    assert.throws(
      () => Governance.packageCandidate({
        root,
        outputDir: path.join(root, "dist"),
        description: "Dirty-Tree",
        regression: passRegression()
      }),
      error => /Working Tree must be clean/.test(error.message)
    );
  } finally {
    cleanup(root);
  }
});

test("delivery destination is explicit and must be an available directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-release-output-"));
  try {
    assert.equal(Governance.assertFormalDeliveryRoot(root), path.resolve(root));
    assert.throws(() => Governance.assertFormalDeliveryRoot(), /Explicit artifact destination/);
    const file = path.join(root, "not-a-directory");
    fs.writeFileSync(file, "test");
    assert.throws(() => Governance.assertFormalDeliveryRoot(file), /destination is unavailable/);
  } finally { cleanup(root); }
});

test("Cloud, Mac and PM destinations do not define source authority", () => {
  assert.equal(Object.hasOwn(Governance, "FORMAL_DELIVERY_ROOT"), false);
  for (const destination of ["/workspace/artifacts/review", "/Users/pm/GoogleDrive/review", "/tmp/pm-designated"]) {
    const pair = Governance.candidatePairPaths(destination, Governance.candidateFilename({ build: BUILD, version: VERSION, description: "Delivery" }));
    assert.equal(pair.deliveryRoot, path.resolve(destination));
    assert.equal(pair.sha256File, `${pair.zipFile}.sha256`);
  }
});

test("ZIP + matching Manifest passes the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Pair-Pass");
  try {
    const pair = Governance.validateCandidatePairAtRoot({
      root,
      deliveryRoot: path.dirname(result.zipFile),
      zipFilename: filename
    });
    assert.equal(pair.status, "PASS");
  } finally {
    cleanup(root);
  }
});

test("ZIP only fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Zip-Only");
  let pairRoot;
  try {
    pairRoot = writePair(root, result, undefined, { includeManifest: false });
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate delivery pair incomplete/.test(error.message) && error.details.missing.includes("Candidate Manifest")
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Manifest only fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Manifest-Only");
  let pairRoot;
  try {
    pairRoot = writePair(root, result, undefined, { includeZip: false });
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate delivery pair incomplete/.test(error.message) && error.details.missing.includes("Candidate ZIP")
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Build mismatch fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Build-Mismatch");
  let pairRoot;
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.build = "20260826-1443";
    pairRoot = writePair(root, result, manifest);
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate Manifest mismatch/.test(error.message) && error.details.mismatches.some(item => item.includes("manifest.build"))
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Version mismatch fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Version-Mismatch");
  let pairRoot;
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.version = "0.9.0-alpha.9.12";
    pairRoot = writePair(root, result, manifest);
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate Manifest mismatch/.test(error.message) && error.details.mismatches.some(item => item.includes("manifest.version"))
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Manifest filename mismatch fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Filename-Mismatch");
  let pairRoot;
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.candidateFilename = "other-candidate.zip";
    pairRoot = writePair(root, result, manifest);
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate Manifest mismatch/.test(error.message) && error.details.mismatches.includes("manifest candidateFilename differs from ZIP filename")
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Candidate Manifest Published C identity must match the Source snapshot", () => {
  const { root, result, filename } = packageFixture("Published-C-Identity-Mismatch");
  let pairRoot;
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.publishedCIdentity.build = "20260916-1450";
    pairRoot = writePair(root, result, manifest);
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate Manifest mismatch/.test(error.message)
        && error.details.mismatches.some(item => item.includes("publishedCIdentity.build"))
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("SHA-256 mismatch fails the Candidate Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("SHA-Mismatch");
  let pairRoot;
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.sha256 = "0".repeat(64);
    pairRoot = writePair(root, result, manifest);
    assert.throws(
      () => Governance.validateCandidatePairAtRoot({ root, deliveryRoot: pairRoot, zipFilename: filename }),
      error => /Candidate Manifest mismatch/.test(error.message) && error.details.mismatches.includes("manifest SHA-256 differs from ZIP")
    );
  } finally {
    cleanup(root);
    cleanup(pairRoot);
  }
});

test("Git Commit mismatch fails the Candidate Manifest Gate", () => {
  const { root, result } = packageFixture("Commit-Mismatch");
  try {
    const manifest = readManifest(result.manifestFile);
    manifest.gitBaselineCommit = "wrong-commit";
    const identity = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(root));
    assert.throws(
      () => Governance.validateManifest(
        manifest,
        result.zipFile,
        identity,
        { fileCount: manifest.fileCount, sourceManifestSha256: manifest.sourceManifestSha256 },
        "expected-commit"
      ),
      error => /Candidate Manifest mismatch/.test(error.message) && error.details.mismatches.some(item => item.includes("gitBaselineCommit"))
    );
  } finally {
    cleanup(root);
  }
});

test("the same exact artifact verifies at a PM-selected destination", () => {
  const { root, result, filename } = packageFixture("Portable-Destination");
  const target = path.join(root, "dist", "pm-destination");
  try {
    const delivered = Governance.copyCandidatePair({ sourceZip: result.zipFile,
      sourceManifest: result.manifestFile, deliveryRoot: target, zipFilename: filename });
    assert.equal(Governance.verifyFormalDeliveryPair({ root, deliveryRoot: target, zipFilename: filename }).status, "PASS");
    assert.equal(fs.readFileSync(delivered.sha256File, "utf8"), fs.readFileSync(result.sha256File, "utf8"));
    assert.throws(() => Governance.copyCandidatePair({ sourceZip: result.zipFile,
      sourceManifest: result.manifestFile, deliveryRoot: target, zipFilename: filename }), /overwrite is forbidden/);
    assert.equal(Governance.verifyFormalDeliveryPair({ root, deliveryRoot: target, zipFilename: filename }).status, "PASS");
  } finally { cleanup(root); }
});

test("paired delivery write failure rolls back a partial target", () => {
  const { root, result, filename } = packageFixture("Rollback");
  const pairRoot = path.join(root, "rollback-pair");
  try {
    assert.throws(
      () => Governance.copyCandidatePair({
        sourceZip: result.zipFile,
        sourceManifest: path.join(root, "missing.manifest.json"),
        deliveryRoot: pairRoot,
        zipFilename: filename
      }),
      error => /paired delivery write failed/.test(error.message)
    );
    assert.equal(fs.existsSync(path.join(pairRoot, filename)), false);
    assert.throws(() => Governance.copyCandidatePair({ sourceZip: result.zipFile,
      sourceManifest: result.manifestFile, sourceSha256: path.join(root, "missing.sha256"),
      deliveryRoot: pairRoot, zipFilename: filename }), /paired delivery write failed/);
    assert.equal(fs.existsSync(path.join(pairRoot, filename)), false);
    assert.equal(fs.existsSync(path.join(pairRoot, `${filename}.manifest.json`)), false);
    assert.equal(fs.existsSync(path.join(pairRoot, `${filename}.sha256`)), false);
    assert.equal(fs.existsSync(path.join(pairRoot, `${filename}.manifest.json`)), false);
  } finally {
    cleanup(root);
  }
});


test("missing timestamp prefix fails the actual artifact validation gate", () => {
  const { root, result } = packageFixture("Missing-Timestamp");
  try {
    const badZip = path.join(root, "dist", path.basename(result.zipFile).replace(/^\d{8}-\d{4}_/, ""));
    fs.copyFileSync(result.zipFile, badZip);
    fs.copyFileSync(result.manifestFile, `${badZip}.manifest.json`);
    assert.throws(() => Governance.validateArtifact({ root, zipFile: badZip, manifestFile: `${badZip}.manifest.json` }), /filename BUILD_ID\/Version contract mismatch/);
    assert.throws(() => Governance.candidatePairPaths(path.dirname(badZip), path.basename(badZip)), /timestamp prefix/);
  } finally { cleanup(root); }
});

test("unverified TASK scope and local Backlog identity fail closed", () => {
  for (const scope of ["TASK-38", "TASK-037-Workflow", "Global-TASK-999-Fix", "task-38-Fix"]) {
    assert.throws(() => Governance.artifactFilename({ build: BUILD, version: VERSION, scope }), /Unverified formal TASK/);
  }
  assert.throws(() => Governance.assertArtifactScope("TASK-38", [{ workCode: "TASK-38", pmVisible: true }]), /Unverified formal TASK/);
  const root = fixture();
  try {
    write(root, "backlog/tasks/local.md", "id: TASK-38\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "local tracking only"], { cwd: root });
    assert.throws(() => Governance.verifyFormalTaskIds("TASK-38", root), /Formal TASK readback unavailable/);
    assert.throws(() => Governance.packageArtifact({ root, artifactType: "review", scope: "TASK-38",
      regression: passRegression() }), /BUILD_IDENTITY_STALE/);
  } finally { cleanup(root); }
});

test("formal TASK scope reuses protected inspect and records sanitized Board identity", () => {
  const root = fixture();
  try {
    // Isolated stand-in for the existing read-only tool, never a real Cloud call.
    write(root, "tools/engineering-transition.js", `console.log(JSON.stringify({task:{id:'480f59c0-d252-4e04-9b37-457bfbac346b',work_code:'TASK-079',board_instance_id:'70d94d8d-7c49-48ed-b39c-c985c6efea3e'}}));`);
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "isolated inspect contract"], { cwd: root });
    // The completed inspect stub is part of this isolated formal fixture baseline.
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: root });
    const result = Governance.packageArtifact({ root, artifactType: "review", scope: "TASK-079-Archive-Fix", regression: passRegression() });
    const manifest = readManifest(result.manifestFile);
    assert.equal(manifest.formalTaskIdentity.length, 1);
    assert.equal(manifest.formalTaskIdentity[0].authority, "engineering-transition.inspect");
    assert.equal(manifest.formalTaskIdentity[0].workCode, "TASK-079");
    assert.equal(manifest.formalTaskIdentity[0].pmVisible, true);
    assert.equal(Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.status, "PASS");
    assert.doesNotMatch(JSON.stringify(manifest.formalTaskIdentity), /token|credential|private/i);
    manifest.formalTaskIdentity[0].taskId = "00000000-0000-0000-0000-000000000000";
    fs.writeFileSync(result.manifestFile, JSON.stringify(manifest));
    assert.throws(() => Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /differs from protected Board readback/);
  } finally { cleanup(root); }
});

test("descriptive Review uses actual Taipei creation time and keeps source Build separate", () => {
  assert.throws(() => Governance.artifactFilename({ artifactType: "review", build: BUILD, version: VERSION, scope: "Descriptive" }), /Artifact Created At is required/);
  const root = fixture();
  try {
    const result = Governance.packageArtifact({ root, artifactType: "review", scope: "Global-Header-Workspace-Count-Archive-Fix",
      regression: passRegression(), createdAt: new Date("2026-10-03T09:43:12Z") });
    const manifest = readManifest(result.manifestFile);
    assert.equal(path.basename(result.zipFile), `20261003-1743_Zhuge_AI_OS-v${VERSION}-Global-Header-Workspace-Count-Archive-Fix-FullSource-Review.zip`);
    assert.equal(manifest.artifactCreatedAt, "2026-10-03T17:43:12+08:00");
    assert.equal(manifest.build, BUILD);
    assert.equal(Object.hasOwn(manifest, "candidateBuild"), false);
    assert.deepEqual(manifest.formalTaskIdentity, []);
    assert.equal(manifest.SOURCE_SHA, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
    assert.equal(manifest.PARENT_SHA, execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim());
    assert.equal(fs.readFileSync(result.sha256File, "utf8"), `${result.sha256}  ${path.basename(result.zipFile)}\n`);
    assert.equal(path.basename(result.manifestFile), `${path.basename(result.zipFile)}.manifest.json`);
    assert.equal(Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.sha256Sidecar, "PASS");
  } finally { cleanup(root); }
});

test("QA Backup uses the same packager and creation-time naming gate", () => {
  const root = fixture();
  try {
    const result = Governance.packageArtifact({ root, artifactType: "qa-backup", scope: "Governance-Enforcement",
      regression: passRegression(), createdAt: new Date("2026-10-03T10:45:00Z") });
    assert.equal(path.basename(result.zipFile), `20261003-1845_Zhuge_AI_OS-v${VERSION}-Governance-Enforcement-FullSource-QA-Backup.zip`);
    assert.equal(readManifest(result.manifestFile).artifactType, "qa-backup");
    assert.equal(Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.sourceZip, "PASS");
    assert.throws(() => Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /requires Candidate/);
  } finally { cleanup(root); }
});

test("Review creation-time or timezone tampering fails Manifest/filename validation", () => {
  const root = fixture();
  try {
    const result = Governance.packageArtifact({ root, artifactType: "review", scope: "Timestamp-Enforcement", regression: passRegression(), createdAt: new Date("2026-10-03T09:43:12Z") });
    const original = readManifest(result.manifestFile);
    fs.writeFileSync(result.manifestFile, JSON.stringify({ ...original, artifactCreatedAt: "2026-10-03T18:43:12+08:00" }));
    assert.throws(() => Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /Artifact Created At naming mismatch/);
    fs.writeFileSync(result.manifestFile, JSON.stringify({ ...original, artifactCreatedAt: "2026-10-03T09:43:12Z" }));
    assert.throws(() => Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), error => error.details.mismatches.some(item => item.includes("Asia/Taipei timestamp")));
  } finally { cleanup(root); }
});

test("Candidate Build, Parent SHA and sidecar identity each fail independently when tampered", () => {
  const { root, result } = packageFixture("Identity-Tampering");
  try {
    const original = readManifest(result.manifestFile);
    for (const patch of [{ candidateBuild: "20260101-0000" }, { PARENT_SHA: "0".repeat(40), parentCommit: "0".repeat(40) }]) {
      fs.writeFileSync(result.manifestFile, JSON.stringify({ ...original, ...patch }));
      assert.throws(() => Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /Manifest mismatch/);
    }
    fs.writeFileSync(result.manifestFile, JSON.stringify(original));
    const checksum = fs.readFileSync(result.sha256File, "utf8");
    fs.unlinkSync(result.sha256File);
    assert.throws(() => Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /SHA256 sidecar is missing/);
    for (const corrupted of [checksum.replace(result.sha256, "0".repeat(64)), checksum.replace(path.basename(result.zipFile), "wrong.zip")]) {
      fs.writeFileSync(result.sha256File, corrupted);
      assert.throws(() => Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /sidecar hash \/ filename mismatch/);
    }
    fs.writeFileSync(result.sha256File, checksum);
    assert.equal(Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.status, "PASS");
  } finally { cleanup(root); }
});

test("manifest basename, eligible commit blobs and ignored artifacts are enforced", () => {
  const root = fixture();
  try {
    write(root, "tests/.ai-board-batch-2-browser-1480.html", "legacy generated scratch");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "legacy tracked scratch"], { cwd: root });
    write(root, ".cache/browser-profile/token.json", "ignored private runtime artifact");
    const result = Governance.packageArtifact({ root, artifactType: "review", scope: "Source-Consistency", regression: passRegression() });
    const manifest = readManifest(result.manifestFile);
    const entries = execFileSync("unzip", ["-Z1", result.zipFile], { encoding: "utf8" });
    assert.doesNotMatch(entries, /node_modules|\.cache|browser-profile|\.ai-board-batch-2-browser/);
    assert.equal(manifest.exclusions[0].path, "tests/.ai-board-batch-2-browser-1480.html");
    assert.equal(manifest.files.length, manifest.fileCount);
    assert.equal(manifest.SOURCE_SHA, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
    const wrongManifest = path.join(root, "dist", "wrong.manifest.json");
    fs.copyFileSync(result.manifestFile, wrongManifest);
    assert.throws(() => Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: wrongManifest }), /complete ZIP basename/);
    assert.equal(Governance.validateArtifact({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.gitBlobConsistency, "PASS");
  } finally { cleanup(root); }
});

test("browser BLOCKED/SKIP is never packaging PASS", () => {
  for (const state of ["FAIL", "BLOCKED", "SKIP", "NOT VERIFIED", "PENDING", undefined]) {
    assert.throws(() => Governance.assertRegressionEvidence({ ...passRegression(), browser: state }), /browser must be PASS/);
  }
});

test("Push main governance wording matches automatic Pages deployment and separate mutation gates", () => {
  for (const file of ["CLOUD_HANDOFF.md", "docs/10_GOVERNANCE/RELEASE.md", "tools/README.md"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, /Push main = GitHub Pages Production Auto Deploy/);
    assert.match(source, /exact-SHA/);
    assert.match(source, /[Ll]ocal commit/);
    assert.match(source, /migration/i);
  }
  const handoff = fs.readFileSync(path.join(ROOT, "CLOUD_HANDOFF.md"), "utf8");
  assert.doesNotMatch(handoff, /A commit or tag identifies source; it does not automatically deploy/);
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  assert.match(agents, /Backlog is a local tracking mirror, not an ID authority/);
  assert.match(agents, /Never run task creation to allocate a formal TASK number locally/);
});


test("MATERIAL SOURCE CHANGE RULE blocks stale Build for Candidate, Review and QA Backup", () => {
  const root = fixture();
  try {
    write(root, "docs/completed-source-change.md", "material governance/source change\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "completed material change"], { cwd: root });
    assert.throws(() => Governance.assertMaterialBuildIdentity(root), error =>
      error.details.code === "BUILD_IDENTITY_STALE"
      && error.details.previousBuild === BUILD && error.details.currentBuild === BUILD
      && error.details.changedFiles.includes("docs/completed-source-change.md"));
    for (const artifactType of ["candidate", "review", "qa-backup"]) {
      assert.throws(() => Governance.packageArtifact({ root, artifactType, scope: "Material-Source-Change",
        regression: passRegression() }), /BUILD_IDENTITY_STALE/);
    }
    assert.equal(fs.existsSync(path.join(root, "dist")), false, "No stale artifact is written");
    const tool = path.join(ROOT, "tools/release-governance.js");
    assert.throws(() => execFileSync(process.execPath, [tool, "preflight", "--root", root], { stdio: "pipe" }),
      error => error.status === 1 && /BUILD_IDENTITY_STALE/.test(error.stderr.toString()));
  } finally { cleanup(root); }
});

test("unchanged Source permits artifact-only relocation/reverification with the same Build", () => {
  const { root, result, filename } = packageFixture("Artifact-Only");
  try {
    const gate = Governance.assertMaterialBuildIdentity(root);
    assert.equal(gate.materialSourceChanged, false);
    assert.equal(gate.previousBuild, BUILD);
    assert.equal(gate.currentBuild, BUILD);
    const destination = path.join(root, "dist", "relocated");
    const copied = Governance.copyCandidatePair({ sourceZip: result.zipFile, sourceManifest: result.manifestFile,
      deliveryRoot: destination, zipFilename: filename });
    const readback = Governance.verifyFormalDeliveryPair({ root, deliveryRoot: destination, zipFilename: filename });
    assert.equal(readback.status, "PASS");
    assert.deepEqual(fs.readFileSync(copied.zipFile), fs.readFileSync(result.zipFile));
    assert.equal(readManifest(copied.manifestFile).build, BUILD);
  } finally { cleanup(root); }
});

test("new synchronized Build accepts material Source and preserves Published C evidence", () => {
  const root = fixture();
  try {
    const before = Governance.readIdentitySnapshot(root);
    const nextBuild = BUILD === "20261004-0800" ? "20261004-0801" : "20261004-0800";
    const publishedLoader = before.publishedSnapshotLoaders;
    write(root, "shared/material-source.js", "const materialChange = true;\n");
    const sync = Governance.synchronizeBuildIdentity({ root, build: nextBuild });
    assert.equal(sync.status, "PASS");
    const after = Governance.readIdentitySnapshot(root);
    assert.equal(Governance.assertSourceIdentity(after).build, nextBuild);
    assert.deepEqual(after.publishedCIdentity, before.publishedCIdentity);
    assert.deepEqual(after.publishedSnapshotLoaders, publishedLoader);
    assert.deepEqual(after.developmentCIdentity, { version: VERSION, build: nextBuild });
    assert.equal(after.runtimeUi.rootFooter.build, nextBuild);
    assert.equal(after.runtimeUi.dashboardFallback.build, nextBuild);
    assert.equal(after.appConfig.build, nextBuild);
    assert.equal(after.sharedVersion.build, nextBuild);
    assert.ok(after.cacheBusters.every(item => item.build === nextBuild));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "new synchronized Formal Build"], { cwd: root });
    const gate = Governance.assertMaterialBuildIdentity(root);
    assert.equal(gate.status, "PASS");
    assert.equal(gate.materialSourceChanged, true);
    assert.equal(gate.previousBuild, BUILD);
    assert.equal(gate.currentBuild, nextBuild);
    const result = Governance.packageCandidate({ root, description: "New-Formal-Build", regression: passRegression() });
    const manifest = readManifest(result.manifestFile);
    assert.equal(manifest.build, nextBuild);
    assert.equal(manifest.candidateBuild, nextBuild);
    assert.deepEqual(manifest.buildIdentityGate, gate);
    const immutableManifest = fs.readFileSync(result.manifestFile);
    // Simulate authorized promotion in an isolated fixture only. The archive's
    // original baseline proof must remain valid after main advances to Source.
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: root });
    assert.equal(Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }).postPackagingGate.status, "PASS");
    assert.deepEqual(fs.readFileSync(result.manifestFile), immutableManifest);
    manifest.buildIdentityGate.previousBuild = nextBuild;
    fs.writeFileSync(result.manifestFile, JSON.stringify(manifest));
    assert.throws(() => Governance.validateCandidate({ root, zipFile: result.zipFile, manifestFile: result.manifestFile }), /differs from formal Git baseline/);
  } finally { cleanup(root); }
});

test("a missing formal main baseline cannot be replaced by a local work commit or a flag", () => {
  const root = fixture();
  try {
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: root });
    assert.throws(() => Governance.assertMaterialBuildIdentity(root), /BUILD_BASELINE_UNAVAILABLE/);
    assert.throws(() => Governance.packageCandidate({ root, description: "No-Baseline", regression: passRegression(), previousBuild: "20260101-0000" }), /BUILD_BASELINE_UNAVAILABLE/);
    assert.throws(() => Governance.synchronizeBuildIdentity({ root, build: BUILD }), /requires a different valid BUILD_ID/);
  } finally { cleanup(root); }
});

test("formal main must be in development ancestry and commits cannot silently become the baseline", () => {
  const root = fixture();
  try {
    const oldFormal = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
    write(root, "shared/material-source.js", "material change\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "unreleased work"], { cwd: root });
    assert.throws(() => Governance.assertMaterialBuildIdentity(root), /BUILD_IDENTITY_STALE/);
    assert.equal(execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(), oldFormal);
    const unrelated = execFileSync("git", ["commit-tree", `${oldFormal}^{tree}`, "-m", "unrelated formal lineage"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", unrelated], { cwd: root });
    assert.throws(() => Governance.assertMaterialBuildIdentity(root), /BUILD_BASELINE_DIVERGED/);
  } finally { cleanup(root); }
});

test("all governing documents require a new Build even for material Review/QA delivery", () => {
  for (const file of ["docs/10_GOVERNANCE/RELEASE.md", "AGENTS.md", "CLOUD_HANDOFF.md"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, /MATERIAL SOURCE CHANGE RULE/);
    assert.match(source, /BUILD_IDENTITY_STALE/);
    assert.match(source, /artifact-only/);
  }
  const release = fs.readFileSync(path.join(ROOT, "docs/10_GOVERNANCE/RELEASE.md"), "utf8");
  assert.doesNotMatch(release, /do not change the\nsource Build merely to archive governance/);
  assert.match(release, /review acceptance, Candidate creation, or PM handoff MUST/);
});
