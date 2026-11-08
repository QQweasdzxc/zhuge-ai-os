const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

const root = path.resolve(__dirname, "..");
const panelURL = "https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/";

test("Pages panel: Google login, creator gate, confirmed RPC parameters and errors (network mocked)", async () => {
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable(), headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let creator = true, denied = false, value = true;
    const calls = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://qqweasdzxc.github.io") {
        let relative = url.pathname.replace(/^\/zhuge-ai-os\//, "");
        if (relative.endsWith("/")) relative += "index.html";
        const filename = path.join(root, relative);
        assert.ok(filename.startsWith(root + path.sep));
        return route.fulfill({ path: filename, contentType: filename.endsWith(".js") ? "text/javascript" : "text/html" });
      }
      // Every Supabase request is fulfilled locally. No production call escapes.
      assert.equal(url.origin, "https://lenpbbhwxyyfwgvjcozf.supabase.co");
      if (url.pathname === "/auth/v1/user") return route.fulfill({ json: { id: "u1", email: "fixture@example.test" } });
      const name = url.pathname.split("/").pop();
      const args = route.request().postDataJSON();
      calls.push({ name, args });
      if (name === "resolve_creator_capability") return route.fulfill({ json: { user_id: "u1", is_creator: creator } });
      if (name === "app_access_review_paused") return route.fulfill({ json: value });
      assert.equal(name, "set_app_access_review_paused");
      assert.equal(typeof args.paused, "boolean");
      if (denied) return route.fulfill({ status: 403, json: { code: "42501", message: "Creator required" } });
      value = args.paused;
      return route.fulfill({ json: { review_paused: value } });
    });
    await page.addInitScript(() => {
      localStorage.setItem("zhuge_ai_os_google_auth_session_v1", JSON.stringify({ access_token: "mock-only", expires_at: Date.now() / 1000 + 3600 }));
    });
    const writes = () => calls.filter(call => call.name === "set_app_access_review_paused");
    await page.goto(panelURL);
    await page.getByText("人工審核：已暫停", { exact: true }).waitFor();
    assert.equal(writes().length, 0);
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("switch").click();
    assert.equal(writes().length, 0);
    assert.equal(await page.getByRole("switch").isChecked(), true);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("switch").click();
    await page.getByText("設定已更新：人工審核啟用。", { exact: true }).waitFor();
    assert.deepEqual(writes(), [{ name: "set_app_access_review_paused", args: { paused: false } }]);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("switch").click();
    await page.getByText("設定已更新：人工審核已暫停。", { exact: true }).waitFor();
    assert.deepEqual(writes()[1].args, { paused: true });
    denied = true;
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("switch").click();
    await page.getByText("無權限", { exact: true }).waitFor();
    assert.equal(await page.getByRole("switch").count(), 0);
    creator = false;
    const before = calls.length;
    await page.getByRole("button", { name: "重新確認" }).click();
    await page.getByText("無權限", { exact: true }).waitFor();
    assert.equal(await page.getByRole("switch").count(), 0);
    assert.deepEqual(calls.slice(before).map(call => call.name), ["resolve_creator_capability"]);
    await page.evaluate(() => localStorage.clear());
    await page.getByRole("button", { name: "重新確認" }).click();
    await page.getByRole("button", { name: "使用 Google 登入" }).waitFor();
    assert.equal(await page.getByRole("switch").count(), 0);
    assert.deepEqual(errors, []);
    assert.ok(calls.filter(call => call.name !== "set_app_access_review_paused").every(call => JSON.stringify(call.args) === "{}"));
    await context.close();
  } finally { await browser.close(); }
});
