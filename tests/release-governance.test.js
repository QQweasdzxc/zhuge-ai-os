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
