const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const script = source.match(/<script id="taskflow-home-routing">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Public homepage must contain the canonical route controller");

const HOME = "https://qqweasdzxc.github.io/zhuge-ai-os/";
function navigate(query = "", {session = false, tokenInStorage = false} = {}) {
  const replacements = [];
  const storageReads = [];
  const window = {
    location: {
      href: HOME + query,
      replace(destination) { replacements.push(destination); },
    },
    localStorage: {
      getItem(key) {
        storageReads.push(key);
        if (session && key === "zhuge_ai_os_session_v1") return "{stale}";
        if (tokenInStorage && key === "zhuge_ai_os_google_auth_session_v1") return "{token}";
        return null;
      },
    },
  };
  vm.runInNewContext(script, {window, URL, Set}, {timeout: 1000});
  return {replacements,storageReads};
}

test("canonical public homepage never auto-redirects when no browser session exists", () => {
  assert.deepEqual(navigate().replacements, []);
  assert.deepEqual(navigate("?utm_source=bookmark").replacements, []);
});

test("canonical public homepage stays on home with old OR valid browser session", () => {
  for (const storage of [{session:true},{tokenInStorage:true}]) {
    const result = navigate("", storage);
    assert.deepEqual(result.replacements, []);
    assert.deepEqual(result.storageReads, [], "homepage routing must not inspect private session storage");
  }
});

test("only explicit AI OS navigation routes to WorkLog and retains safe workspace", () => {
  assert.deepEqual(navigate("?app=1&workspace=dashboard").replacements, [
    HOME + "modules/worklog/?app=1&workspace=dashboard"
  ]);
  assert.deepEqual(navigate("?workspace=library").replacements, [
    HOME + "modules/worklog/?app=1&workspace=library"
  ]);
  assert.deepEqual(navigate("?templateView=navigation").replacements, [
    HOME + "modules/worklog/?app=1&templateView=navigation"
  ]);
});

test("unknown navigation values cannot cause an unsolicited redirect", () => {
  assert.deepEqual(navigate("?workspace=evil&templateView=other").replacements, []);
});

test("Google OAuth callbacks are not consumed or redirected by the homepage", () => {
  for (const query of ["?code=abc&state=xyz", "?error=access_denied", "#access_token=example", "#refresh_token=r&access_token=a"]) {
    assert.deepEqual(navigate(query, {session:true}).replacements, [], query);
  }
});

test("homepage brand opens the homepage, and both action links remain explicit", () => {
  assert.match(source, /<a class="brand" href="\.\/" aria-label="Zhuge AI OS 首頁">/);
  assert.match(source, /<a class="button primary" href="labs\/taskflow\/">Open TaskFlow<\/a>/);
  assert.match(source, /<a class="button secondary" href="modules\/worklog\/\?app=1&amp;workspace=dashboard">Open AI OS<\/a>/);
  assert.match(source, /<link rel="canonical" href="https:\/\/qqweasdzxc\.github\.io\/zhuge-ai-os\/">/);
});
