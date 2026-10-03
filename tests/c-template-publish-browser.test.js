const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveBrowserExecutable, browserDOM } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "c-template-publish-browser.html");
const RELEASE_IDENTITY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "version.json"), "utf8"));

async function runBrowser(browserExecutable) {
  const output = await browserDOM(browserExecutable, FIXTURE, { ready: "#c-publish-audit" });
  const match = output.match(/<pre id="c-publish-audit">([^<]*)<\/pre>/);
  return JSON.parse(match[1]);
}

test("C publish UI sends the current identity and keeps legacy health check out of the Mother Template", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the C publish browser regression");

  const audit = await runBrowser(browserExecutable);
  assert.equal(audit.build, RELEASE_IDENTITY.build);
  assert.equal(audit.buttonBeforeClick, true);
  assert.equal(audit.buttonDisabledAfter, false);
  assert.equal(audit.publishCalls, 1);
  assert.deepEqual(audit.publishConsumerIds, ["c", "worktodo", "ai-board"]);
  assert.equal(audit.publishBuild, RELEASE_IDENTITY.build);
  assert.deepEqual(audit.adoptCalls, ["c:20260901-1550", `c:${RELEASE_IDENTITY.build}`]);
  assert.equal(audit.publishedBuild, RELEASE_IDENTITY.build);
  assert.match(audit.feedback, /Published C 已更新/);
  assert.equal(audit.healthEntry, false);
});
