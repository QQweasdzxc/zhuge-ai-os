const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const officeSource = fs.readFileSync(path.join(__dirname, "../labs/pixel-office-3d/index.html"), "utf8");
const office3dSource = fs.readFileSync(path.join(__dirname, "../labs/pixel-office-3d/office3d.js"), "utf8");

test("pixel office toolbar has no 經典報表 / 開啟 TF text links", () => {
  assert.ok(!officeSource.includes('id="classicLink"'), "classicLink top text link must be removed");
  assert.ok(!officeSource.includes('id="tfLink"'), "tfLink top text link must be removed");
});

test("wall TF entry routes through the page hook, never a new tab", () => {
  assert.ok(office3dSource.includes('hoverKey==="tf-wall"'), "wall hit handler missing");
  assert.ok(office3dSource.includes("window.zhugeOpenTfBoard"), "wall handler must call the page hook");
  assert.ok(!office3dSource.includes('window.open(document.getElementById("tfLink")'), "wall handler must not open a new tab");
});

const hookMatch = officeSource.match(/window\.zhugeOpenTfBoard = \(\(\) => \{([\s\S]*?)\n\}\)\(\);/);
assert.ok(hookMatch, "zhugeOpenTfBoard hook must exist in the office page");

function runHook({ session, apiReply }) {
  const navigations = [];
  const fetches = [];
  const banner = { textContent: "", hidden: true };
  const sandbox = {
    PAGE_QUERY: new URLSearchParams(""),
    URL, URLSearchParams, AbortSignal, JSON, Promise, encodeURIComponent,
    localStorage: { getItem: (k) => (session ? JSON.stringify({ access_token: session }) : null) },
    document: { getElementById: (id) => (id === "srcBanner" ? banner : null) },
    fetch: async (url, opts) => {
      fetches.push({ url, opts });
      return apiReply;
    },
  };
  sandbox.window = sandbox;
  sandbox.window.top = { location: { assign: (u) => navigations.push(u) } };
  vm.createContext(sandbox);
  vm.runInContext("window.zhugeOpenTfBoard = (() => {" + hookMatch[1] + "\n})();", sandbox, { timeout: 1000 });
  return { sandbox, navigations, fetches, banner };
}

test("wall entry without a stored session falls back to the landing (login) page, same tab", async () => {
  const { sandbox, navigations, fetches } = runHook({ session: null });
  await sandbox.window.zhugeOpenTfBoard();
  assert.deepEqual(fetches, []);
  assert.deepEqual(navigations, ["https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/"]);
});

test("wall entry with a session exchanges once and navigates straight to the board (invisible intake), same tab", async () => {
  const apiReply = { ok: true, json: async () => ({ token: "JWT123" }) };
  const { sandbox, navigations, fetches } = runHook({ session: "SUPA", apiReply });
  await sandbox.window.zhugeOpenTfBoard();
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, "https://zhuge-taskflow-api.onrender.com/auth/zhuge");
  assert.equal(fetches[0].opts.method, "POST");
  assert.equal(fetches[0].opts.body, JSON.stringify({ access_token: "SUPA" }));
  assert.equal(navigations.length, 1);
  const target = new URL(navigations[0]);
  assert.equal(target.origin + target.pathname, "https://zhuge-taskflow-web.onrender.com/zhuge-lab-ac5afcc7/issues");
  const hash = new URLSearchParams(target.hash.replace(/^#/, ""));
  assert.equal(hash.get("zhuge_token"), "JWT123");
  assert.equal(hash.get("zhuge_dest"), null);
});

test("wall entry falls back to the landing page when the exchange fails", async () => {
  const apiReply = { ok: false, status: 401, json: async () => ({}) };
  const { sandbox, navigations } = runHook({ session: "SUPA", apiReply });
  await sandbox.window.zhugeOpenTfBoard();
  assert.deepEqual(navigations, ["https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/"]);
});
