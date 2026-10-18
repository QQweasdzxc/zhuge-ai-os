#!/usr/bin/env node
// Single-use P1 Pixel Furnishings review Build preparation.
// Read-only Published C identity must remain untouched.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const previousVersion = "0.9.0-alpha.9.74";
const nextVersion = "0.9.0-alpha.9.75";
const identityPath = path.join(root, "version.json");
const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
function run(...args) { return execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" }); }
if (identity.version === nextVersion) {
  run("tools/release-governance.js", "preflight");
  console.log("P1_FURNISHINGS_RELEASE_ALREADY_PREPARED");
  process.exit(0);
}
if (identity.version !== previousVersion || identity.build !== "20261018-1135") {
  throw new Error("Release identity moved since P1 branch base; manual review required");
}
// Generate a formally approved Taipei-time Build BEFORE changing the working tree.
const nextBuild = JSON.parse(run("tools/release-governance.js", "new-build-id")).build;
if (!/^202\d{5}-\d{4}$/.test(nextBuild)) throw new Error("Invalid approved Build");
function edit(relative, find, replace) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(find)) throw new Error("Expected release token missing: " + relative + " [" + find + "]");
  fs.writeFileSync(file, source.replace(find, replace), "utf8");
}
for (const file of [
  "version.json", "modules/worklog/version.json",
  "modules/investment/version.json", "labs/investment/version.json"
]) edit(file, '"version": "' + previousVersion + '"', '"version": "' + nextVersion + '"');
edit("shared/app-config.js", 'const VERSION = "' + previousVersion + '"', 'const VERSION = "' + nextVersion + '"');
edit("shared/config/version.js", 'version: "' + previousVersion + '"', 'version: "' + nextVersion + '"');
edit("shared/config/template-release.js", '"developmentVersion": "' + previousVersion + '"', '"developmentVersion": "' + nextVersion + '"');
edit("app/dashboard/index.html", 'name="application-version" content="' + previousVersion + '"', 'name="application-version" content="' + nextVersion + '"');
edit("app/dashboard/zhuge-dashboard.js", '? VERSION : "' + previousVersion + '"', '? VERSION : "' + nextVersion + '"');
for (const file of ["index.html", "docs/index.html"]) {
  edit(file, "Version " + previousVersion + " · Build ", "Version " + nextVersion + " · Build ");
}
// Canonical governance source of truth changes all root/module runtimes and cache busters.
run("tools/release-governance.js", "sync-build", "--build", nextBuild);
// The static docs copy is not in the canonical runtime scan; align its identity too.
for (const file of ["docs/index.html", "status-classic.html", "docs/status-classic.html"]) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, "utf8");
  fs.writeFileSync(full, before.replaceAll("20261018-1135", nextBuild), "utf8");
}
const newIdentity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
if (newIdentity.version !== nextVersion || newIdentity.build !== nextBuild) throw new Error("New version identity mismatch");
run("tools/release-governance.js", "preflight");
console.log(JSON.stringify({ result: "P1_FURNISHINGS_PREPARED", version: nextVersion, build: nextBuild, publishedC: "UNCHANGED" }));
