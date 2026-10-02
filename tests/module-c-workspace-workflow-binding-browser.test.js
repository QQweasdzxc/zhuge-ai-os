const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable.js");
const { createWorkspaceWorkflowGateway } = require("./fixtures/module-c-workspace-workflow-gateway.js");
const ROOT = path.resolve(__dirname, "..");
const executable = resolveBrowserExecutable() || chromium.executablePath();

function fixtureHtml(scope, options = {}) {
  let html = fs.readFileSync(path.join(__dirname, "ai-board-batch-2-browser.html"), "utf8");
  html = html.replace('<div class="actions">', '<div data-zhuge-shared-header="true"><div class="zhuge-shared-header-actions"></div></div><div class="actions">');
  // Keep the established session/access fixture, replacing only its mock
  // service and scripted interactions. The real service/runtime are loaded.
  const start = html.indexOf("  const mockWorkspaces = [");
  const end = html.indexOf("</script>", start);
  html = html.slice(0, start) + `
  const harness = (${createWorkspaceWorkflowGateway.toString()})(${JSON.stringify({ ...options, scope })});
  window.bindingFixture = harness;
  const real = window.ZhugeBoardReadService;
  const instanceService = real.createInstanceService({ gateway: harness.gateway, boardInstanceId: harness.boardId });
  const service = { ...instanceService,
    load: async () => ({ workspaces: harness.state.workspaces.map(real.normalizeWorkspace), tasks: [], principles: [], systemMaps: [], boardInstanceId: harness.boardId, boardName: "Local Workflow QA" }),
    subscribe: async () => () => {},
    getAuthorityConformance: async () => null
  };
  window.ZhugeBoardReadService = { ...real, createInstanceService: () => service,
    createWorkflowCapability: () => instanceService.workflow,
    resolveOrProvisionPersonalWorkTodo: async () => ({ boardInstanceId: harness.boardId })
  };
  ${scope === "c" ? 'document.body.dataset.templatePageId = "template-c";' : ""}
` + html.slice(end);
  html = html.replace('<script>\n  let session', '<script src="../shared/board/board-read-service.js"></script>\n<script>\n  let session');
  const runtimeEnd = html.indexOf('</script>', html.indexOf('src="../shared/components/golden-master-runtime.js"')) + '</script>'.length;
  return html.slice(0, runtimeEnd);
}

