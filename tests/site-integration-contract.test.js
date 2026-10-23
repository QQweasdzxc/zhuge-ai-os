const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helper = require("../labs/taskflow/taskflow-post-login.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
function store() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test("Pixel Office login return is fixed-origin, one-use, and waits for auth/access/runtime", () => {
  const storage = store();
  const login = new URL("https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=dashboard&officeReturn=1&returnTo=https://evil.invalid");
  assert.equal(helper.capture(login, storage, 1000), true);
  const navigations = [];
  const location = { href: login.href, replace: value => navigations.push(value) };
  assert.equal(helper.complete({ authenticated: true, accessApproved: false, runtimeReady: true, storage, location, now: 1001 }), false);
  assert.equal(helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, storage, location, now: 1002 }), true);
  assert.deepEqual(navigations, ["https://qqweasdzxc.github.io/zhuge-ai-os/"]);
  assert.equal(helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, storage, location, now: 1003 }), false);
});

test("TaskFlow and Investment login intents return to their fixed same-site routes", () => {
  const cases = [
    ["?taskflowReturn=1", "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/"],
    ["?investmentReturn=1", "https://qqweasdzxc.github.io/zhuge-ai-os/modules/investment/"]
  ];
  for (const [search, expected] of cases) {
    const storage = store();
    const login = new URL(`https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/${search}`);
    assert.equal(helper.capture(login, storage, 2000), true);
    const navigations = [];
    const location = { href: login.href, replace: value => navigations.push(value) };
    assert.equal(helper.complete({ authenticated: false, accessApproved: true, runtimeReady: true, storage, location, now: 2001 }), false);
    assert.equal(helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, storage, location, now: 2002 }), true);
    assert.deepEqual(navigations, [expected]);
  }
});

test("Investment preserves its login destination and a direct Pixel Office return", () => {
  const source = read("modules/investment/services/investment-module.js");
  assert.ok(source.includes('INVESTMENT_LOGIN_HREF = "../worklog/?app=1&workspace=dashboard&investmentReturn=1"'));
  assert.ok(source.includes('href="${global.InvestmentSafeHtml.escape(INVESTMENT_LOGIN_HREF)}"'));
  assert.ok(source.includes("loginHref: INVESTMENT_LOGIN_HREF"));
  assert.ok(source.includes('PIXEL_OFFICE_ACTION = \'<a class="btn2 investment-office-return" href="../../" aria-label="返回 Pixel Office"'));
  assert.ok(source.includes("actionMarkup: PIXEL_OFFICE_ACTION"));
  assert.ok(source.includes("${PIXEL_OFFICE_ACTION}<button class=\"btn\" type=\"button\" data-investment-refresh"));
  assert.match(source, /context\.security\.evaluate\("view"\)/);
  assert.match(source, /requireAppAccess\(root, context\)/);
});

test("Investment navigation requires verified Creator authority and retains WorkLog child placement", () => {
  const navSource = read("shared/components/zhuge-navigation.js");
  assert.match(navSource, /const isCreator = creatorCapability === true/);
  assert.match(navSource, /registry\.investment\.visible = isCreator/);
  assert.match(navSource, /const campIds = \["taskflow", "worklog", "tasks-new", "procurement", \.\.\.worklogConsumers, "investment"\]/);
});

test("return intents reject unknown, expired, and unapproved requests", () => {
  const storage = store();
  const location = { href: "https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/", replace() { throw new Error("must not navigate"); } };
  assert.equal(helper.capture({ search: "?returnTo=https://evil.invalid" }, storage, 3000), false);
  storage.setItem(helper.storageKey, JSON.stringify({ intent: "https://evil.invalid", expiresAt: 9000 }));
  assert.equal(helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, storage, location, now: 3001 }), false);
  assert.equal(helper.capture({ search: "?investmentReturn=1" }, storage, 4000), true);
  assert.equal(helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, storage, location, now: 4000 + 10 * 60 * 1000 }), false);
});
