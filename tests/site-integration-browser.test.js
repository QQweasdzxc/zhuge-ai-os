const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { fixtureURL, resolveBrowserExecutable } = require("./browser-executable");
const root = path.resolve(__dirname, "..");

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 }
]) {
  test(`Pixel Office, login return, and Creator navigation at ${viewport.width}x${viewport.height}`, async t => {
    const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/pixel-office/index.html", route => route.fulfill({ contentType: "text/html", body: "<main>SCENE_FIXTURE_ONLY</main>" }));
    await page.goto(await fixtureURL(path.join(root, "index.html")));

    const rack = page.locator(".zgf-rack");
    await rack.waitFor();
    assert.equal(await page.locator("#zgf-trophy-board").count(), 1, "navigation candidate preserves the existing award wall");
    const origin = new URL(page.url()).origin;
    for (const [id, pathPart] of [["taskflow", "/labs/taskflow/"], ["apps", "/labs/taskflow/"], ["worklog", "/modules/worklog/"], ["investment", "/modules/investment/"]]) {
      assert.equal(await rack.locator(`[data-zgf-work=${id}]`).getAttribute("href"), origin + pathPart);
    }
    const login = rack.locator('[data-zgf-work="login"]');
    const loginUrl = new URL(await login.getAttribute("href"));
    assert.equal(loginUrl.searchParams.get("officeReturn"), "1");
    assert.equal(await login.getAttribute("target"), null, "login stays in the current browsing context");
    for (const link of await rack.locator("a").all()) {
      const box = await link.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify(box));
      assert.equal(new URL(await link.getAttribute("href")).origin, origin);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.addScriptTag({ path: path.join(root, "labs/taskflow/taskflow-post-login.js") });
    const result = await page.evaluate(({ loginHref }) => {
      const helper = window.ZhugeTaskFlowPostLogin;
      const values = new Map();
      const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
      helper.capture(new URL(loginHref), storage, 1000);
      const navigations = [];
      const location = { href: loginHref, replace: href => navigations.push(href) };
      const denied = helper.complete({ authenticated: true, accessApproved: false, runtimeReady: true, location, storage, now: 1001 });
      const approved = helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, location, storage, now: 1002 });
      const replay = helper.complete({ authenticated: true, accessApproved: true, runtimeReady: true, location, storage, now: 1003 });
      return { denied, approved, replay, navigations };
    }, { loginHref: loginUrl.href });
    assert.deepEqual(result, { denied: false, approved: true, replay: false, navigations: [origin + "/"] });

    await page.addScriptTag({ path: path.join(root, "shared/components/zhuge-navigation.js") });
    const navigation = await page.evaluate(() => ({
      creator: window.ZhugeSharedNavigation.render({ externalRoot: "/", isCreator: true }),
      ordinary: window.ZhugeSharedNavigation.render({ externalRoot: "/", isCreator: false }),
      unknown: window.ZhugeSharedNavigation.render({ externalRoot: "/" })
    }));
    assert.match(navigation.creator, /data-shared-nav-item="investment"[^>]*href="\/modules\/investment\/"/);
    assert.match(navigation.creator, /aria-label="返回 Pixel Office"/);
    assert.doesNotMatch(navigation.ordinary, /data-shared-nav-item="investment"/);
    assert.doesNotMatch(navigation.unknown, /data-shared-nav-item="investment"/);
    assert.deepEqual(errors, []);

    const outputDir = path.join(root, "tests/evidence/navigation-release");
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, `office-${viewport.width}x${viewport.height}.png`) });
    await page.goto(await fixtureURL(path.join(root, "docs/index.html")));
    await page.locator(".zgf-rack").waitFor();
    assert.equal(await page.locator(".zgf-rack [data-zgf-work=taskflow]").getAttribute("href"), origin + "/labs/taskflow/");
  });
}