test("Module C Workspace binding UI uses localhost and in-memory authority only", { skip: !fs.existsSync(executable) }, async t => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/tests/workspace-binding-fixture.html") {
      const scope = url.searchParams.get("scope") || "ai_board";
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(fixtureHtml(scope, { optional: url.searchParams.has("optional"), invalidDraft: url.searchParams.has("invalid"), failAt: url.searchParams.has("fail-save") ? "board_c_workflow_save_draft" : "" }));
      return;
    }
    const target = path.resolve(ROOT, `.${url.pathname}`);
    if (!target.startsWith(ROOT + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html");
    response.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ["--no-sandbox"] });
    async function pageFor(query = "") {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      // Block every external request; no Cloud session or mutation can occur.
      await page.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
      await page.goto(`${base}/tests/workspace-binding-fixture.html?${query}`);
      try {
        await page.waitForSelector("[data-workspace-header]", { timeout: 5000 });
      } catch (error) {
        const message = await page.locator("body").innerText();
        await page.close();
        throw new Error(`Fixture boot failed: ${errors.join("; ")} / ${message.slice(-1500)}`, { cause: error });
      }
      await page.waitForFunction(() => window.bindingFixture.state.getCount > 0);
      return page;
    }
    async function confirmBinding(page) {
      await page.selectOption("#workspaceWorkflowRole", "pm");
      await page.selectOption("#workspaceWorkflowStatus", "ready");
      await page.check("#workspaceWorkflowConfirm");
    }
    const writeNames = page => page.evaluate(() => window.bindingFixture.state.calls.filter(call => !call.name.endsWith("_get")).map(call => call.name));

    await t.test("new Workspace requires explicit review and completes the canonical sequence", async () => {
      const page = await pageFor();
      try {
        await page.click("[data-board-create-workspace]");
        await page.fill("#workspaceName", "Browser Custom Workspace");
        await page.click("[data-workspace-create]");
        assert.deepEqual(await writeNames(page), []);
        await confirmBinding(page);
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture");
        await page.waitForFunction(() => document.getElementById("workspaceCreateDrawer").getAttribute("aria-hidden") === "true");
        assert.deepEqual(await writeNames(page), ["board_instance_create_workspace", "board_c_workflow_save_draft", "board_c_workflow_validate_draft", "board_c_workflow_publish"]);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.steps.filter(step => step.workspace_id === "ws-created-1").length), 1);
      } finally { await page.close(); }
    });

    await t.test("existing AI Board repair exposes only the two PM-authorized workspaces", async () => {
      for (const id of ["ws-custom-0", "ws-custom-1", "ws-custom-2"]) {
        const page = await pageFor();
        try {
          await page.locator(`[data-workspace-header="${id}"] [data-workspace-menu]`).click();
          const action = page.locator('[data-workspace-action="workflow-binding"]');
          assert.equal(await action.count(), id === "ws-custom-2" ? 0 : 1);
          if (id !== "ws-custom-2") {
            await action.click();
            assert.equal(await page.locator("#workspaceName").isDisabled(), true);
            await confirmBinding(page);
            await page.click("[data-workspace-create]");
            await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture");
            assert.equal((await writeNames(page)).includes("board_instance_create_workspace"), false);
            assert.equal(await page.evaluate(() => window.bindingFixture.state.published.steps.filter(step => step.workspace_id === "ws-custom-2").length), 0);
          }
        } finally { await page.close(); }
      }
    });

    await t.test("failed save retry reuses the Workspace, including after drawer close/reopen", async () => {
      const page = await pageFor("fail-save");
      try {
        await page.click("[data-board-create-workspace]");
        await page.fill("#workspaceName", "Recoverable Browser Workspace");
        await confirmBinding(page);
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => document.querySelector("[data-workspace-binding-progress]").textContent.includes("勿重建"));
        assert.equal(await page.locator("#workspaceName").isDisabled(), true);
        await page.locator("#workspaceCreateDrawer [data-workspace-drawer-close]").last().click();
        await page.click("[data-board-create-workspace]");
        assert.equal(await page.inputValue("#workspaceName"), "Recoverable Browser Workspace");
        await page.evaluate(() => { window.bindingFixture.state.failAt = ""; });
        await confirmBinding(page);
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture");
        assert.equal(await page.evaluate(() => window.bindingFixture.state.createdCount), 1);
      } finally { await page.close(); }
    });

    await t.test("invalid draft is pending and publish is never called", async () => {
      const page = await pageFor("invalid");
      try {
        await page.click("[data-board-create-workspace]");
        await page.fill("#workspaceName", "Validation Pending");
        await confirmBinding(page);
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => document.querySelector("[data-workspace-binding-progress]").textContent.includes("勿重建"));
        assert.equal((await writeNames(page)).includes("board_c_workflow_publish"), false);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.id), "published-1");
        assert.equal(await page.locator("[data-workspace-binding-settings]").isVisible(), true);
      } finally { await page.close(); }
    });

    for (const [scope, consumer] of [["worktodo", "worktodo-new"], ["procurement", "worklog-procurement"], ["c", ""]]) {
      await t.test(`${scope} optional Workflow retains Workspace creation UI`, async () => {
        const page = await pageFor(`scope=${scope}&optional&consumer=${consumer}`);
        try {
          await page.click("[data-board-create-workspace]");
          assert.equal(await page.locator("[data-workspace-workflow-binding]").isVisible(), false);
          await page.fill("#workspaceName", "Optional Custom Workspace");
          await page.click("[data-workspace-create]");
          await page.waitForFunction(() => window.bindingFixture.state.createdCount === 1);
          assert.deepEqual(await writeNames(page), ["board_instance_create_workspace"]);
        } finally { await page.close(); }
      });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
