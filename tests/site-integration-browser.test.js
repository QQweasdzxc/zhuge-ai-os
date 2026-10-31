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

    const frame = page.locator('iframe[title="Zhuge AI OS 像素辦公室"]');
    await frame.waitFor();
    const frameSrc = new URL(await frame.getAttribute("src"), page.url());
    assert.equal(frameSrc.pathname, "/labs/pixel-office-3d/index.html", "root embeds the 3D office");
    assert.equal(frameSrc.searchParams.get("source"), "tf", "root embed keeps TF mode");
    assert.equal(await page.locator(".zgf-rack").count(), 0, "root candidate is de-decorated: no furnishings overlay");
    const origin = new URL(page.url()).origin;
    assert.equal(await page.locator("#pixel-fallback a").getAttribute("href"), "./status-classic.html", "classic report fallback preserved");
    assert.equal(await page.locator('script[src="./assets/zhuge-home-router.js"]').count(), 1, "home router preserved");
    const loginUrl = new URL("/modules/worklog/?app=1&workspace=dashboard&officeReturn=1", origin);
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
