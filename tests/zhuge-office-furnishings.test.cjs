"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const root = require("node:path").resolve(__dirname, "..");
const read = file => fs.readFileSync(require("node:path").join(root, file), "utf8");
test("P1 furniture is an overlay on original Habblaud; root/docs use correct relative paths", () => {
  for (const p of ["index.html", "docs/index.html"]) {
    const s = read(p);
    assert.match(s, /pixel-office\/index\.html/);
    assert.match(s, /zhuge-office-furnishings\.js/);
    assert.match(s, /zhuge-office-furnishings\.css/);
    assert.match(s, /status-classic\.html/);
  }
  assert.match(read("index.html"), /src="\.\/assets\/zhuge-office-furnishings\.js"/);
  assert.match(read("docs/index.html"), /src="\.\.\/assets\/zhuge-office-furnishings\.js"/);
});
test("P1 works point to real published locations, placeholders cannot fake links", () => {
  const s = read("assets/zhuge-office-furnishings.js");
  assert.ok(s.includes('new URL("labs/taskflow/", siteRoot)'));
  for (const path of ["modules/worklog/", "modules/investment/", "modules/labs/"]) assert.ok(s.includes(path));
  assert.match(s, /dataset\.zgfPending = key/);
  assert.match(s, /furniture\("會議室", "會", "AI 指揮艙連結待補", null, "cockpit"\)/);
  assert.match(s, /TF-03.*?下載來源尚待驗證/);
  assert.match(s, /target = "_blank"/);
  assert.match(s, /rel = "noopener noreferrer"/);
  assert.doesNotMatch(s, /\/api\/(snapshot|stream)/);
  assert.doesNotMatch(s, /innerHTML/);
});
test("P1 does not alter original canvas or fabricate current agent status", () => {
  const c = read("assets/zhuge-office-furnishings.css");
  assert.match(c, /\.zgf-root/);
  assert.match(c, /pointer-events:none/);
  assert.match(c, /max-width:700px/);
  assert.match(c, /focus-visible/);
  assert.doesNotMatch(read("assets/zhuge-office-furnishings.js"), /status\s*:\s*["']working["']/);
});
test("P2 meeting room control is only an honest pending entry; the outside door illustration is removed", () => {
  const s = read("assets/zhuge-office-furnishings.js");
  assert.match(s, /furniture\("會議室", "會", "AI 指揮艙連結待補", null, "cockpit"\)/);
  assert.match(s, /接待區內已設置獨立會議室/);
  assert.doesNotMatch(s, /zgf-door-art|zgf-door-sign|class", "zgf-meeting/);
  const css = read("assets/zhuge-office-furnishings.css");
  assert.doesNotMatch(css, /\.zgf-meeting|\.zgf-door-art/);
});
