"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const site = path.resolve(process.argv[2] || "");
assert.ok(process.argv[2], "pass the generated Pages site directory as the first argument");

function localFile(urlValue, fromFile = "index.html") {
  const base = new URL(fromFile, "https://qqweasdzxc.github.io/zhuge-ai-os/");
  const url = new URL(urlValue.replaceAll("&amp;", "&"), base);
  if (url.origin !== "https://qqweasdzxc.github.io") return null;
  const prefix = "/zhuge-ai-os/";
  if (!url.pathname.startsWith(prefix)) return null;
  let relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const direct = path.join(site, relative);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const directoryIndex = path.join(site, relative, "index.html");
  if (fs.existsSync(directoryIndex) && fs.statSync(directoryIndex).isFile()) return directoryIndex;
  return direct;
}

function assertLocalReferencesResolve(document, fromFile) {
  const baseHref = document.match(/<base\\s+href=["']([^"']+)["']/i)?.[1];
  const effectiveSource = baseHref
    ? new URL(baseHref, new URL(fromFile, "https://qqweasdzxc.github.io/zhuge-ai-os/")).href
    : fromFile;
  const refs = [...document.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(value => !/^(?:#|data:|mailto:|tel:|javascript:)/i.test(value));
  for (const ref of refs) {
    const resolved = localFile(ref, effectiveSource);
    if (resolved) assert.ok(fs.existsSync(resolved), fromFile + " references missing Pages file: " + ref);
  }
}

function htmlFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(full, relative));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(relative);
  }
  return files;
}

test("curated Pages publishes Pixel homepage and retained authenticated TaskFlow classic route", () => {
  const required = [
    "index.html", "version.json", ".nojekyll", "googlea760c88b64a73d97.html",
    "labs/taskflow/index.html", "labs/taskflow/runtime-config.js", "labs/taskflow/cli-sso.js",
    "modules/worklog/index.html", "modules/investment/index.html", "app/dashboard/index.html",
    "app/Board/ai/index.html", "app/Board/worktodo/index.html",
    "app/Board/procurement/index.html", "app/Board/template-preview/index.html",
    "shared/config/version.js", "shared/auth/app-access-gate.js",
    "pixel-office/index.html", "pixel-office/LICENSE.txt", "status-classic.html",
    "docs/index.html", "docs/status-classic.html", "status/project-status.json",
    "docs/status/project-status.json", "docs/pixel-office/index.html"
  ];
  for (const relative of required) {
    assert.ok(fs.existsSync(path.join(site, relative)), "missing live route/resource: " + relative);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(site, "version.json"), "utf8"));
  assert.equal(typeof manifest.version, "string");
  assert.ok(manifest.version.length > 0, "version.json must declare a release version");
  assert.equal(typeof manifest.build, "string");
  assert.ok(manifest.build.length > 0, "version.json must declare a build identity");

  const home = fs.readFileSync(path.join(site, "index.html"), "utf8");
  assert.match(home, /pixel-office\/index\.html/);
  assert.match(home, /<iframe\b/i);
  assert.match(home, /status-classic\.html/);
  const classic = fs.readFileSync(path.join(site, "status-classic.html"), "utf8");
  assert.match(classic, /id=["']taskflow-home-routing["']/);
  assert.match(classic, /id=["']tf-issues["']/);
  assert.match(classic, /src=["']labs\/taskflow\/pages-client\/app\.mjs/);
  assert.match(classic, /href=["']modules\/worklog\//);
  assert.doesNotMatch(classic, /window\.location\.replace\("https:\/\/zhuge-taskflow-web\.onrender\.com\/"\)/);
  const docsHome = fs.readFileSync(path.join(site, "docs/index.html"), "utf8");
  assert.match(docsHome, /pixel-office\/index\.html/);
  assert.match(docsHome, /status-classic\.html/);
  assertLocalReferencesResolve(classic, "status-classic.html");
  for (const relative of ["labs/taskflow/pages-client/taskflow-api.mjs","labs/taskflow/pages-client/app.mjs","labs/taskflow/pages-client/app.css","labs/taskflow/pages-client/login-return.mjs"]) {
    assert.ok(fs.existsSync(path.join(site, relative)), "native Pages TaskFlow resource missing: " + relative);
  }
  assert.ok(home.includes("Version " + manifest.version + " · Build " + manifest.build), "homepage Version and Build must match version.json");
  assertLocalReferencesResolve(home, "index.html");

  const taskflow = fs.readFileSync(path.join(site, "labs/taskflow/index.html"), "utf8");
  assertLocalReferencesResolve(taskflow, "labs/taskflow/index.html");
  const worklog = fs.readFileSync(path.join(site, "modules/worklog/index.html"), "utf8");
  assertLocalReferencesResolve(worklog, "modules/worklog/index.html");
  for (const relative of htmlFiles(site)) {
    assertLocalReferencesResolve(fs.readFileSync(path.join(site, relative), "utf8"), relative);
  }
});

test("Pages payload omits non-site repository content and stays within the size guard", () => {
  const forbidden = ["third_party", "tests", "supabase", "backlog", "tools", ".github"];
  for (const relative of forbidden) {
    assert.equal(fs.existsSync(path.join(site, relative)), false, "non-site content leaked into Pages: " + relative);
  }
  for (const relative of [
    "labs/taskflow/Dockerfile.web", "labs/taskflow/overrides", "labs/taskflow/patches",
    "labs/taskflow/sql", "labs/taskflow/tests", "labs/investment/docs", "labs/investment/test"
  ]) {
    assert.equal(fs.existsSync(path.join(site, relative)), false, "build/test-only content leaked into Pages: " + relative);
  }
  let bytes = 0;
  let files = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  visit(site);
  assert.ok(files > 100, "unexpectedly small Pages payload: " + files + " files");
  assert.ok(bytes < 25_000_000, "Pages payload is unexpectedly large: " + bytes + " bytes");
});
