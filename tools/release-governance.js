#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FORMAL_DELIVERY_ROOT = "/Users/qq/Library/CloudStorage/GoogleDrive-qq.1025@gmail.com/我的雲端硬碟/TOOLS-自製/ZhuGe AI OS/版控";
const RUNTIME_SCAN_ROOTS = ["index.html", "app", "modules", "shared"];
const RUNTIME_EXTENSIONS = new Set([".html", ".js", ".css"]);
const FORBIDDEN_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules"]);
const FORBIDDEN_FILE_NAMES = new Set([".DS_Store"]);
const FORBIDDEN_FILE_EXTENSIONS = new Set([".crt", ".jwk", ".key", ".pem", ".p12"]);
const BUILD_PATTERN = /^202\d{5}-\d{4}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
const CACHE_BUSTER_PATTERN = /\?v=(202\d{5}-\d{4})\b/g;
const BUILD_LITERAL_PATTERN = /\b(202\d{5}-\d{4})\b/g;

class ReleaseGovernanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReleaseGovernanceError";
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new ReleaseGovernanceError(message, details);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, absolutePath) {
  return toPosix(path.relative(root, absolutePath));
}

function isForbiddenRelativePath(relative) {
  if (!relative) return false;
  const segments = relative.split("/");
  const basename = segments[segments.length - 1];
  if (segments.some(segment => FORBIDDEN_DIRECTORY_NAMES.has(segment))) return true;
  if (FORBIDDEN_FILE_NAMES.has(basename)) return true;
  if (/^\.env(?:\.|$)/i.test(basename)) return true;
  return FORBIDDEN_FILE_EXTENSIONS.has(path.extname(basename).toLowerCase());
}

function collectFiles(root) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativePath(root, absolute);
      if (isForbiddenRelativePath(relative)) continue;
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      } else if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(absolute);
        const targetRelative = relativePath(root, target);
        const targetStat = fs.statSync(target);
        if (targetRelative.startsWith("../") || path.isAbsolute(targetRelative) || isForbiddenRelativePath(targetRelative)) {
          fail(`Symbolic link escapes the permitted source root: ${relative}`, { file: relative, target });
        }
        if (!targetStat.isFile()) {
          fail(`Symbolic link target is not a file: ${relative}`, { file: relative, target });
        }
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function isRuntimeFile(relative) {
  if (!RUNTIME_EXTENSIONS.has(path.extname(relative).toLowerCase())) return false;
  return RUNTIME_SCAN_ROOTS.some(rootName => relative === rootName || relative.startsWith(`${rootName}/`));
}

function readText(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) fail(`Required identity source is missing: ${relative}`, { file: relative });
  return fs.readFileSync(file, "utf8");
}

function readJson(root, relative) {
  let parsed;
  try {
    parsed = JSON.parse(readText(root, relative));
  } catch (error) {
    fail(`Identity JSON is invalid: ${relative}`, { file: relative, cause: error.message });
  }
  return parsed;
}

function matchOne(source, pattern, label, file) {
  const match = source.match(pattern);
  if (!match) fail(`${label} is missing from ${file}`, { file, label });
  return match[1];
}

function moduleVersionFiles(root) {
  const modulesRoot = path.join(root, "modules");
  if (!fs.existsSync(modulesRoot)) return [];
  return fs.readdirSync(modulesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => toPosix(path.join("modules", entry.name, "version.json")))
    .filter(relative => fs.existsSync(path.join(root, relative)))
    .sort();
}

