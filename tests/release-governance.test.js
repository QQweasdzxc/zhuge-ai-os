const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Governance = require("../tools/release-governance.js");

const ROOT = path.join(__dirname, "..");
const VERSION = "0.9.0-alpha.9.13";
const BUILD = "20260826-1524";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function fixture({ cacheBuild = BUILD, moduleBuild = BUILD } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-release-gate-fixture-"));
  write(root, "version.json", JSON.stringify({ module: "Zhuge AI OS", version: VERSION, build: BUILD }));
  write(root, "index.html", `<!doctype html><link rel="stylesheet" href="shared/site.css?v=${cacheBuild}"><span>Version ${VERSION} · Build ${BUILD}</span>`);
  write(root, "shared/site.css", "body { color: black; }");
  write(root, "shared/app-config.js", `const VERSION = "${VERSION}";\nconst BUILD_TIME = "${BUILD}";`);
  write(root, "shared/config/version.js", `globalThis.version = { version: "${VERSION}", build: "${BUILD}" };`);
  write(root, "shared/runtime.js", `const runtime = "runtime.js?v=${cacheBuild}";`);
  write(root, "app/dashboard/index.html", `<meta name="application-version" content="${VERSION}">`);
  write(root, "app/dashboard/zhuge-dashboard.js", `const version = typeof VERSION !== "undefined" ? VERSION : "${VERSION}";\nconst build = typeof BUILD_TIME !== "undefined" ? BUILD_TIME : "${BUILD}";`);
  write(root, "modules/worklog/version.json", JSON.stringify({ version: VERSION, build: moduleBuild }));
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
});

test("ZIP Build different from Source Build fails the Post-Packaging Gate", () => {
  const root = fixture();
  try {
    const outputDir = path.join(root, "dist");
    const result = Governance.packageCandidate({ root, outputDir, description: "Identity-Test", regression: passRegression() });
    const wrongZip = path.join(outputDir, `20260826-1443_Zhuge_AI_OS-v${VERSION}-Identity-Test-FullSource-Candidate.zip`);
    fs.copyFileSync(result.zipFile, wrongZip);
    assert.throws(
      () => Governance.validateCandidate({ root, zipFile: wrongZip, manifestFile: result.manifestFile }),
      error => /ZIP filename Build\/Version contract mismatch/.test(error.message)
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

test("packaging timestamp never becomes the Candidate filename identity", () => {
  const filename = Governance.candidateFilename({ build: BUILD, version: VERSION, description: "Timestamp-Test" });
  assert.match(filename, new RegExp(`^${BUILD}_Zhuge_AI_OS-v`));
  assert.doesNotMatch(filename, /20260826-1443/);
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
    assert.throws(
      () => Governance.validateManifest(
        manifest,
        result.zipFile,
        { build: BUILD, version: VERSION },
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
