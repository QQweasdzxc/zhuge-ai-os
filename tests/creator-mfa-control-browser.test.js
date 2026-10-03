const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveBrowserExecutable, browserDOM } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "creator-mfa-control-browser.html");

async function runBrowser(browserExecutable, query) {
  const output = await browserDOM(browserExecutable, FIXTURE, { ready: '#creator-mfa-audit', query: `?${query}`, width: 1440, height: 900 });
  return output;
}

test("Creator sees both independent MFA controls and Non-Creator sees none", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the Creator MFA browser regression");

  const creatorOutput = await runBrowser(browserExecutable, "creator=true");
  assert.match(creatorOutput, /"creator":true/);
  assert.match(creatorOutput, /"tab":true/);
  assert.match(creatorOutput, /"section":true/);
  assert.match(creatorOutput, /進入 Investment 時要求二次驗證/);
  assert.match(creatorOutput, /修改重要投資資料時要求二次驗證/);
  assert.match(creatorOutput, /進入 AI Board 時要求二次驗證/);
  assert.match(creatorOutput, /⚪ 已關閉/);
  assert.match(creatorOutput, /🟢 已開啟/);
  assert.match(creatorOutput, /"localStorageKeys":\[\]/);
  assert.match(creatorOutput, /"sessionStorageKeys":\[\]/);

  const nonCreatorOutput = await runBrowser(browserExecutable, "creator=false");
  assert.match(nonCreatorOutput, /"creator":false/);
  assert.match(nonCreatorOutput, /"tab":false/);
  assert.match(nonCreatorOutput, /"section":false/);
  assert.doesNotMatch(nonCreatorOutput, /進入 Investment 時要求二次驗證/);
  assert.doesNotMatch(nonCreatorOutput, /進入 AI Board 時要求二次驗證/);
});
