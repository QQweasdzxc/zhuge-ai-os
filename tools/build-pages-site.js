"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ROOT_FILES = new Set([
  ".nojekyll",
  "index.html",
  "version.json",
  "googlea760c88b64a73d97.html"
]);
const ROUTE_ROOTS = new Set([
  "app", "assets", "config", "contact", "google-data", "labs", "modules",
  "privacy", "product", "public", "scopes", "shared", "support", "terms"
]);
const EXCLUDED_RUNTIME_PATHS = [
  /^labs\/investment\/(?:docs|test|tests)(?:\/|$)/,
  /^labs\/taskflow\/(?:docs|overrides|patches|sql|tests)(?:\/|$)/,
  /^labs\/taskflow\/(?:Dockerfile(?:\..*)?|build-dev-(?:entry|shell)\.mjs|[^/]+\.md)$/
];

function isInRoot(candidate) {
  const relative = path.relative(ROOT, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPublishedPath(relative) {
  if (ROOT_FILES.has(relative)) return true;
  const top = relative.split("/")[0];
  if (!ROUTE_ROOTS.has(top)) return false;
  return !EXCLUDED_RUNTIME_PATHS.some(pattern => pattern.test(relative));
}

function trackedPaths() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function buildPagesSite(outputArg) {
  if (!outputArg) throw new Error("Usage: node tools/build-pages-site.js <empty-output-directory>");
  const output = path.resolve(outputArg);
  if (isInRoot(output)) throw new Error("Pages output must be outside the source tree");
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
    throw new Error("Pages output directory must be empty");
  }
  fs.mkdirSync(output, { recursive: true });

  const allTracked = trackedPaths();
  const selected = allTracked.filter(isPublishedPath);
  if (!selected.includes("index.html") || !selected.includes(".nojekyll")) {
    throw new Error("Required root Pages entry files are missing");
  }

  let totalBytes = 0;
  for (const relative of selected) {
    const basename = path.posix.basename(relative).toLowerCase();
    if (/^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|jwk))$/.test(basename)) {
      throw new Error("Sensitive-looking file cannot enter Pages artifact: " + relative);
    }
    const source = path.join(ROOT, relative);
    const destination = path.join(output, relative);
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile()) {
      throw new Error("Pages artifact only accepts tracked regular files: " + relative);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    totalBytes += metadata.size;
  }

  const result = {
    source: "git-tracked",
    includedFiles: selected.length,
    excludedTrackedFiles: allTracked.length - selected.length,
    uncompressedBytes: totalBytes
  };
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  try {
    buildPagesSite(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildPagesSite, isPublishedPath };
