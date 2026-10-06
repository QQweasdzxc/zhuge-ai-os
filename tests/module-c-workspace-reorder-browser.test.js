const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");
const SOURCE_FIXTURE = path.join(__dirname, "ai-board-batch-2-browser.html");
const SCREENSHOT_DIR = path.join(ROOT, "docs/qa/task-34-workspace-reorder/screenshots");
const BOARD_INSTANCE_ID = "00000000-0000-4000-8000-000000000034";
const ORDER_KEY = "task34-workspace-order";
const CUSTOM_KEY = "task34-workspace-custom";
const AUDIT_KEY = "task34-workspace-audit";

function makeFixture() {
  let html = fs.readFileSync(SOURCE_FIXTURE, "utf8");
  html = html.replaceAll("__RUNTIME_BUILD__", "local-task34-reorder-fixture");

  const start = html.indexOf("  const mockWorkspaces = [");
  const end = html.indexOf("  const mockTasks = [", start);
  assert.ok(start >= 0 && end > start, "the shared AI Board fixture has its canonical workspace seam");
  html = html.slice(0, start) + `
  const fixtureIsWorkTodo = new URLSearchParams(window.location.search).get("consumer") === "worktodo-new";
  const fixtureBoardInstanceId = "${BOARD_INSTANCE_ID}";
  const fixtureScope = fixtureIsWorkTodo ? "worktodo" : "ai_board";
  const mockWorkspaces = (fixtureIsWorkTodo ? [
    { id: "ws-todo", key: "worktodo-todo", name: "待開始", sortOrder: 10 },
    { id: "ws-inprogress", key: "worktodo-inprogress", name: "進行中", sortOrder: 20 },
    { id: "ws-waiting", key: "worktodo-waiting-acceptance", name: "等待驗收", sortOrder: 30 },
    { id: "ws-completed", key: "worktodo-completed", name: "完成", sortOrder: 40 }
  ] : [
    { id: "ws-todo", key: "todo", name: "待辦", sortOrder: 10 },
    { id: "ws-co", key: "co", name: "Co區", sortOrder: 20 },
    { id: "ws-gpt", key: "gpt", name: "GPT區", sortOrder: 30 },
    { id: "ws-qjc", key: "qjc", name: "QJC驗證", sortOrder: 40 },
    { id: "ws-completed", key: "completed", name: "完成", sortOrder: 50 }
  ]).map(workspace => ({
    ...workspace,
    active: true,
    applicationScope: fixtureScope,
    boardInstanceId: fixtureIsWorkTodo ? fixtureBoardInstanceId : ""
  }));
` + html.slice(end);

  const helpers = `
  function applyFixtureWorkspaceState() {
    try {
      const savedCustom = JSON.parse(localStorage.getItem("${CUSTOM_KEY}") || "[]");
      for (const workspace of savedCustom) {
        if (!mockWorkspaces.some(row => row.id === workspace.id)) mockWorkspaces.push(workspace);
      }
      const savedOrder = JSON.parse(localStorage.getItem("${ORDER_KEY}") || "null");
      if (Array.isArray(savedOrder)) {
        const byId = new Map(mockWorkspaces.map(row => [row.id, row]));
        const ordered = [...savedOrder.map(id => byId.get(id)).filter(Boolean), ...mockWorkspaces.filter(row => !savedOrder.includes(row.id))];
        ordered.forEach((row, index) => { row.sortOrder = (index + 1) * 10; });
        mockWorkspaces.splice(0, mockWorkspaces.length, ...ordered);
      }
    } catch (error) { throw new Error("fixture workspace read-back failed: " + error.message); }
  }
  async function createFixtureWorkspace(name) {
    const next = mockWorkspaces.filter(row => row.id.startsWith("ws-user-")).length + 1;
    const workspace = {
      id: "ws-user-" + next,
      key: fixtureIsWorkTodo ? "worktodo-custom-runtime-" + next : "",
      name,
      sortOrder: Math.max(0, ...mockWorkspaces.map(row => Number(row.sortOrder) || 0)) + 10,
      active: true,
      applicationScope: fixtureScope,
      boardInstanceId: fixtureIsWorkTodo ? fixtureBoardInstanceId : ""
    };
    mockWorkspaces.push(workspace);
    localStorage.setItem("${CUSTOM_KEY}", JSON.stringify(mockWorkspaces.filter(row => row.id.startsWith("ws-user-"))));
    return workspace;
  }
  `;
  html = html.replace("  window.ZhugeBoardReadService = {", helpers + "\n  window.ZhugeBoardReadService = {");
  html = html.replace(
    /    load: async \(\) => \(\{ workspaces: mockWorkspaces, tasks: mockTasks, principles: \[\{ code: "PRINCIPLE-001"[\s\S]*?\]\s*\}\),/,
    `    load: async () => {
      applyFixtureWorkspaceState();
      return {
        workspaces: mockWorkspaces,
        tasks: mockTasks,
        principles: [{ code: "PRINCIPLE-001", title: "不得偽造 Evidence", summary: "正式證據必須可追溯。" }],
        systemMaps: [{ code: "TASK-026-SYSTEM-MAP", title: "Current System Map", summary: "Shared Shell → AI Board → Supabase" }],
        boardInstanceId: fixtureIsWorkTodo ? fixtureBoardInstanceId : "",
        boardName: fixtureIsWorkTodo ? "WorkTodo 本機排序測試" : "AI Board 本機排序測試"
      };
    },`
  );
  html = html.replace(
    /    createWorkspace: async name => \{ const workspace = \{ id: "ws-test", key: "", name, sortOrder: 60, active: true \}; mockWorkspaces\.push\(workspace\); return workspace; \},/,
    "    createWorkspace: createFixtureWorkspace,\n    worktodoCreateWorkspace: createFixtureWorkspace,"
  );
  html = html.replace(
    "    reorderWorkspaces: async () => ({ success: true }),",
    `    reorderWorkspaces: async workspaceIds => {
      const activeIds = mockWorkspaces.filter(row => row.active === true).map(row => row.id);
      if (workspaceIds.length !== activeIds.length || new Set(workspaceIds).size !== activeIds.length || activeIds.some(id => !workspaceIds.includes(id))) {
        throw new Error("fixture requires every active workspace exactly once");
      }
      const before = [...activeIds];
      const byId = new Map(mockWorkspaces.map(row => [row.id, row]));
      workspaceIds.forEach((id, index) => { byId.get(id).sortOrder = (index + 1) * 10; });
      localStorage.setItem("${ORDER_KEY}", JSON.stringify(workspaceIds));
      const audit = JSON.parse(localStorage.getItem("${AUDIT_KEY}") || "[]");
      audit.push({ action: "workspace_order_changed", before, after: [...workspaceIds] });
      localStorage.setItem("${AUDIT_KEY}", JSON.stringify(audit));
      return { updated: workspaceIds.length, board_instance_id: fixtureBoardInstanceId, workspace_ids: workspaceIds, audit_id: audit.length };
    },`
  );
  html = html.replace(
    "    createInstanceService: () => window.ZhugeBoardReadService",
    `    createInstanceService: () => window.ZhugeBoardReadService,
    resolveOrProvisionPersonalWorkTodo: async () => ({ boardInstanceId: fixtureBoardInstanceId })`
  );
  assert.match(html, /createWorkspace: createFixtureWorkspace/);
  assert.match(html, /worktodoCreateWorkspace: createFixtureWorkspace/);
  assert.match(html, /applyFixtureWorkspaceState\(\);\s*return \{/);

  const finalScriptStart = html.indexOf('<script>\n  (function recordTaskOrder');
  const finalScriptEnd = html.lastIndexOf("</script>");
  assert.ok(finalScriptStart >= 0 && finalScriptEnd > finalScriptStart, "the source fixture has an isolated final browser script");
  html = html.slice(0, finalScriptStart) + html.slice(finalScriptEnd + "</script>".length);
  return html;
}

function workspaceIds(page) {
  return page.locator("[data-shared-task-board-column]").evaluateAll(columns => columns.map(column => column.dataset.workspaceId));
}

async function expectOrder(page, expected) {
  await page.waitForFunction(order => {
    const actual = Array.from(document.querySelectorAll("[data-shared-task-board-column]"))
      .map(column => column.dataset.workspaceId);
    return JSON.stringify(actual) === JSON.stringify(order);
  }, expected, { timeout: 15000 });
  assert.deepEqual(await workspaceIds(page), expected);
}

async function dragWorkspace(page, sourceId, targetId, position) {
  await page.evaluate(({ sourceId, targetId, position }) => {
    const handle = document.querySelector(`[data-workspace-id="${sourceId}"] .workspace-drag-handle`);
    const target = document.querySelector(`[data-workspace-id="${targetId}"]`);
    if (!handle || !target) throw new Error(`workspace drag endpoints not rendered: ${sourceId} -> ${targetId}`);
    const rect = target.getBoundingClientRect();
    const clientX = position === "after" ? rect.right - 2 : rect.left + 2;
    if (rect.width <= 0 || clientX < rect.left || clientX > rect.right) throw new Error("workspace drop point is outside the target");
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX }));
    if (target.dataset.workspaceDropPlacement !== position || !target.classList.contains("workspace-drop-" + position)) throw new Error("insertion preview does not match canonical placement");
    const marker = getComputedStyle(target, "::after");
    if (marker.content === "none" || parseFloat(marker.width) < 3) throw new Error("vertical insertion marker is missing");
    if (parseFloat(position === "before" ? marker.left : marker.right) !== 0) throw new Error("marker is on the wrong edge");
    // A changed drop coordinate must not override the displayed insertion edge.
    const dropX = position === "after" ? rect.left + 2 : rect.right - 2;
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: dropX }));
    handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
  }, { sourceId, targetId, position });
}

