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
  const refs = [...document.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(value => !/^(?:#|data:|mailto:|tel:|javascript:)/i.test(value));
  for (const ref of refs) {
    const resolved = localFile(ref, fromFile);
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

test("curated Pages payload restores the prior home behavior, Apps routes, and .9.43 release identity", () => {
  const required = [
    "index.html", "version.json", ".nojekyll", "googlea760c88b64a73d97.html",
    "labs/taskflow/index.html", "labs/taskflow/runtime-config.js", "labs/taskflow/cli-sso.js",
    "modules/worklog/index.html", "modules/investment/index.html", "app/dashboard/index.html",
    "app/Board/ai/index.html", "app/Board/worktodo/index.html",
    "app/Board/procurement/index.html", "app/Board/template-preview/index.html",
    "shared/config/version.js", "shared/auth/app-access-gate.js"
  ];
  for (const relative of required) {
    assert.ok(fs.existsSync(path.join(site, relative)), "missing live route/resource: " + relative);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(site, "version.json"), "utf8"));
  assert.equal(manifest.version, "0.9.0-alpha.9.43");
  assert.equal(manifest.build, "20261015-0612");

  const home = fs.readFileSync(path.join(site, "index.html"), "utf8");
  assert.doesNotMatch(home, /href=["']labs\/taskflow\//);
  assert.match(home, /href=["']modules\/worklog\//);
  assert.match(home, new RegExp("Version 0\\.9\\.0-alpha\\.9\\.42 · Build " + manifest.build));
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
  const forbidden = ["third_party", "docs", "tests", "supabase", "backlog", "tools", ".github"];
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
