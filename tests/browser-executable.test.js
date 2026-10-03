const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fixtureURL, fixturePath, browserDOM, resolveBrowserExecutable } = require("./browser-executable");

test("browser fixture transport serves canonical assets and explicit temp fixtures on loopback", async t => {
  const file = path.join(__dirname, "creator-mfa-control-browser.html");
  const url = await fixtureURL(file);
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(new URL(url).pathname, "/tests/creator-mfa-control-browser.html");
  assert.equal(await (await fetch(url)).text(), fs.readFileSync(file, "utf8"));
  const asset = path.resolve(__dirname, "../shared/theme/tokens.css");
  assert.equal(await (await fetch(new URL(fixturePath(asset), url))).text(), fs.readFileSync(asset, "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-http-fixture-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const temporary = path.join(dir, "page with space.html");
  fs.writeFileSync(temporary, "<p>fixture</p>");
  assert.equal(await (await fetch(await fixtureURL(temporary))).text(), "<p>fixture</p>");
  assert.equal((await fetch(new URL("/.git/HEAD", url))).status, 403);
  assert.equal((await fetch(new URL("/.env", url))).status, 403);
  assert.equal((await fetch(new URL("/missing-fixture.html", url))).status, 404);
  assert.throws(() => fixturePath(path.join(os.tmpdir(), "outside.js")), /inside the repository/);
});

test("browser DOM waits for completed audit and closes Chromium on a failed navigation", async t => {
  const executable = resolveBrowserExecutable();
  if (!executable) return t.skip("Browser executable required for cleanup proof");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-dom-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "audit.html");
  fs.writeFileSync(file, '<script>setTimeout(() => {document.body.dataset.audit="complete"}, 80)</script>');
  assert.match(await browserDOM(executable, file, { ready: '[data-audit="complete"]' }), /data-audit="complete"/);
  // Invalid selectors fail immediately; finally must close the launched browser.
  await assert.rejects(browserDOM(executable, file, { ready: "[" }), /selector/i);
});