function readIdentitySnapshot(root = PROJECT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const rootManifest = readJson(resolvedRoot, "version.json");
  const appConfigSource = readText(resolvedRoot, "shared/app-config.js");
  const sharedVersionSource = readText(resolvedRoot, "shared/config/version.js");
  const rootIndexSource = readText(resolvedRoot, "index.html");
  const dashboardSource = readText(resolvedRoot, "app/dashboard/zhuge-dashboard.js");
  const dashboardIndexSource = readText(resolvedRoot, "app/dashboard/index.html");
  const modules = moduleVersionFiles(resolvedRoot).map(relative => ({
    file: relative,
    ...readJson(resolvedRoot, relative)
  }));

  const cacheBusters = [];
  const buildLiterals = [];
  for (const relative of collectFiles(resolvedRoot).filter(isRuntimeFile)) {
    const source = readText(resolvedRoot, relative);
    for (const match of source.matchAll(CACHE_BUSTER_PATTERN)) {
      cacheBusters.push({ file: relative, build: match[1] });
    }
    for (const match of source.matchAll(BUILD_LITERAL_PATTERN)) {
      buildLiterals.push({ file: relative, build: match[1] });
    }
  }

  return {
    root: resolvedRoot,
    product: String(rootManifest.module || "Zhuge AI OS"),
    version: String(rootManifest.version || ""),
    build: String(rootManifest.build || ""),
    rootManifest,
    modules,
    appConfig: {
      version: matchOne(appConfigSource, /\bconst\s+VERSION\s*=\s*["']([^"']+)["']/,
        "VERSION", "shared/app-config.js"),
      build: matchOne(appConfigSource, /\bconst\s+BUILD_TIME\s*=\s*["']([^"']+)["']/,
        "BUILD_TIME", "shared/app-config.js")
    },
    sharedVersion: {
      version: matchOne(sharedVersionSource, /\bversion\s*:\s*["']([^"']+)["']/,
        "version", "shared/config/version.js"),
      build: matchOne(sharedVersionSource, /\bbuild\s*:\s*["']([^"']+)["']/,
        "build", "shared/config/version.js")
    },
    runtimeUi: {
      rootFooter: {
        version: matchOne(rootIndexSource,
          /Version\s+([^<·]+?)\s*·\s*Build\s+202\d{5}-\d{4}/,
          "Version footer", "index.html").trim(),
        build: matchOne(rootIndexSource,
          /Version\s+[^<·]+?\s*·\s*Build\s+(202\d{5}-\d{4})/,
          "Build footer", "index.html")
      },
      dashboardMetaVersion: matchOne(dashboardIndexSource,
        /name=["']application-version["']\s+content=["']([^"']+)["']/,
        "application-version", "app/dashboard/index.html"),
      dashboardFallback: {
        version: matchOne(dashboardSource,
          /const\s+version\s*=\s*typeof\s+VERSION\s*!==\s*["']undefined["']\s*\?\s*VERSION\s*:\s*["']([^"']+)["']/,
          "dashboard fallback version", "app/dashboard/zhuge-dashboard.js"),
        build: matchOne(dashboardSource,
          /const\s+build\s*=\s*typeof\s+BUILD_TIME\s*!==\s*["']undefined["']\s*\?\s*BUILD_TIME\s*:\s*["'](202\d{5}-\d{4})["']/,
          "dashboard fallback build", "app/dashboard/zhuge-dashboard.js")
      }
    },
    cacheBusters,
    buildLiterals
  };
}

function assertSourceIdentity(snapshot) {
  const mismatches = [];
  const { build, version } = snapshot;
  if (!VERSION_PATTERN.test(version)) mismatches.push(`invalid root version: ${version}`);
  if (!BUILD_PATTERN.test(build)) mismatches.push(`invalid root build: ${build}`);

  for (const module of snapshot.modules) {
    if (module.version !== version) mismatches.push(`${module.file}.version=${module.version} != ${version}`);
    if (module.build !== build) mismatches.push(`${module.file}.build=${module.build} != ${build}`);
  }

  const identityValues = [
    ["shared/app-config.js VERSION", snapshot.appConfig.version, version],
    ["shared/app-config.js BUILD_TIME", snapshot.appConfig.build, build],
    ["shared/config/version.js version", snapshot.sharedVersion.version, version],
    ["shared/config/version.js build", snapshot.sharedVersion.build, build],
    ["index.html footer version", snapshot.runtimeUi.rootFooter.version, version],
    ["index.html footer build", snapshot.runtimeUi.rootFooter.build, build],
    ["app/dashboard/index.html application-version", snapshot.runtimeUi.dashboardMetaVersion, version],
    ["app/dashboard/zhuge-dashboard.js fallback version", snapshot.runtimeUi.dashboardFallback.version, version],
    ["app/dashboard/zhuge-dashboard.js fallback build", snapshot.runtimeUi.dashboardFallback.build, build]
  ];
  for (const [label, actual, expected] of identityValues) {
    if (actual !== expected) mismatches.push(`${label}=${actual} != ${expected}`);
  }

  if (!snapshot.cacheBusters.length) mismatches.push("no formal runtime cache-buster was found");
  for (const item of snapshot.cacheBusters) {
    if (item.build !== build) mismatches.push(`${item.file} cache-buster=${item.build} != ${build}`);
  }
  for (const item of snapshot.buildLiterals) {
    if (item.build !== build) mismatches.push(`${item.file} build literal=${item.build} != ${build}`);
  }

  if (mismatches.length) {
    fail("PRE-PACKAGING GATE = FAIL: Build Identity mismatch", { build, version, mismatches });
  }

  return Object.freeze({
    status: "PASS",
    build,
    version,
    moduleFiles: snapshot.modules.map(module => module.file),
    cacheBusterCount: snapshot.cacheBusters.length,
    runtimeBuildLiteralCount: snapshot.buildLiterals.length
  });
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceManifest(root) {
  return collectFiles(root).map(relative => {
    const absolute = path.join(root, relative);
    return Object.freeze({
      path: relative,
      bytes: fs.statSync(absolute).size,
      sha256: sha256File(absolute)
    });
  });
}

function sourceManifestDigest(manifest) {
  return sha256Text(JSON.stringify(manifest));
}

function compareManifests(expected, actual) {
  const expectedByPath = new Map(expected.map(item => [item.path, item]));
  const actualByPath = new Map(actual.map(item => [item.path, item]));
  const mismatches = [];
  for (const item of expected) {
    const found = actualByPath.get(item.path);
    if (!found) {
      mismatches.push(`missing: ${item.path}`);
    } else if (found.bytes !== item.bytes || found.sha256 !== item.sha256) {
      mismatches.push(`changed: ${item.path}`);
    }
  }
  for (const item of actual) {
    if (!expectedByPath.has(item.path)) mismatches.push(`unexpected: ${item.path}`);
  }
  if (mismatches.length) fail("Source ↔ ZIP manifest mismatch", { mismatches });
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function formatArtifactCreatedAt(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function candidateFilename({ build, version, description }) {
  if (!BUILD_PATTERN.test(build)) fail(`Invalid Build ID for Candidate filename: ${build}`);
  if (!VERSION_PATTERN.test(version)) fail(`Invalid Version for Candidate filename: ${version}`);
  const cleanDescription = String(description || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(cleanDescription)) {
    fail("Candidate description must contain only ASCII letters, numbers, and hyphens.", { description });
  }
  return `${build}_Zhuge_AI_OS-v${version}-${cleanDescription}-FullSource-Candidate.zip`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateFilenameParts(filename, { build, version }) {
  const pattern = new RegExp(
    `^${escapeRegExp(build)}_Zhuge_AI_OS-v${escapeRegExp(version)}-([A-Za-z0-9][A-Za-z0-9-]*)-FullSource-Candidate\\.zip$`
  );
  return path.basename(filename).match(pattern);
}

function manifestFilename(zipFilename) {
  return `${zipFilename}.manifest.json`;
}

function assertRegressionEvidence(regression) {
  for (const field of ["governance", "checklist", "full", "gitDiffCheck"]) {
    if (!regression || regression[field] !== "PASS") {
      fail(`Regression evidence ${field} must be PASS before packaging`, { regression });
    }
  }
  return regression;
}

function copySource(root, destination, files) {
  for (const relative of files) {
    const source = path.join(root, relative);
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function unzipList(zipFile) {
  const output = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8" });
  return output.split(/\r?\n/)
    .map(value => value.replace(/^\.\//, "").trim())
    .filter(value => value && value !== "." && !value.endsWith("/"));
}

function validateArchive(root, zipFile, expectedSourceManifest, expectedIdentity) {
  try {
    execFileSync("unzip", ["-t", zipFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    fail("POST-PACKAGING GATE = FAIL: unzip -t failed", { zipFile, cause: error.message });
  }

  const entries = unzipList(zipFile);
  const forbidden = entries.filter(relative => isForbiddenRelativePath(relative));
  if (forbidden.length) fail("POST-PACKAGING GATE = FAIL: forbidden archive entry", { forbidden });

  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-candidate-verify-"));
  try {
    execFileSync("unzip", ["-q", zipFile, "-d", extractRoot], { stdio: ["ignore", "pipe", "pipe"] });
    const extractedSnapshot = readIdentitySnapshot(extractRoot);
    const extractedGate = assertSourceIdentity(extractedSnapshot);
    if (extractedGate.build !== expectedIdentity.build || extractedGate.version !== expectedIdentity.version) {
      fail("POST-PACKAGING GATE = FAIL: ZIP identity differs from Source identity", {
        source: expectedIdentity,
        archive: extractedGate
      });
    }
    const extractedManifest = sourceManifest(extractRoot);
    compareManifests(expectedSourceManifest, extractedManifest);
    return Object.freeze({
      status: "PASS",
      unzipTest: "PASS",
      sourceZip: "PASS",
      fileCount: extractedManifest.length,
      sourceManifestSha256: sourceManifestDigest(expectedSourceManifest),
      archiveEntries: entries.length
    });
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}

function assertFormalDeliveryRoot(deliveryRoot) {
  const resolved = path.resolve(deliveryRoot);
  if (resolved !== FORMAL_DELIVERY_ROOT) {
    fail("FORMAL DELIVERY GATE = FAIL: unexpected PM delivery location", {
      expected: FORMAL_DELIVERY_ROOT,
      actual: resolved
    });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail("FORMAL DELIVERY GATE = FAIL: PM delivery location is unavailable", { deliveryRoot: resolved });
  }
  return resolved;
}

function validateManifest(manifest, zipFile, identity, archiveValidation) {
  const expectedFilename = path.basename(zipFile);
  const mismatches = [];
  if (manifest.build !== identity.build) mismatches.push(`manifest.build=${manifest.build} != ${identity.build}`);
  if (manifest.version !== identity.version) mismatches.push(`manifest.version=${manifest.version} != ${identity.version}`);
  if (manifest.candidateFilename !== expectedFilename) mismatches.push("manifest candidateFilename differs from ZIP filename");
  if (manifest.sha256 !== sha256File(zipFile)) mismatches.push("manifest SHA-256 differs from ZIP");
  if (manifest.fileCount !== archiveValidation.fileCount) mismatches.push("manifest fileCount differs from ZIP");
  if (manifest.sourceManifestSha256 !== archiveValidation.sourceManifestSha256) mismatches.push("manifest Source manifest digest differs");
  if (manifest.prePackagingGate !== "PASS") mismatches.push("manifest prePackagingGate is not PASS");
  if (manifest.postPackagingGate !== "PASS") mismatches.push("manifest postPackagingGate is not PASS");
  if (!manifest.artifactCreatedAt) mismatches.push("manifest artifactCreatedAt is missing");
  if (mismatches.length) fail("POST-PACKAGING GATE = FAIL: Candidate Manifest mismatch", { mismatches });
  return Object.freeze({ status: "PASS", manifest: manifestFilename(expectedFilename) });
}

function validateCandidate({ root = PROJECT_ROOT, zipFile, manifestFile }) {
  const resolvedRoot = path.resolve(root);
  const identitySnapshot = readIdentitySnapshot(resolvedRoot);
  const preGate = assertSourceIdentity(identitySnapshot);
  const filenameParts = candidateFilenameParts(path.basename(zipFile), preGate);
  const expectedName = filenameParts
    ? candidateFilename({ build: preGate.build, version: preGate.version, description: filenameParts[1] })
    : null;
  if (path.basename(zipFile) !== expectedName) {
    fail("POST-PACKAGING GATE = FAIL: ZIP filename Build/Version contract mismatch", {
      expectedPrefix: `${preGate.build}_Zhuge_AI_OS-v${preGate.version}-`,
      actual: path.basename(zipFile)
    });
  }
  const expectedManifest = sourceManifest(resolvedRoot);
  const archiveValidation = validateArchive(resolvedRoot, zipFile, expectedManifest, preGate);
  if (!fs.existsSync(manifestFile)) fail("POST-PACKAGING GATE = FAIL: Candidate Manifest is missing", { manifestFile });
  const manifest = readJson(path.dirname(manifestFile), path.basename(manifestFile));
  const manifestValidation = validateManifest(manifest, zipFile, preGate, archiveValidation);
  return Object.freeze({ prePackagingGate: preGate, postPackagingGate: { ...archiveValidation, ...manifestValidation } });
}

function packageCandidate({
  root = PROJECT_ROOT,
  outputDir = path.join(root, "dist"),
  description,
  regression = {},
  deliver = false,
  deliveryRoot = FORMAL_DELIVERY_ROOT,
  createdAt = new Date()
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputDir);
  assertRegressionEvidence(regression);
  const snapshot = readIdentitySnapshot(resolvedRoot);
  const preGate = assertSourceIdentity(snapshot);
  const sourceFiles = sourceManifest(resolvedRoot);
  const filename = candidateFilename({ build: preGate.build, version: preGate.version, description });
  const zipFile = path.join(resolvedOutput, filename);
  const manifestFile = path.join(resolvedOutput, manifestFilename(filename));
  if (fs.existsSync(zipFile) || fs.existsSync(manifestFile)) {
    fail("PACKAGING GATE = FAIL: Candidate output already exists; overwrite is forbidden", { zipFile, manifestFile });
  }
  const formalRoot = deliver ? assertFormalDeliveryRoot(deliveryRoot) : null;
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-candidate-stage-"));
  const artifactCreatedAt = formatArtifactCreatedAt(createdAt);
  try {
    copySource(resolvedRoot, stagingRoot, sourceFiles.map(item => item.path));
    execFileSync("zip", ["-qr", zipFile, "."], { cwd: stagingRoot, stdio: ["ignore", "pipe", "pipe"] });
    const archiveValidation = validateArchive(resolvedRoot, zipFile, sourceFiles, preGate);
    const manifest = {
      product: snapshot.product,
      version: preGate.version,
      build: preGate.build,
      gitBaselineCommit: runGit(resolvedRoot, ["rev-parse", "HEAD"]),
      sourceRoot: resolvedRoot,
      sourceDirty: Boolean(runGit(resolvedRoot, ["status", "--porcelain"])),
      artifactCreatedAt,
      artifactCreatedAtTimezone: "Asia/Taipei",
      candidateFilename: filename,
      sha256: sha256File(zipFile),
      fileCount: archiveValidation.fileCount,
      sourceManifestSha256: archiveValidation.sourceManifestSha256,
      deliveryLocation: formalRoot || resolvedOutput,
      temporaryOutput: resolvedOutput,
      regression,
      prePackagingGate: "PASS",
      postPackagingGate: "PASS",
      archiveIntegrity: archiveValidation.unzipTest,
      sourceZipConsistency: archiveValidation.sourceZip,
      artifactType: "candidate"
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    validateCandidate({ root: resolvedRoot, zipFile, manifestFile });

    let formalDelivery = null;
    if (formalRoot) {
      const formalZip = path.join(formalRoot, filename);
      const formalManifest = path.join(formalRoot, manifestFilename(filename));
      if (fs.existsSync(formalZip) || fs.existsSync(formalManifest)) {
        fail("FORMAL DELIVERY GATE = FAIL: target already exists; overwrite is forbidden", { formalZip, formalManifest });
      }
      fs.copyFileSync(zipFile, formalZip);
      fs.copyFileSync(manifestFile, formalManifest);
      validateCandidate({ root: resolvedRoot, zipFile: formalZip, manifestFile: formalManifest });
      formalDelivery = Object.freeze({
        status: "PASS",
        zipFile: formalZip,
        manifestFile: formalManifest,
        sha256: sha256File(formalZip)
      });
    }

    return Object.freeze({
      identity: preGate,
      zipFile,
      manifestFile,
      artifactCreatedAt,
      sha256: sha256File(zipFile),
      size: fs.statSync(zipFile).size,
      fileCount: archiveValidation.fileCount,
      prePackagingGate: "PASS",
      postPackagingGate: "PASS",
      temporaryOutput: resolvedOutput,
      formalDelivery
    });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--deliver") {
      options.deliver = true;
    } else if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    } else {
      fail(`Unexpected argument: ${token}`);
    }
  }
  return { command, options };
}

function printHelp() {
  console.log(`Usage:\n  node tools/release-governance.js package --description <slug> --regression-json '<json>' [--output-dir <dir>] [--deliver]\n  node tools/release-governance.js preflight\n\nThe root version.json.build is the only Build Identity source.\n`);
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (!command || command === "--help" || command === "help") {
    printHelp();
    return;
  }
  if (command === "preflight") {
    const snapshot = readIdentitySnapshot(options.root || PROJECT_ROOT);
    console.log(JSON.stringify(assertSourceIdentity(snapshot), null, 2));
    return;
  }
  if (command !== "package") fail(`Unknown command: ${command}`);
  if (!options.description) fail("package requires --description");
  let regression = {};
  if (options["regression-json"]) {
    try { regression = JSON.parse(options["regression-json"]); } catch (error) {
      fail("--regression-json is not valid JSON", { cause: error.message });
    }
  }
  assertRegressionEvidence(regression);
  const result = packageCandidate({
    root: options.root || PROJECT_ROOT,
    outputDir: options["output-dir"] || path.join(options.root || PROJECT_ROOT, "dist"),
    description: options.description,
    regression,
    deliver: Boolean(options.deliver),
    deliveryRoot: options["delivery-root"] || FORMAL_DELIVERY_ROOT
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    if (error instanceof ReleaseGovernanceError) {
      console.error(JSON.stringify({ status: "FAIL", message: error.message, details: error.details }, null, 2));
    } else {
      console.error(error.stack || error.message || String(error));
    }
    process.exitCode = 1;
  }
}

module.exports = {
  PROJECT_ROOT,
  FORMAL_DELIVERY_ROOT,
  ReleaseGovernanceError,
  collectFiles,
  readIdentitySnapshot,
  assertSourceIdentity,
  sourceManifest,
  sourceManifestDigest,
  candidateFilename,
  candidateFilenameParts,
  manifestFilename,
  assertRegressionEvidence,
  formatArtifactCreatedAt,
  validateArchive,
  validateCandidate,
  assertFormalDeliveryRoot,
  packageCandidate
};
