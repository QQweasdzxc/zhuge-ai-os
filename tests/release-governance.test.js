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
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: root });
  return root;
}

function passRegression() {
  return { governance: "PASS", checklist: "PASS", full: "PASS", gitDiffCheck: "PASS" };
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
  if (includeManifest) fs.writeFileSync(path.join(pairRoot, path.basename(result.manifestFile)), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return pairRoot;
}

test("normal identity passes the Pre-Packaging Gate", () => {
  const gate = Governance.assertSourceIdentity(Governance.readIdentitySnapshot(ROOT));
  assert.equal(gate.status, "PASS");
  assert.equal(gate.build, BUILD);
  assert.equal(gate.version, VERSION);
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
    assert.throws(
      () => Governance.validateCandidate({ root, zipFile: wrongZip, manifestFile: result.manifestFile }),
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

test("temporary dist output is not a formal PM delivery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-release-output-"));
  try {
    assert.throws(() => Governance.assertFormalDeliveryRoot(root), /unexpected PM delivery location/);
  } finally {
    cleanup(root);
  }
});

test("formal PM delivery location is a distinct controlled path", () => {
  assert.equal(path.resolve(Governance.FORMAL_DELIVERY_ROOT), Governance.FORMAL_DELIVERY_ROOT);
  assert.doesNotMatch(Governance.FORMAL_DELIVERY_ROOT, /\/Worktrees\//);
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

test("wrong formal delivery destination fails the Formal Delivery Pair Gate", () => {
  const { root, result, filename } = packageFixture("Wrong-Destination");
  const wrongRoot = path.join(root, "not-formal-delivery");
  try {
    assert.throws(
      () => Governance.verifyFormalDeliveryPair({ root, deliveryRoot: wrongRoot, zipFilename: filename }),
      error => /unexpected PM delivery location/.test(error.message)
    );
  } finally {
    cleanup(root);
  }
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
    assert.equal(fs.existsSync(path.join(pairRoot, `${filename}.manifest.json`)), false);
  } finally {
    cleanup(root);
  }
});
