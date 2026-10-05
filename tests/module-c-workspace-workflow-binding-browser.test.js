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
  html = html.replace('<section class="board-shell">', '<section class="board-shell" data-board-main-view>');
  // Keep the established session/access fixture, replacing only its mock
  // service and scripted interactions. The real service/runtime are loaded.
  const start = html.indexOf("  const mockWorkspaces = [");
  const end = html.indexOf("</script>", start);
  html = html.slice(0, start) + `
  const persistenceKey = "task37-module-c-fixture";
  const persisted = JSON.parse(sessionStorage.getItem(persistenceKey) || "null");
  const harness = (${createWorkspaceWorkflowGateway.toString()})({ ...${JSON.stringify({ ...options, scope })}, persisted });
  const persistFixtureState = () => sessionStorage.setItem(persistenceKey, JSON.stringify({
    workspaces: harness.state.workspaces, initial: harness.state.initial, published: harness.state.published,
    draft: harness.state.draft, cards: harness.state.cards, createdCount: harness.state.createdCount
  }));
  const originalRpc = harness.gateway.rpc.bind(harness.gateway);
  harness.gateway.rpc = async (...args) => { try { return await originalRpc(...args); } finally { persistFixtureState(); } };
  window.bindingFixture = harness;
  const real = window.ZhugeBoardReadService;
  const instanceService = real.createInstanceService({ gateway: harness.gateway, boardInstanceId: harness.boardId });
  const service = { ...instanceService,
    load: async () => ({ workspaces: harness.state.workspaces.map(real.normalizeWorkspace), tasks: harness.state.cards.map(real.normalizeTask), principles: [], systemMaps: [], boardInstanceId: harness.boardId, boardName: "Local Workflow QA" }),
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

test("Module C Workspace and Workflow canvas browser QA uses localhost and in-memory authority only", { skip: !fs.existsSync(executable) }, async t => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/tests/workspace-binding-fixture.html") {
      const scope = url.searchParams.get("scope") || "ai_board";
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(fixtureHtml(scope, { optional: url.searchParams.has("optional"), emptyEdges: url.searchParams.has("empty-edges"), invalidDraft: url.searchParams.has("invalid"), failAt: url.searchParams.has("fail-save") ? "board_c_workflow_save_draft" : "" }));
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
    async function pageFor(query = "", contextOptions = {}) {
      const page = await browser.newPage(contextOptions);
      const errors = [];
      page.fixtureErrors = errors;
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
    const writeNames = page => page.evaluate(() => window.bindingFixture.state.calls.filter(call => !call.name.endsWith("_get")).map(call => call.name));
    const openWorkflow = async page => {
      const tab = page.locator('[data-board-nav="workflow-settings"]');
      if (!await tab.count()) {
        const diagnostic = await page.evaluate(() => ({
          workflowCapabilities: window.ZhugeBoardRuntime?.getSnapshot?.().workflowCapabilities,
          scope: window.ZhugeBoardRuntime?.getSnapshot?.().applicationScope,
          nav: Array.from(document.querySelectorAll("[data-board-nav]")).map(node => node.dataset.boardNav)
        }));
        throw new Error(`Workflow settings tab is missing (${JSON.stringify(diagnostic)}); page errors: ${(page.fixtureErrors || []).join("; ")}`);
      }
      await tab.click();
      await page.waitForSelector(".workflow-settings-dialog");
    };

    await t.test("new Workspace gets one Step automatically and no new Edge", async () => {
      const page = await pageFor();
      try {
        if (await page.locator("[data-board-create-menu]").isVisible()) await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");
        assert.equal(await page.locator("[data-workspace-workflow-binding], [data-workspace-binding-settings]").count(), 0);
        await page.fill("#workspaceName", "Browser Custom Workspace");
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture");
        await page.waitForFunction(() => document.getElementById("workspaceCreateDrawer").getAttribute("aria-hidden") === "true");
        assert.deepEqual(await writeNames(page), ["board_instance_create_workspace"]);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.steps.filter(step => step.workspace_id === "ws-created-1").length), 1);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.transitions.some(edge => edge.from_step_id === "ws-created-1" || edge.to_step_id === "ws-created-1")), false);
      } finally { await page.close(); }
    });

    await t.test("AI Board custom Workspaces accept TASK and shared repair keeps TASK-081 edge-free", async () => {
      const page = await pageFor();
      try {
        await page.locator('[data-workspace-header="ws-custom-0"] [data-workspace-menu]').click();
        assert.equal(await page.locator('[data-workspace-action="workflow-binding"]').count(), 0);
        await page.evaluate(() => document.body.click());
        for (const [workspaceId, title] of [["ws-custom-0", "Resource Share Task"], ["ws-custom-1", "Deferred Task"], ["ws-custom-2", "TASK-081 Standalone Task"]]) {
          await page.locator(`[data-workspace-add="${workspaceId}"]`).click();
          await page.fill("#taskTitle", title);
          await page.click("[data-golden-master-create-card]");
          await page.waitForFunction(name => window.bindingFixture.state.cards.some(card => card.title === name), title);
          const result = await page.evaluate(() => ({
            workflow: window.bindingFixture.state.published,
            workspaces: window.bindingFixture.state.workspaces
          }));
          assert.ok(result.workspaces.filter(row => row.active !== false).every(workspace => result.workflow.steps.filter(candidate => candidate.workspace_id === workspace.id).length === 1));
          assert.equal(result.workflow.transitions.some(edge => edge.from_step_id === "ws-custom-2" || edge.to_step_id === "ws-custom-2"), false);
        }
        assert.deepEqual(await writeNames(page), [
          "board_instance_create_task",
          "board_instance_create_task", "board_instance_create_task"
        ]);
        await page.reload();
        await page.waitForSelector("[data-workspace-header]");
        await page.waitForFunction(() => window.bindingFixture.state.cards.length === 4 && window.bindingFixture.state.published.steps.length === window.bindingFixture.state.workspaces.length);
        assert.equal(await page.locator(".taskcard").count(), 4);
      } finally { await page.close(); }
    });

    await t.test("existing user Draft Edges/settings remain unpublished during Workspace and TASK creation, including reload",async()=>{
      const page=await pageFor();
      try{
        await page.evaluate(()=>{
          const f=window.bindingFixture.state;
          f.draft={...structuredClone(f.published),id:"unconfirmed-user-draft",status:"draft",name:"User unconfirmed",description:"Keep unconfirmed settings"};
          f.draft.steps[0].name="User node rename";
          f.draft.transitions.push({transition_key:"unconfirmed-edge",from_step_id:"step-1",to_step_id:"step-0",allowed_roles:["gpt"]});
        });
        if(await page.locator("[data-board-create-menu]").isVisible())await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");await page.fill("#workspaceName","Draft-safe Workspace");await page.click("[data-workspace-create]");
        await page.waitForFunction(()=>window.bindingFixture.state.createdCount===1);
        await page.waitForFunction(()=>document.getElementById("workspaceCreateDrawer").getAttribute("aria-hidden")==="true");
        await page.locator('[data-workspace-add="ws-created-1"]').click();await page.fill("#taskTitle","Draft-safe TASK");await page.click("[data-golden-master-create-card]");
        await page.waitForFunction(()=>window.bindingFixture.state.cards.some(c=>c.title==="Draft-safe TASK"));
        for(const reload of [false,true]){
          if(reload){await page.reload();await page.waitForSelector("[data-workspace-header]");}
          const r=await page.evaluate(()=>({draft:window.bindingFixture.state.draft,published:window.bindingFixture.state.published,cards:window.bindingFixture.state.cards}));
          assert.equal(r.draft.id,"unconfirmed-user-draft");assert.equal(r.draft.status,"draft");assert.equal(r.draft.name,"User unconfirmed");
          assert.equal(r.draft.steps.find(s=>s.workspace_id==="ws-todo").name,"User node rename");
          assert.ok(r.draft.transitions.some(e=>e.transition_key==="unconfirmed-edge"));
          assert.equal(r.published.transitions.some(e=>e.transition_key==="unconfirmed-edge"),false);
          assert.equal(r.published.name,"Fixture Workflow");assert.ok(r.cards.some(c=>c.title==="Draft-safe TASK"));
        }
      }finally{await page.close();}
    });

    await t.test("failed atomic save retry reuses the request key, including after drawer close/reopen", async () => {
      const page = await pageFor("fail-save");
      try {
        if (await page.locator("[data-board-create-menu]").isVisible()) await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");
        await page.fill("#workspaceName", "Recoverable Browser Workspace");
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => document.querySelector("[data-workspace-binding-progress]").textContent.includes("不會建立重複工作區"));
        assert.equal(await page.locator("#workspaceName").isDisabled(), true);
        await page.locator("#workspaceCreateDrawer [data-workspace-drawer-close]").last().click();
        if (await page.locator("[data-board-create-menu]").isVisible()) await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");
        assert.equal(await page.inputValue("#workspaceName"), "Recoverable Browser Workspace");
        await page.evaluate(() => { window.bindingFixture.state.failAt = ""; });
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture");
        assert.equal(await page.evaluate(() => window.bindingFixture.state.createdCount), 1);
      } finally { await page.close(); }
    });

    await t.test("invalid system structure rolls back and browser never publishes", async () => {
      const page = await pageFor("invalid");
      try {
        if (await page.locator("[data-board-create-menu]").isVisible()) await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");
        await page.fill("#workspaceName", "Validation Pending");
        await page.click("[data-workspace-create]");
        await page.waitForFunction(() => document.querySelector("[data-workspace-binding-progress]").textContent.includes("不會建立重複工作區"));
        assert.equal((await writeNames(page)).includes("board_c_workflow_publish"), false);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.id), "published-1");
        assert.equal(await page.locator("[data-workspace-binding-settings]").count(), 0);
      } finally { await page.close(); }
    });

    await t.test("desktop canvas connects by plus click and drag, removes only Edges, publishes, and reads back after reload", async () => {
      const page = await pageFor("empty-edges");
      try {
        await openWorkflow(page);
        assert.equal(await page.locator("[data-workflow-studio-node]").count(), 8);
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 0);
        const originalCards = await page.evaluate(() => window.bindingFixture.state.cards.length);

        await page.locator('[data-workflow-connector="right"][data-step-key="todo"]').click();
        await page.locator('[data-workflow-studio-node][data-step-key="co"]').hover();
        assert.equal(await page.locator("[data-workflow-edge-preview]").count(), 1);
        assert.match(await page.locator("[data-workflow-edge-preview]").evaluate(node => getComputedStyle(node).strokeDasharray), /7px,\s*6px/);
        await page.locator('[data-workflow-studio-node][data-step-key="co"]').click();
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 1);

        const source = await page.locator('[data-workflow-connector="right"][data-step-key="co"]').boundingBox();
        const target = await page.locator('[data-workflow-studio-node][data-step-key="gpt"]').boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
        assert.equal(await page.locator("[data-workflow-edge-preview]").count(), 1);
        await page.mouse.up();
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 2);

        await page.locator("[data-workflow-remove-transition]").first().click();
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 1);
        assert.equal(await page.locator("[data-workflow-studio-node]").count(), 8);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.cards.length), originalCards);
        const editorBeforePublish = await page.evaluate(() => window.ZhugeBoardRuntime.getSnapshot().workflowEditor);
        const editorValidation = await page.evaluate(editor => window.ZhugeWorkflowStudio.validate(editor), editorBeforePublish);
        assert.deepEqual(editorValidation.errors, []);
        await page.locator("[data-workflow-publish]").click();
        await page.waitForTimeout(500);
        const publishDiagnostics = await page.evaluate(() => ({
          published: window.bindingFixture.state.published,
          draft: window.bindingFixture.state.draft,
          writes: window.bindingFixture.state.calls.filter(call => !call.name.endsWith("_get")).map(call => call.name),
          status: document.querySelector("[data-workflow-status]")?.textContent,
          buttonCount: document.querySelectorAll("[data-workflow-publish]").length,
          buttonDisabled: document.querySelector("[data-workflow-publish]")?.disabled,
          readOnly: window.ZhugeBoardRuntime.getSnapshot().workflowCapabilities
        }));
        assert.equal(publishDiagnostics.published.id, "draft-fixture", JSON.stringify(publishDiagnostics));
        assert.equal(publishDiagnostics.published.transitions.length, 1, JSON.stringify(publishDiagnostics));
        const readBackEdge = await page.evaluate(() => window.bindingFixture.state.published.transitions[0]);
        const readBackSteps = await page.evaluate(() => window.bindingFixture.state.published.steps);
        assert.equal(readBackSteps.find(step => step.id === readBackEdge.from_step_id).step_key, "co");
        assert.equal(readBackSteps.find(step => step.id === readBackEdge.to_step_id).step_key, "gpt");

        await page.reload();
        await page.waitForSelector("[data-workspace-header]");
        await openWorkflow(page);
        assert.equal(await page.locator("[data-workflow-studio-node]").count(), 8);
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 1);
        await page.locator("[data-workflow-remove-transition]").click();
        await page.locator("[data-workflow-publish]").click();
        await page.waitForFunction(() => window.bindingFixture.state.published.id === "draft-fixture" && window.bindingFixture.state.published.transitions.length === 0);
        await page.reload();
        await page.waitForSelector("[data-workspace-header]");
        await openWorkflow(page);
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 0);
        const finalState = await page.evaluate(() => ({
          steps: window.bindingFixture.state.published.steps,
          workspaces: window.bindingFixture.state.workspaces,
          cards: window.bindingFixture.state.cards
        }));
        assert.equal(finalState.steps.length, finalState.workspaces.length);
        assert.ok(finalState.workspaces.every(workspace => finalState.steps.filter(step => step.workspace_id === workspace.id).length === 1));
        assert.equal(finalState.cards.length, originalCards);
        await page.locator("[data-workflow-close]").click();
        await page.locator('[data-workspace-add="ws-custom-0"]').click();
        await page.fill("#taskTitle", "Task in an edge-free Workspace");
        await page.click("[data-golden-master-create-card]");
        await page.waitForFunction(count => window.bindingFixture.state.cards.length === count + 1, originalCards);
        assert.equal(await page.evaluate(() => window.bindingFixture.state.published.transitions.length), 0);
        assert.deepEqual(await writeNames(page), ["board_instance_create_task"]);
      } finally { await page.close(); }
    });

    await t.test("mobile tap source then target creates an Edge", async () => {
      const page = await pageFor("empty-edges", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        await openWorkflow(page);
        await page.locator('[data-workflow-connector="left"][data-step-key="todo"]').tap();
        assert.equal(await page.locator("[data-workflow-edge-preview]").count(), 1);
        await page.locator('[data-workflow-studio-node][data-step-key="co"]').tap();
        assert.equal(await page.locator("[data-workflow-remove-transition]").count(), 1);
      } finally { await page.close(); }
    });

    for (const [scope, consumer] of [["worktodo", "worktodo-new"], ["procurement", "worklog-procurement"], ["c", ""]]) {
      await t.test(`${scope} optional Workflow retains Workspace creation UI`, async () => {
        const page = await pageFor(`scope=${scope}&optional&consumer=${consumer}`);
        try {
          if (await page.locator("[data-board-create-menu]").isVisible()) await page.click("[data-board-create-menu]");
        await page.click("[data-board-create-workspace]");
          assert.equal(await page.locator("[data-workspace-workflow-binding], [data-workspace-binding-settings]").count(), 0);
          await page.fill("#workspaceName", "Optional Custom Workspace");
          await page.click("[data-workspace-create]");
          await page.waitForFunction(() => window.bindingFixture.state.createdCount === 1);
          assert.deepEqual(await writeNames(page), ["board_instance_create_workspace"]);
          assert.equal(await page.evaluate(() => window.bindingFixture.state.published.transitions.length), 0);
          assert.equal(await page.evaluate(() => window.bindingFixture.state.published.steps.length), await page.evaluate(() => window.bindingFixture.state.workspaces.length));
        } finally { await page.close(); }
      });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