test("Module C Workspace Reorder browser E2E: WorkTodo and AI Board, create, both edges, reload", async t => {
  const executable = resolveBrowserExecutable();
  if (!executable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run Module C workspace reorder browser E2E");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const html = makeFixture();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/tests/module-c-workspace-reorder-browser.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    const file = path.resolve(ROOT, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(ROOT + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) { response.writeHead(404).end(); return; }
      const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream";
      response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      response.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const browser = await chromium.launch({
    headless: true,
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"]
  });
  t.after(() => browser.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}/tests/module-c-workspace-reorder-browser.html`;
  for (const consumer of ["worktodo-new", "ai-board"]) {
    const isWorkTodo = consumer === "worktodo-new";
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const url = isWorkTodo ? `${baseUrl}?consumer=worktodo-new` : baseUrl;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.createWorkspace && document.querySelectorAll("[data-shared-task-board-column]").length >= 4, null, { timeout: 20000 });

    if (isWorkTodo) {
      await dragWorkspace(page, "ws-waiting", "ws-completed", "after");
      await expectOrder(page, ["ws-todo","ws-inprogress","ws-completed","ws-waiting"]);
      const auditCount = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]").length, AUDIT_KEY);
      await dragWorkspace(page, "ws-completed", "ws-waiting", "before");
      await page.waitForTimeout(100);
      await expectOrder(page, ["ws-todo","ws-inprogress","ws-completed","ws-waiting"]);
      assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]").length, AUDIT_KEY), auditCount, "unchanged order never persists/audits");
      assert.equal(await page.locator(".workspace-drop-before,.workspace-drop-after,.workspace-dropzone,.workspace-dragging,[data-workspace-drop-placement]").count(), 0, "drop/dragend clean all interaction state");
      await dragWorkspace(page, "ws-completed", "ws-waiting", "after");
      await expectOrder(page, ["ws-todo","ws-inprogress","ws-waiting","ws-completed"]);
    }
    for (const endEvent of ["dragleave", "dragend"]) {
      await page.evaluate(endEvent => {
        const handle = document.querySelector(".workspace-drag-handle");
        const target = document.querySelectorAll("[data-shared-task-board-column]")[1];
        const dataTransfer = new DataTransfer();
        handle.dispatchEvent(new DragEvent("dragstart", { bubbles:true, cancelable:true, dataTransfer }));
        target.dispatchEvent(new DragEvent("dragover", { bubbles:true, cancelable:true, dataTransfer, clientX: target.getBoundingClientRect().left+2 }));
        (endEvent === "dragend" ? handle : target).dispatchEvent(new DragEvent(endEvent, { bubbles:true, dataTransfer }));
      }, endEvent);
      assert.equal(await page.locator(".workspace-drop-before,.workspace-drop-after,.workspace-dropzone,.workspace-dragging,[data-workspace-drop-placement]").count(), 0, endEvent + " cleans interaction state");
    }
    const todoId = "ws-todo";
    const completionId = "ws-completed";
    const completionKey = isWorkTodo ? "worktodo-completed" : "completed";
    assert.equal(await page.locator(`[data-workspace-key="${completionKey}"] .workspace-drag-handle`).count(), 1, `${consumer} exposes Completion reorder handle`);

    const createTrigger = page.locator("[data-board-create-workspace]");
    if (await createTrigger.count()) await createTrigger.click();
    await page.evaluate(async name => {
      const input = document.getElementById("workspaceName");
      if (!input) throw new Error("canonical workspace creation input is unavailable");
      input.value = name;
      await window.createWorkspace();
    }, "剛新增的工作區");
    await page.waitForTimeout(750);
    const creationReadback = await page.evaluate(keys => ({
      columns: Array.from(document.querySelectorAll("[data-shared-task-board-column]"))
        .map(column => ({ id: column.dataset.workspaceId, key: column.dataset.workspaceKey, name: column.querySelector(".workspace-title")?.textContent })),
      customStorage: localStorage.getItem(keys.custom),
      banner: document.querySelector(".banner,[role='status'],[data-shared-feedback]")?.textContent || "",
      bodyTail: document.body.innerText.slice(-500)
    }), { custom: CUSTOM_KEY });
    assert.ok(creationReadback.columns.some(column => column.id === "ws-user-1"), `new workspace is rendered; read-back=${JSON.stringify(creationReadback)}`);
    let order = await workspaceIds(page);
    assert.equal(order.at(-1), "ws-user-1", "new workspace receives the final canonical order position");
    const prefix = isWorkTodo ? "worktodo" : "ai-board";
    const takeBoardShot = label => page.locator("[data-shared-task-board]").screenshot({
      path: path.join(SCREENSHOT_DIR, `${prefix}-${label}.png`),
      animations: "disabled"
    });

    await takeBoardShot("new-workspace-before");
    await dragWorkspace(page, "ws-user-1", todoId, "before");
    order = ["ws-user-1", ...order.filter(id => id !== "ws-user-1")];
    await expectOrder(page, order);
    await takeBoardShot("new-workspace-after");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("[data-shared-task-board-column]").length >= 5, null, { timeout: 20000 });
    await expectOrder(page, order);
    assert.equal(await page.locator('[data-workspace-id="ws-user-1"]').count(), 1, "created workspace survives fixture reload");
    await takeBoardShot("new-workspace-after-reload");

    await dragWorkspace(page, completionId, order[0], "before");
    order = [completionId, ...order.filter(id => id !== completionId)];
    await expectOrder(page, order);
    await takeBoardShot("completion-first");

    const middleTargetId = isWorkTodo ? "ws-inprogress" : "ws-co";
    await dragWorkspace(page, completionId, middleTargetId, "after");
    order = order.filter(id => id !== completionId);
    order.splice(order.indexOf(middleTargetId) + 1, 0, completionId);
    await expectOrder(page, order);
    assert.ok(Math.abs(order.indexOf(completionId) - Math.floor(order.length / 2)) <= 1, "Completion is placed in the middle region");
    await takeBoardShot("completion-middle");

    const lastId = order.at(-1);
    await dragWorkspace(page, completionId, lastId, "after");
    order = order.filter(id => id !== completionId);
    order.push(completionId);
    await expectOrder(page, order);
    await takeBoardShot("completion-last");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("[data-shared-task-board-column]").length >= 5, null, { timeout: 20000 });
    await expectOrder(page, order);
    assert.equal((await workspaceIds(page)).at(-1), completionId, "Completion remains last after reload");
    await takeBoardShot("completion-last-after-reload");

    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator("[data-shared-task-board-column]").first().evaluate(column => Math.round(column.getBoundingClientRect().width)),300,"Mobile Golden Master 300px column geometry preserved");
    const persistedAudit = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), AUDIT_KEY);
    assert.ok(persistedAudit.length >= 4, "each successful fixture reorder leaves an audit record");
    assert.deepEqual(pageErrors, [], `${consumer} has no uncaught browser errors`);
    await page.close();
  }
});
