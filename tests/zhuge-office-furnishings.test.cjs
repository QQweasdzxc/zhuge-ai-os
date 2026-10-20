"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("P1 home entries remain attached to the native Habblaud office", () => {
  for (const file of ["index.html", "docs/index.html"]) {
    const html = read(file);
    assert.match(html, /pixel-office\/index\.html/);
    assert.match(html, /zhuge-office-furnishings\.js/);
    assert.match(html, /zhuge-office-furnishings\.css/);
    assert.match(html, /status-classic\.html/);
  }
});

test("floating medal wall is absent while original medal records and destinations remain available", () => {
  const js = read("assets/zhuge-office-furnishings.js");
  assert.match(js, /ZhugeOfficeAwards/);
  for (const id of ["taskflow", "worklog", "investment", "lab"]) assert.match(js, new RegExp(`id: "${id}"`));
  assert.match(js, /const works = Object\.freeze\(\[/);
  assert.match(js, /value:\s*works/);
  assert.doesNotMatch(js, /zgf-trophy-board|zgf-awards|zgf-medal/);
  assert.match(js, /https:\/\/zhuge-taskflow-web\.onrender\.com\//);
  for (const path of ["modules/worklog/", "modules/investment/", "modules/labs/"]) assert.ok(js.includes(path));
  assert.match(js, /dataset\.zgfPending = key/);
  assert.match(js, /TF-03 駕駛艙正式下載來源尚待驗證/);
  assert.match(js, /target = "_blank"/);
  assert.match(js, /rel = "noopener noreferrer"/);
  assert.doesNotMatch(js, /\/api\/(snapshot|stream)|innerHTML/);
});

test("quick links remain the only visible furnishing overlay and preserve native-modal priority", () => {
  const js = read("assets/zhuge-office-furnishings.js");
  const css = read("assets/zhuge-office-furnishings.css");
  assert.match(js, /zgf-rack/);
  assert.match(js, /zhuge-decision-panel/);
  assert.doesNotMatch(css, /zgf-awards|zgf-medal|trophy-board/);
  assert.match(css, /\.zgf-rack/);
  assert.match(css, /max-width:700px/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(js, /status\s*:\s*["']working["']/);
});

test("unverified destinations are explicitly pending and links use safe new-tab attributes", () => {
  const js = read("assets/zhuge-office-furnishings.js");
  assert.match(js, /AI 指揮艙正式連結待 PM 補充/);
  assert.match(js, /TF-03 駕駛艙正式下載來源尚待驗證/);
  assert.match(js, /noopener noreferrer/);
  assert.doesNotMatch(js, /status\s*:\s*["']working["']|正在開發中/);
});
