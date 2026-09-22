const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("WorkLog description has one 50-character limit in config, UI, live counter, and validation", () => {
  const config = fs.readFileSync(path.join(ROOT, "shared", "app-config.js"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "modules", "worklog", "worklog-app.js"), "utf8");

  assert.match(config, /WORKLOG_DESCRIPTION_MAX_LENGTH\s*=\s*50/);
  assert.match(source, /maxlength="\$\{WORKLOG_DESCRIPTION_MAX_LENGTH\}"/);
  assert.match(source, /id="titleCount"/);
  assert.match(source, /worklogDescriptionLength\(item\.title\)\s*>\s*WORKLOG_DESCRIPTION_MAX_LENGTH/);
  assert.match(source, /Array\.from\(String\(value \|\| ""\)\)\.length/);
});

test("Dashboard account presentation uses name and email without displaying UUID", () => {
  const source = fs.readFileSync(path.join(ROOT, "app", "dashboard", "zhuge-dashboard.js"), "utf8");

  assert.match(source, /identity\.name/);
  assert.match(source, /identity\.email/);
  assert.match(source, /data-root-account-toggle/);
  assert.match(source, /Google 帳號/);
  assert.match(source, /data-logout/);
  assert.doesNotMatch(source, /identity\.(?:userId|uuid)|使用者 UUID/);
});
