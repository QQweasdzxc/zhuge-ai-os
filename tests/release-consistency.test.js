const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const json = file => JSON.parse(read(file));

test("Sprint 3 release identity is consistent across product and module manifests", () => {
  const root = json("version.json");
  const worklog = json("modules/worklog/version.json");
  const investment = json("modules/investment/version.json");

  assert.equal(root.version, "0.9.0-alpha.9.12");
  assert.equal(root.build, "20260810-2246");
  assert.equal(worklog.version, root.version);
  assert.equal(worklog.build, root.build);
  assert.equal(investment.version, root.version);
  assert.equal(investment.build, root.build);
  assert.equal(investment.dataMode, "cloud");

  for (const file of ["shared/app-config.js", "shared/config/version.js", "app/dashboard/index.html", "index.html"]) {
    const source = read(file);
    assert.equal(source.includes(root.version), true, `${file} is missing ${root.version}`);
    assert.equal(source.includes(root.build), true, `${file} is missing ${root.build}`);
  }
});
