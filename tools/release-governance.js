#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ARTIFACT_TYPES = Object.freeze({ candidate: "Candidate", review: "Review", "qa-backup": "QA-Backup" });
const RUNTIME_SCAN_ROOTS = ["index.html", "app", "modules", "shared"];
const RUNTIME_EXTENSIONS = new Set([".html", ".js", ".css"]);
const FORBIDDEN_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules", ".cache", "cache", "tmp", "temp", "browser-profile", "playwright-report", "test-results"]);
const FORBIDDEN_FILE_NAMES = new Set([".DS_Store"]);
const FORBIDDEN_FILE_EXTENSIONS = new Set([".crt", ".jwk", ".key", ".pem", ".p12"]);
const BUILD_PATTERN = /^202\d{5}-\d{4}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
const CACHE_BUSTER_PATTERN = /\?v=(202\d{5}-\d{4})\b/g;
const PUBLISHED_SNAPSHOT_LOADER_PATTERN = /template-release\.js\?v=(202\d{5}-\d{4})\b/g;
const RUNTIME_BUILD_ID_PATTERN = /\b(?:BUILD_ID|BUILD_TIME|phase1CacheVersion)\s*=\s*["'](202\d{5}-\d{4})["']/g;
const PUBLISHED_CONSUMER_IDS = ["c", "ai-board", "worktodo", "worklog-procurement", "investment-ivtk"];

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
  if (/^tests\/\.ai-board-batch-2-browser-\d+\.html$/.test(relative)) return true;
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

function readTemplateReleaseRecord(root) {
  const source = readText(root, "shared/config/template-release.js");
  const match = source.match(/const RELEASE = Object\.freeze\((\{[\s\S]*?\})\);/);
  if (!match) {
    fail("C release identity is missing from shared/config/template-release.js", {
      file: "shared/config/template-release.js"
    });
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail("C release identity JSON is invalid in shared/config/template-release.js", {
      file: "shared/config/template-release.js",
      cause: error.message
    });
  }
}

function readPublishedCIdentity(root) {
  const release = readTemplateReleaseRecord(root);

  return {
    templateId: String(release.templateId || ""),
    templateVersion: String(release.templateVersion || ""),
    buildAlias: String(release.build || ""),
    version: String(release.publishedVersion || ""),
    build: String(release.publishedBuild || ""),
    sourceCommit: String(release.sourceCommit || ""),
    sourceFingerprint: String(release.sourceFingerprint || ""),
    publishedAt: String(release.publishedAt || ""),
    snapshot: release.publishedSnapshot ? {
      version: String(release.publishedSnapshot.version || ""),
      build: String(release.publishedSnapshot.build || ""),
      sourceCommit: String(release.publishedSnapshot.sourceCommit || ""),
      sourceFingerprint: String(release.publishedSnapshot.sourceFingerprint || "")
    } : null,
    consumers: JSON.parse(JSON.stringify(release.consumers || {}))
  };
}

function readDevelopmentCIdentity(root) {
  const release = readTemplateReleaseRecord(root);
  return {
    version: String(release.developmentVersion || ""),
    build: String(release.developmentBuild || "")
  };
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
  const publishedSnapshotLoaders = [];
  const runtimeBuildIdentityLiterals = [];
  for (const relative of collectFiles(resolvedRoot).filter(isRuntimeFile)) {
    const source = readText(resolvedRoot, relative);
    const publishedLoaderOffsets = new Set(
      [...source.matchAll(PUBLISHED_SNAPSHOT_LOADER_PATTERN)]
        .map(match => match.index + match[0].indexOf("?v="))
    );
    for (const match of source.matchAll(CACHE_BUSTER_PATTERN)) {
      const item = { file: relative, build: match[1] };
      if (publishedLoaderOffsets.has(match.index)) publishedSnapshotLoaders.push(item);
      else cacheBusters.push(item);
    }
    for (const match of source.matchAll(RUNTIME_BUILD_ID_PATTERN)) {
      runtimeBuildIdentityLiterals.push({ file: relative, build: match[1], field: match[0].split(/\s*=/, 1)[0].trim() });
    }
  }

  return {
    root: resolvedRoot,
    product: String(rootManifest.module || "Zhuge AI OS"),
    version: String(rootManifest.version || ""),
    build: String(rootManifest.build || ""),
    rootManifest,
    modules,
    developmentCIdentity: readDevelopmentCIdentity(resolvedRoot),
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
    publishedCIdentity: readPublishedCIdentity(resolvedRoot),
    cacheBusters,
    publishedSnapshotLoaders,
    runtimeBuildIdentityLiterals
  };
}

function publishedIdentityMismatches(identity) {
  const mismatches = [];
  if (!identity) return ["Published C identity is missing"];
  if (identity.templateId !== "c") mismatches.push(`template-release templateId=${identity.templateId} != c`);
  if (!VERSION_PATTERN.test(identity.version)) mismatches.push(`invalid Published C version: ${identity.version}`);
  if (!BUILD_PATTERN.test(identity.build)) mismatches.push(`invalid Published C build: ${identity.build}`);
  if (!/^[0-9a-f]{40}$/i.test(identity.sourceCommit)) mismatches.push("Published C sourceCommit is missing or invalid");
  if (!/^[0-9a-f]{64}$/i.test(identity.sourceFingerprint)) mismatches.push("Published C sourceFingerprint is missing or invalid");
  if (!identity.publishedAt || Number.isNaN(Date.parse(identity.publishedAt))) mismatches.push("Published C publishedAt is missing or invalid");
  if (identity.templateVersion !== identity.version) mismatches.push("templateVersion does not match publishedVersion");
  if (identity.buildAlias !== identity.build) mismatches.push("build alias does not match publishedBuild");

  const snapshot = identity.snapshot;
  if (!snapshot) {
    mismatches.push("Published C semantic snapshot identity is missing");
  } else {
    for (const [field, actual, expected] of [
      ["version", snapshot.version, identity.version],
      ["build", snapshot.build, identity.build],
      ["sourceCommit", snapshot.sourceCommit, identity.sourceCommit],
      ["sourceFingerprint", snapshot.sourceFingerprint, identity.sourceFingerprint]
    ]) {
      if (actual !== expected) mismatches.push(`publishedSnapshot.${field}=${actual} != Published C ${field}=${expected}`);
    }
  }

  if (!identity.consumers || typeof identity.consumers !== "object") {
    mismatches.push("Published C Consumer Adoption evidence is missing");
    return mismatches;
  }
  for (const consumerId of PUBLISHED_CONSUMER_IDS) {
    const adoption = identity.consumers[consumerId];
    if (!adoption) {
      mismatches.push(`Published C adoption ${consumerId} is missing`);
      continue;
    }
    if (adoption.templateVersion !== identity.version) mismatches.push(`${consumerId} adoption version differs from Published C`);
    if (adoption.build !== identity.build) mismatches.push(`${consumerId} adoption build differs from Published C`);
    if (adoption.sourceCommit !== identity.sourceCommit) mismatches.push(`${consumerId} adoption sourceCommit differs from Published C`);
    if (adoption.sourceFingerprint !== identity.sourceFingerprint) mismatches.push(`${consumerId} adoption sourceFingerprint differs from Published C`);
    if (typeof adoption.status !== "string" || !adoption.status.trim()) mismatches.push(`${consumerId} adoption status is missing`);
  }
  return mismatches;
}

function assertSourceIdentity(snapshot) {
  const mismatches = [];
  const { build, version } = snapshot;
  if (!VERSION_PATTERN.test(version)) mismatches.push(`invalid root version: ${version}`);
  if (!BUILD_PATTERN.test(build)) mismatches.push(`invalid root build: ${build}`);
  if (snapshot.developmentCIdentity.version !== version) {
    mismatches.push(`template-release developmentVersion=${snapshot.developmentCIdentity.version} != Candidate version ${version}`);
  }
  if (snapshot.developmentCIdentity.build !== build) {
    mismatches.push(`template-release developmentBuild=${snapshot.developmentCIdentity.build} != Candidate BUILD_ID ${build}`);
  }

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
  for (const item of snapshot.runtimeBuildIdentityLiterals) {
    if (item.build !== build) mismatches.push(`${item.file} ${item.field}=${item.build} != ${build}`);
  }
  if (!snapshot.publishedSnapshotLoaders.length) mismatches.push("no Published C snapshot loader was found");
  for (const item of snapshot.publishedSnapshotLoaders) {
    if (item.build !== snapshot.publishedCIdentity.build) {
      mismatches.push(`${item.file} template-release.js loader=${item.build} != Published C build ${snapshot.publishedCIdentity.build}`);
    }
  }
  mismatches.push(...publishedIdentityMismatches(snapshot.publishedCIdentity));

  if (mismatches.length) {
    fail("PRE-PACKAGING GATE = FAIL: Candidate / Published Identity mismatch", {
      candidate: { build, version },
      publishedC: snapshot.publishedCIdentity,
      mismatches
    });
  }

  return Object.freeze({
    status: "PASS",
    build,
    version,
    developmentCIdentity: snapshot.developmentCIdentity,
    publishedCIdentity: snapshot.publishedCIdentity,
    moduleFiles: snapshot.modules.map(module => module.file),
    cacheBusterCount: snapshot.cacheBusters.length,
    publishedSnapshotLoaderCount: snapshot.publishedSnapshotLoaders.length,
    runtimeBuildIdentityLiteralCount: snapshot.runtimeBuildIdentityLiterals.length
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

function assertWorkingTreeClean(root = PROJECT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const commit = runGit(resolvedRoot, ["rev-parse", "HEAD"]);
  if (!commit) {
    fail("PACKAGING GATE = FAIL: Git HEAD is unavailable.", { root: resolvedRoot });
  }
  const status = runGit(resolvedRoot, ["status", "--porcelain"]);
  if (status === null) {
    fail("PACKAGING GATE = FAIL: Git working tree status is unavailable.", { root: resolvedRoot });
  }
  if (status) {
    fail("PACKAGING GATE = FAIL: Working Tree must be clean before packaging.", {
      root: resolvedRoot,
      status
    });
  }
  return Object.freeze({ status: "PASS", commit, workingTree: "clean" });
}

function commitSourceManifest(root = PROJECT_ROOT) {
  const { commit } = assertWorkingTreeClean(root);
  const records = execFileSync("git", ["ls-tree", "-rz", commit], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
  const files = [];
  const exclusions = [];
  for (const record of records) {
    const separator = record.indexOf("\t");
    const [mode, type, blob] = record.slice(0, separator).split(" ");
    const relative = record.slice(separator + 1);
    if (isForbiddenRelativePath(relative)) {
      exclusions.push({ path: relative, reason: "Excluded by canonical secret/runtime-artifact packaging policy" });
      continue;
    }
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      fail("Unsupported tracked source entry; exact blob packaging required", { path: relative, mode, type });
    }
    const content = fs.readFileSync(path.join(root, relative));
    const blobHash = crypto.createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
    if (blobHash !== blob) fail("Working source differs from Git commit blob", { path: relative, commit });
    files.push({ path: relative, bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") });
  }
  files.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  return { commit, parentCommit: runGit(root, ["rev-parse", `${commit}^`]), files, exclusions };
}

function eligibleGitSource(root, commit) {
  const records = execFileSync("git", ["ls-tree", "-rz", commit], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
  return new Map(records.map(record => {
    const separator = record.indexOf("\t");
    return [record.slice(separator + 1), record.slice(0, separator)];
  }).filter(([relative]) => !isForbiddenRelativePath(relative)));
}

function materialBuildEvidence(root, commit, baselineCommit) {
  if (!/^[0-9a-f]{40}$/i.test(commit || "") || !/^[0-9a-f]{40}$/i.test(baselineCommit || "")) {
    fail("BUILD_BASELINE_UNAVAILABLE: valid Git Source/baseline commits are required");
  }
  try { execFileSync("git", ["merge-base", "--is-ancestor", baselineCommit, commit], { cwd: root, stdio: "ignore" }); }
  catch { fail("BUILD_BASELINE_DIVERGED: formal baseline must be an ancestor of Source"); }
  let baselineIdentity, identity;
  try {
    baselineIdentity = JSON.parse(execFileSync("git", ["show", `${baselineCommit}:version.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    identity = JSON.parse(execFileSync("git", ["show", `${commit}:version.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch { fail("BUILD_BASELINE_UNAVAILABLE: formal Source/Build identity cannot be read"); }
  if (!BUILD_PATTERN.test(baselineIdentity.build || "") || !BUILD_PATTERN.test(identity.build || "")) {
    fail("BUILD_BASELINE_UNAVAILABLE: Source/formal Build is invalid");
  }
  const previous = eligibleGitSource(root, baselineCommit);
  const current = eligibleGitSource(root, commit);
  const changedFiles = [...new Set([...previous.keys(), ...current.keys()])]
    .filter(relative => previous.get(relative) !== current.get(relative)).sort();
  if (changedFiles.length && identity.build === baselineIdentity.build) {
    fail("BUILD_IDENTITY_STALE: material Source changed without a new Formal Build", {
      code: "BUILD_IDENTITY_STALE", baselineCommit, sourceCommit: commit,
      previousBuild: baselineIdentity.build, currentBuild: identity.build, changedFiles
    });
  }
  return Object.freeze({ status: "PASS", baselineCommit, sourceCommit: commit,
    previousBuild: baselineIdentity.build, currentBuild: identity.build,
    materialSourceChanged: changedFiles.length > 0, changedFiles });
}

function assertMaterialBuildIdentity(root = PROJECT_ROOT) {
  const { commit } = assertWorkingTreeClean(root);
  // GitHub main is the existing formal Source Authority. No caller-controlled
  // baseline, artifact location or nearest work commit may replace it.
  const baselineCommit = runGit(root, ["rev-parse", "--verify", "origin/main^{commit}"]);
  if (!baselineCommit) fail("BUILD_BASELINE_UNAVAILABLE: fetch origin/main before release preflight or packaging");
  return materialBuildEvidence(root, commit, baselineCommit);
}

function synchronizeBuildIdentity({ root = PROJECT_ROOT, build } = {}) {
  const snapshot = readIdentitySnapshot(root);
  assertSourceIdentity(snapshot);
  if (!BUILD_PATTERN.test(build || "") || build === snapshot.build) {
    fail("A new Formal Build requires a different valid BUILD_ID", { previousBuild: snapshot.build, build });
  }
  const updates = new Map();
  const update = (relative, transform) => {
    const before = updates.get(relative)?.after ?? readText(root, relative);
    const after = transform(before);
    if (!updates.has(relative)) updates.set(relative, { before, after });
    else updates.get(relative).after = after;
  };
  for (const relative of ["version.json", ...snapshot.modules.map(item => item.file)]) {
    update(relative, source => source.replace(/("build"\s*:\s*")[^"]+("+)/, `$1${build}$2`));
  }
  update("shared/config/version.js", source => source.replace(/(\bbuild\s*:\s*["'])[^"]+?(["'])/, `$1${build}$2`));
  update("shared/config/template-release.js", source => source.replace(/("developmentBuild"\s*:\s*")[^"]+("+)/, `$1${build}$2`));
  update("index.html", source => source.replace(/(Version\s+[^<·]+?\s*·\s*Build\s+)202\d{5}-\d{4}/, `$1${build}`));
  update("app/dashboard/zhuge-dashboard.js", source => source.replace(/(const\s+build\s*=\s*typeof\s+BUILD_TIME\s*!==\s*["']undefined["']\s*\?\s*BUILD_TIME\s*:\s*["'])202\d{5}-\d{4}(["'])/, `$1${build}$2`));
  const runtimeFiles = new Set([...snapshot.cacheBusters, ...snapshot.runtimeBuildIdentityLiterals].map(item => item.file));
  for (const relative of runtimeFiles) {
    update(relative, source => {
      const protectedOffsets = new Set([...source.matchAll(PUBLISHED_SNAPSHOT_LOADER_PATTERN)]
        .map(match => match.index + match[0].indexOf("?v=")));
      return source.replace(CACHE_BUSTER_PATTERN, (match, oldBuild, offset) => protectedOffsets.has(offset) ? match : `?v=${build}`)
        .replace(RUNTIME_BUILD_ID_PATTERN, (match, oldBuild) => match.replace(oldBuild, build));
    });
  }
  const written = [];
  try {
    for (const [relative, { before, after }] of updates) {
      if (readText(root, relative) !== before) fail("Build synchronization source changed concurrently", { file: relative });
      if (before !== after) { fs.writeFileSync(path.join(root, relative), after); written.push(relative); }
    }
    const afterSnapshot = readIdentitySnapshot(root);
    const gate = assertSourceIdentity(afterSnapshot);
    if (gate.build !== build || JSON.stringify(snapshot.publishedCIdentity) !== JSON.stringify(afterSnapshot.publishedCIdentity)) {
      fail("Build synchronization must preserve Published C identity and match the new Build");
    }
    return { status: "PASS", previousBuild: snapshot.build, build, changedFiles: written, publishedCIdentityPreserved: true };
  } catch (error) {
    for (const relative of written) fs.writeFileSync(path.join(root, relative), updates.get(relative).before);
    throw error;
  }
}

function artifactTaipeiParts(date = new Date()) {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    fail("Invalid Artifact Created At", { artifactCreatedAt: date });
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(parsedDate).map(part => [part.type, part.value]));
  return parts;
}

function formatArtifactCreatedAt(date = new Date()) {
  const parts = artifactTaipeiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function buildIdFromTaipeiDate(date = new Date()) {
  const parts = artifactTaipeiParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

function generateNewBuildId({ now = new Date(), previousBuild = null } = {}) {
  const build = buildIdFromTaipeiDate(now);
  if (previousBuild && build === String(previousBuild)) {
    fail("New Formal Build must use a new BUILD_ID; generated value matches the previous BUILD_ID.", {
      previousBuild: String(previousBuild),
      generatedBuild: build,
      timezone: "Asia/Taipei"
    });
  }
  return build;
}

function formatArtifactFilenameTimestamp(date = new Date()) {
  const parts = artifactTaipeiParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

function assertArtifactScope(scope, formalTaskIdentity = []) {
  const cleanScope = String(scope || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(cleanScope)) {
    fail("Artifact scope must contain only ASCII letters, numbers, and hyphens.", { scope });
  }
  for (const code of cleanScope.match(/TASK-\d+/gi) || []) {
    const row = formalTaskIdentity.find(item => item.workCode === code);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!row || row.authority !== "engineering-transition.inspect" || row.pmVisible !== true
      || !uuid.test(row.taskId || "") || !uuid.test(row.boardInstanceId || "")
      || !row.verifiedAt || Number.isNaN(Date.parse(row.verifiedAt))) {
      fail("Unverified formal TASK ID in artifact scope; use a descriptive scope.", { task: code });
    }
  }
  return cleanScope;
}

function verifyFormalTaskIds(scope, root = PROJECT_ROOT) {
  const codes = [...new Set(String(scope || "").match(/TASK-\d+/gi) || [])];
  if (!codes.length) return [];
  // Reuse the protected read-only authority; never trust a local Backlog or a
  // caller's --verified flag. This command cannot allocate or mutate a TASK.
  return codes.map(code => {
    let row;
    try {
      const output = execFileSync(process.execPath,
        [path.join(root, "tools/engineering-transition.js"), "inspect", "--task", code],
        { cwd: root, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
      row = JSON.parse(output).task;
    } catch {
      fail("Formal TASK readback unavailable; use a descriptive scope.", { task: code });
    }
    const evidence = { authority: "engineering-transition.inspect", workCode: row?.work_code,
      taskId: row?.id, boardInstanceId: row?.board_instance_id, pmVisible: true,
      verifiedAt: formatArtifactCreatedAt() };
    assertArtifactScope(code, [evidence]);
    return evidence;
  });
}

function artifactFilename({ artifactType = "candidate", build, version, scope, artifactCreatedAt, formalTaskIdentity = [] }) {
  if (!ARTIFACT_TYPES[artifactType]) fail("Unsupported artifact type", { artifactType });
  if (!BUILD_PATTERN.test(build)) fail(`Invalid Runtime Build ID for artifact: ${build}`);
  if (!VERSION_PATTERN.test(version)) fail(`Invalid Version for artifact filename: ${version}`);
  const cleanScope = assertArtifactScope(scope, formalTaskIdentity);
  if (artifactType !== "candidate" && !artifactCreatedAt) fail("Artifact Created At is required for Review / QA Backup naming");
  const prefix = artifactType === "candidate" ? build : formatArtifactFilenameTimestamp(artifactCreatedAt);
  return `${prefix}_Zhuge_AI_OS-v${version}-${cleanScope}-FullSource-${ARTIFACT_TYPES[artifactType]}.zip`;
}

function candidateFilename({ build, version, description, formalTaskIdentity = [] }) {
  return artifactFilename({ artifactType: "candidate", build, version, scope: description, formalTaskIdentity });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateFilenameParts(filename, { version, build }) {
  const pattern = new RegExp(
    `^${escapeRegExp(build)}_Zhuge_AI_OS-v${escapeRegExp(version)}-([A-Za-z0-9][A-Za-z0-9-]*)-FullSource-Candidate\\.zip$`
  );
  return path.basename(filename).match(pattern);
}

function manifestFilename(zipFilename) {
  return `${zipFilename}.manifest.json`;
}

function assertRegressionEvidence(regression) {
  for (const field of ["governance", "checklist", "full", "gitDiffCheck", "browser"]) {
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
    if (JSON.stringify(extractedGate.publishedCIdentity) !== JSON.stringify(expectedIdentity.publishedCIdentity)) {
      fail("POST-PACKAGING GATE = FAIL: Published C identity differs between Source and ZIP", {
        source: expectedIdentity.publishedCIdentity,
        archive: extractedGate.publishedCIdentity
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
  if (!String(deliveryRoot || "").trim()) fail("Explicit artifact destination is required");
  const resolved = path.resolve(deliveryRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail("FORMAL DELIVERY GATE = FAIL: destination is unavailable", { deliveryRoot: resolved });
  }
  return resolved;
}

function validateManifest(manifest, zipFile, identity, archiveValidation, expectedGitBaselineCommit = null, expectedParentCommit = null) {
  const expectedFilename = path.basename(zipFile);
  const mismatches = [];
  if (manifest.build !== identity.build) mismatches.push(`manifest.build=${manifest.build} != ${identity.build}`);
  if (manifest.version !== identity.version) mismatches.push(`manifest.version=${manifest.version} != ${identity.version}`);
  if (!manifest.publishedCIdentity) mismatches.push("manifest.publishedCIdentity is missing");
  else {
    for (const field of ["version", "build", "sourceCommit", "sourceFingerprint", "publishedAt"]) {
      if (manifest.publishedCIdentity[field] !== identity.publishedCIdentity[field]) {
        mismatches.push(`manifest.publishedCIdentity.${field} differs from Published C Source identity`);
      }
    }
    if (JSON.stringify(manifest.publishedCIdentity) !== JSON.stringify(identity.publishedCIdentity)) {
      mismatches.push("manifest.publishedCIdentity snapshot / adoption differs from Published C Source identity");
    }
  }
  const gitSha = /^[0-9a-f]{40}$/i;
  if (!gitSha.test(manifest.SOURCE_SHA || "") || manifest.SOURCE_SHA !== manifest.gitBaselineCommit) mismatches.push("manifest SOURCE_SHA is missing or inconsistent");
  if (!gitSha.test(manifest.PARENT_SHA || "") || manifest.PARENT_SHA !== manifest.parentCommit) mismatches.push("manifest PARENT_SHA is missing or inconsistent");
  if (expectedGitBaselineCommit && manifest.gitBaselineCommit !== expectedGitBaselineCommit) {
    mismatches.push(`manifest.gitBaselineCommit=${manifest.gitBaselineCommit} != ${expectedGitBaselineCommit}`);
  }
  if (expectedParentCommit && manifest.PARENT_SHA !== expectedParentCommit) mismatches.push("manifest PARENT_SHA differs from source parent");
  if (manifest.filename !== expectedFilename) mismatches.push("manifest filename differs from ZIP filename");
  if (manifest.artifactType === "candidate" && manifest.candidateFilename !== expectedFilename) mismatches.push("manifest candidateFilename differs from ZIP filename");
  if (manifest.artifactType === "candidate" && manifest.candidateBuild !== identity.build) mismatches.push("manifest Candidate Build differs from source Build");
  if (manifest.artifactType !== "candidate" && Object.hasOwn(manifest, "candidateBuild")) mismatches.push("Backup must not claim Candidate Build");
  if (manifest.sha256 !== sha256File(zipFile)) mismatches.push("manifest SHA-256 differs from ZIP");
  if (manifest.fileCount !== archiveValidation.fileCount) mismatches.push("manifest fileCount differs from ZIP");
  if (manifest.sourceManifestSha256 !== archiveValidation.sourceManifestSha256) mismatches.push("manifest Source manifest digest differs");
  if (!Array.isArray(manifest.files) || sourceManifestDigest(manifest.files) !== manifest.sourceManifestSha256) mismatches.push("manifest file hashes differ from source digest");
  if (manifest.prePackagingGate !== "PASS") mismatches.push("manifest prePackagingGate is not PASS");
  if (manifest.postPackagingGate !== "PASS") mismatches.push("manifest postPackagingGate is not PASS");
  if (manifest.artifactCreatedAtTimezone !== "Asia/Taipei") mismatches.push("manifest artifactCreatedAtTimezone must be Asia/Taipei");
  if (!manifest.artifactCreatedAt || !/\+08:00$/.test(manifest.artifactCreatedAt)) mismatches.push("manifest Artifact Created At must be Asia/Taipei timestamp");
  try {
    const generated = artifactFilename({ artifactType: manifest.artifactType, version: identity.version, build: identity.build,
      scope: manifest.scope, artifactCreatedAt: manifest.artifactCreatedAt, formalTaskIdentity: manifest.formalTaskIdentity });
    if (generated !== expectedFilename) mismatches.push("ZIP filename BUILD_ID/Version contract mismatch or Artifact Created At naming mismatch");
  } catch (error) { mismatches.push(error.message); }
  if (mismatches.length) fail("POST-PACKAGING GATE = FAIL: Candidate Manifest mismatch / Artifact Manifest mismatch", { mismatches });
  assertRegressionEvidence(manifest.regression);
  return Object.freeze({ status: "PASS", manifest: manifestFilename(expectedFilename) });
}

function validateArtifact({ root = PROJECT_ROOT, zipFile, manifestFile }) {
  const resolvedRoot = path.resolve(root);
  const tracked = commitSourceManifest(resolvedRoot);
  const preGate = assertSourceIdentity(readIdentitySnapshot(resolvedRoot));
  const buildIdentityGate = assertMaterialBuildIdentity(resolvedRoot);
  if (path.resolve(manifestFile) !== path.resolve(manifestFilename(zipFile))) fail("Manifest filename must match complete ZIP basename");
  if (!fs.existsSync(manifestFile)) fail("POST-PACKAGING GATE = FAIL: Artifact Manifest is missing", { manifestFile });
  const manifest = readJson(path.dirname(manifestFile), path.basename(manifestFile));
  // Reverify immutable cut-time evidence against Git, while still applying the
  // live main gate above. Promotion can advance main without rewriting a ZIP.
  const recordedBaseline = manifest.buildIdentityGate?.baselineCommit;
  const recordedGate = materialBuildEvidence(resolvedRoot, tracked.commit, recordedBaseline);
  try { execFileSync("git", ["merge-base", "--is-ancestor", recordedBaseline, buildIdentityGate.baselineCommit], { cwd: resolvedRoot, stdio: "ignore" }); }
  catch { fail("Manifest Build baseline is not in formal main history"); }
  if (JSON.stringify(manifest.buildIdentityGate) !== JSON.stringify(recordedGate)) {
    fail("Manifest Build identity gate differs from formal Git baseline");
  }
  const verifiedTasks = verifyFormalTaskIds(manifest.scope, resolvedRoot);
  const identityFields = rows => (rows || []).map(({ workCode, taskId, boardInstanceId, authority, pmVisible }) =>
    ({ workCode, taskId, boardInstanceId, authority, pmVisible }));
  if (JSON.stringify(identityFields(manifest.formalTaskIdentity)) !== JSON.stringify(identityFields(verifiedTasks))) {
    fail("Manifest formal TASK identity differs from protected Board readback");
  }
  const expectedName = artifactFilename({ artifactType: manifest.artifactType, build: preGate.build, version: preGate.version,
    scope: manifest.scope, artifactCreatedAt: manifest.artifactCreatedAt, formalTaskIdentity: manifest.formalTaskIdentity });
  if (path.basename(zipFile) !== expectedName) fail("POST-PACKAGING GATE = FAIL: ZIP filename BUILD_ID/Version contract mismatch or Artifact Created At naming mismatch", { expected: expectedName, actual: path.basename(zipFile) });
  const archiveValidation = validateArchive(resolvedRoot, zipFile, tracked.files, preGate);
  const manifestValidation = validateManifest(manifest, zipFile, preGate, archiveValidation, tracked.commit, tracked.parentCommit);
  if (JSON.stringify(manifest.exclusions) !== JSON.stringify(tracked.exclusions)) fail("Manifest source exclusions differ from tracked policy");
  const sha256FilePath = `${zipFile}.sha256`;
  if (!fs.existsSync(sha256FilePath)) fail("SHA256 sidecar is missing", { sha256File: sha256FilePath });
  const expectedChecksum = `${sha256File(zipFile)}  ${path.basename(zipFile)}\n`;
  if (fs.readFileSync(sha256FilePath, "utf8") !== expectedChecksum) fail("SHA256 sidecar hash / filename mismatch");
  return Object.freeze({ prePackagingGate: preGate,
    postPackagingGate: { ...archiveValidation, ...manifestValidation, sha256Sidecar: "PASS", gitBlobConsistency: "PASS", buildIdentityGate } });
}

function validateCandidate(options) {
  // Compatibility entry point on the same engine; no second packager.
  const manifest = readJson(path.dirname(options.manifestFile), path.basename(options.manifestFile));
  if (manifest.artifactType !== "candidate") fail("Candidate validator requires Candidate artifact");
  return validateArtifact(options);
}

function candidatePairPaths(deliveryRoot, zipFilename) {
  if (!String(deliveryRoot || "").trim()) fail("Explicit artifact destination is required");
  const resolvedDeliveryRoot = path.resolve(deliveryRoot);
  const normalizedFilename = String(zipFilename || "");
  if (path.basename(normalizedFilename) !== normalizedFilename
    || !/^202\d{5}-\d{4}_Zhuge_AI_OS-v[0-9A-Za-z.-]+-[A-Za-z0-9][A-Za-z0-9-]*-FullSource-(?:Candidate|Review|QA-Backup)\.zip$/.test(normalizedFilename)) {
    fail("FORMAL DELIVERY GATE = FAIL: invalid Artifact filename / timestamp prefix", { zipFilename });
  }
  return Object.freeze({ deliveryRoot: resolvedDeliveryRoot, zipFile: path.join(resolvedDeliveryRoot, normalizedFilename),
    manifestFile: path.join(resolvedDeliveryRoot, manifestFilename(normalizedFilename)), sha256File: path.join(resolvedDeliveryRoot, `${normalizedFilename}.sha256`) });
}

function validateCandidatePairAtRoot({ root = PROJECT_ROOT, deliveryRoot, zipFilename } = {}) {
  const pair = candidatePairPaths(deliveryRoot, zipFilename);
  const missing = [];
  if (!fs.existsSync(pair.zipFile)) missing.push("Candidate ZIP");
  if (!fs.existsSync(pair.manifestFile)) missing.push("Candidate Manifest");
  if (!fs.existsSync(pair.sha256File)) missing.push("SHA256 sidecar");
  if (missing.length) fail("FORMAL DELIVERY GATE = FAIL: Candidate delivery pair incomplete / Artifact set incomplete", { ...pair, missing });
  const validation = validateArtifact({ root, zipFile: pair.zipFile, manifestFile: pair.manifestFile });
  return Object.freeze({ status: "PASS", ...pair, validation });
}

function verifyFormalDeliveryPair({ root = PROJECT_ROOT, deliveryRoot, zipFilename } = {}) {
  return validateCandidatePairAtRoot({ root, deliveryRoot: assertFormalDeliveryRoot(deliveryRoot), zipFilename });
}

function copyCandidatePair({ sourceZip, sourceManifest, sourceSha256 = `${sourceZip}.sha256`, deliveryRoot, zipFilename } = {}) {
  const pair = candidatePairPaths(deliveryRoot, zipFilename);
  const targets = [pair.zipFile, pair.manifestFile, pair.sha256File];
  if (targets.some(file => fs.existsSync(file))) fail("FORMAL DELIVERY GATE = FAIL: target already exists; overwrite is forbidden", pair);
  const created = [];
  try {
    fs.mkdirSync(pair.deliveryRoot, { recursive: true });
    for (const [source, target] of [[sourceZip, pair.zipFile], [sourceManifest, pair.manifestFile], [sourceSha256, pair.sha256File]]) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      created.push(target);
    }
    return Object.freeze({ ...pair, created });
  } catch (error) {
    for (const file of created.reverse()) fs.rmSync(file, { force: true });
    fail("FORMAL DELIVERY GATE = FAIL: paired delivery write failed", { ...pair, cause: error.message });
  }
}

function removeCreatedPair(pair) {
  for (const file of [...(pair?.created || [])].reverse()) fs.rmSync(file, { force: true });
}

function packageArtifact({ root = PROJECT_ROOT, outputDir = path.join(root, "dist"), scope, description,
  artifactType = "candidate", regression = {}, deliver = false, deliveryRoot, createdAt = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputDir);
  const tracked = commitSourceManifest(resolvedRoot);
  if (!/^[0-9a-f]{40}$/i.test(tracked.parentCommit || "")) fail("FullSource requires a Git Parent SHA");
  assertRegressionEvidence(regression);
  const snapshot = readIdentitySnapshot(resolvedRoot);
  const preGate = assertSourceIdentity(snapshot);
  const buildIdentityGate = assertMaterialBuildIdentity(resolvedRoot);
  if (!ARTIFACT_TYPES[artifactType]) fail("Unsupported artifact type", { artifactType });
  const artifactScope = scope || description;
  const formalTaskIdentity = verifyFormalTaskIds(artifactScope, resolvedRoot);
  assertArtifactScope(artifactScope, formalTaskIdentity);
  if (deliver && !String(deliveryRoot || "").trim()) fail("--deliver requires explicit --delivery-root");
  const sourceStageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-artifact-source-stage-"));
  const artifactStageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-artifact-stage-"));
  try {
    copySource(resolvedRoot, sourceStageRoot, tracked.files.map(item => item.path));
    const rawZip = path.join(artifactStageRoot, "source.zip");
    execFileSync("zip", ["-qr", rawZip, "."], { cwd: sourceStageRoot, stdio: ["ignore", "pipe", "pipe"] });
    // Capture after ZIP creation. Test-only createdAt override is not a CLI option.
    const artifactCreatedAt = formatArtifactCreatedAt(createdAt || new Date());
    const filename = artifactFilename({ artifactType, build: preGate.build, version: preGate.version,
      scope: artifactScope, artifactCreatedAt, formalTaskIdentity });
    const staged = candidatePairPaths(artifactStageRoot, filename);
    fs.renameSync(rawZip, staged.zipFile);
    const archiveValidation = validateArchive(resolvedRoot, staged.zipFile, tracked.files, preGate);
    const manifest = { schemaVersion: 2, product: snapshot.product, version: preGate.version, build: preGate.build,
      artifactType, scope: artifactScope, filename, buildIdentityGate, SOURCE_SHA: tracked.commit, PARENT_SHA: tracked.parentCommit,
      gitBaselineCommit: tracked.commit, parentCommit: tracked.parentCommit, formalTaskIdentity,
      publishedCIdentity: preGate.publishedCIdentity, sourceRoot: resolvedRoot, sourceDirty: false,
      artifactCreatedAt, artifactCreatedAtTimezone: "Asia/Taipei", sha256: sha256File(staged.zipFile),
      fileCount: archiveValidation.fileCount, sourceManifestSha256: archiveValidation.sourceManifestSha256,
      files: tracked.files, exclusions: tracked.exclusions, deliveryLocation: deliver ? path.resolve(deliveryRoot) : resolvedOutput,
      regression, prePackagingGate: "PASS", postPackagingGate: "PASS",
      archiveIntegrity: archiveValidation.unzipTest, sourceZipConsistency: archiveValidation.sourceZip };
    if (artifactType === "candidate") { manifest.candidateBuild = preGate.build; manifest.candidateFilename = filename; }
    fs.writeFileSync(staged.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(staged.sha256File, `${manifest.sha256}  ${filename}\n`);
    validateArtifact({ root: resolvedRoot, zipFile: staged.zipFile, manifestFile: staged.manifestFile });
    const output = copyCandidatePair({ sourceZip: staged.zipFile, sourceManifest: staged.manifestFile,
      sourceSha256: staged.sha256File, deliveryRoot: resolvedOutput, zipFilename: filename });
    let formalDelivery = null;
    try {
      validateArtifact({ root: resolvedRoot, zipFile: output.zipFile, manifestFile: output.manifestFile });
      if (deliver) {
        const formal = copyCandidatePair({ sourceZip: output.zipFile, sourceManifest: output.manifestFile,
          sourceSha256: output.sha256File, deliveryRoot, zipFilename: filename });
        try { formalDelivery = verifyFormalDeliveryPair({ root: resolvedRoot, deliveryRoot, zipFilename: filename }); }
        catch (error) { removeCreatedPair(formal); throw error; }
      }
    } catch (error) { removeCreatedPair(output); throw error; }
    return Object.freeze({ identity: preGate, artifactType, ...output, SOURCE_SHA: tracked.commit, PARENT_SHA: tracked.parentCommit,
      artifactCreatedAt, sha256: manifest.sha256, size: fs.statSync(output.zipFile).size, fileCount: manifest.fileCount,
      prePackagingGate: "PASS", postPackagingGate: "PASS", formalDelivery });
  } finally {
    fs.rmSync(sourceStageRoot, { recursive: true, force: true });
    fs.rmSync(artifactStageRoot, { recursive: true, force: true });
  }
}

function packageCandidate(options = {}) {
  return packageArtifact({ ...options, artifactType: "candidate" });
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
  console.log(`Usage:\n  node tools/release-governance.js new-build-id\n  node tools/release-governance.js sync-build --build <approved-new-build>\n  node tools/release-governance.js package --type <candidate|review|qa-backup> --description <scope> --regression-json '<json>' [--output-dir <dir>] [--deliver --delivery-root <dir>]\n  node tools/release-governance.js preflight\n\nThe root version.json.build is the only Build Identity source.\n`);
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (!command || command === "--help" || command === "help") {
    printHelp();
    return;
  }
  if (command === "preflight") {
    const root = options.root || PROJECT_ROOT;
    const workingTree = assertWorkingTreeClean(root);
    const snapshot = readIdentitySnapshot(root);
    console.log(JSON.stringify({ ...assertSourceIdentity(snapshot), workingTree, buildIdentityGate: assertMaterialBuildIdentity(root) }, null, 2));
    return;
  }
  if (command === "new-build-id") {
    const root = options.root || PROJECT_ROOT;
    const workingTree = assertWorkingTreeClean(root);
    const snapshot = readIdentitySnapshot(root);
    const previousBuild = options["previous-build"] || snapshot.build;
    const build = generateNewBuildId({ previousBuild });
    console.log(JSON.stringify({ status: "PASS", timezone: "Asia/Taipei", build, previousBuild, workingTree }, null, 2));
    return;
  }
  if (command === "sync-build") {
    console.log(JSON.stringify(synchronizeBuildIdentity({ root: options.root || PROJECT_ROOT, build: options.build }), null, 2));
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
  const result = packageArtifact({
    root: options.root || PROJECT_ROOT,
    outputDir: options["output-dir"] || path.join(options.root || PROJECT_ROOT, "dist"),
    description: options.description,
    artifactType: options.type || "candidate",
    regression,
    deliver: Boolean(options.deliver),
    deliveryRoot: options["delivery-root"]
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
  candidatePairPaths,
  ARTIFACT_TYPES,
  artifactFilename,
  assertArtifactScope,
  assertMaterialBuildIdentity,
  synchronizeBuildIdentity,
  verifyFormalTaskIds,
  commitSourceManifest,
  packageArtifact,
  validateArtifact,
  ReleaseGovernanceError,
  collectFiles,
  readIdentitySnapshot,
  assertSourceIdentity,
  sourceManifest,
  sourceManifestDigest,
  candidateFilename,
  candidateFilenameParts,
  buildIdFromTaipeiDate,
  generateNewBuildId,
  formatArtifactFilenameTimestamp,
  manifestFilename,
  validateManifest,
  assertRegressionEvidence,
  formatArtifactCreatedAt,
  validateArchive,
  validateCandidate,
  validateCandidatePairAtRoot,
  verifyFormalDeliveryPair,
  copyCandidatePair,
  assertFormalDeliveryRoot,
  assertWorkingTreeClean,
  packageCandidate
};
