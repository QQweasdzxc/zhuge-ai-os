"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dir = path.join(__dirname, "..", "docs", "zg71", "live-compat");
const read = name => fs.readFileSync(path.join(dir, name), "utf8");
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const sums = Object.fromEntries(read("SHA256SUMS").trim().split("\n").map(line => { const [h, n] = line.trim().split(/\s+/); return [n, h]; }));
const cases = [
  ["zhuge-skyeye-read", [
    /^import \{ requireAppAccess \} from "\.\.\/_shared\/app-access\.ts";$/,
    /^\s*await requireAppAccess\(request\);$/,
    /^\s*if \(\(error as \{code\?: string\}\)\?\.code\?\.startsWith\("APP_ACCESS"\)/
  ]],
  ["workspace-email-notification", [
    /^import \{ requireAppAccess \} from "\.\.\/_shared\/app-access\.ts";$/,
    /^\s*try \{ await requireAppAccess\(request\); \} catch \(e\) \{ return json\(\{ code: "APP_ACCESS_REQUIRED"/,
    /^$/
  ]]
];
for (const [name, allowed] of cases) {
  test(`${name}: files match recorded hashes`, () => {
    for (const kind of ["live", "gated"]) assert.equal(sha(read(`${name}.${kind}.ts`)), sums[`${name}.${kind}.ts`]);
  });
  test(`${name}: gated is live plus only the gate lines`, () => {
    const live = read(`${name}.live.ts`).split("\n"), gated = read(`${name}.gated.ts`).split("\n");
    const added = []; let i = 0;
    for (const line of gated) {
      if (i < live.length && line === live[i]) { i++; continue; }
      added.push(line);
    }
    assert.equal(i, live.length, "every live line stays, in order");
    assert.equal(added.length, allowed.length);
    allowed.forEach((re, n) => assert.match(added[n], re));
  });
  test(`${name}: gate runs before body use and fails closed`, () => {
    const gated = read(`${name}.gated.ts`);
    assert.equal((gated.match(/requireAppAccess\(request\)/g) || []).length, 1);
    assert.ok(gated.indexOf("requireAppAccess(request)") < gated.indexOf("request.json()"));
    assert.ok(/APP_ACCESS_REQUIRED/.test(gated));
  });
}
test("shared gate source matches the deployed hash prefix", () => {
  const shared = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "_shared", "app-access.ts"), "utf8");
  assert.ok(sha(shared).startsWith("67f1457dfd11201c"));
});
