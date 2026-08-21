const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const exists = file => fs.existsSync(path.join(ROOT, file));
const Catalog = require("../shared/components/system-template-catalog.js");
const GoldenMaster = require("../shared/components/golden-master.js");
const Board = require("../shared/components/task-board.js");
const Card = require("../shared/components/task-card.js");
const Drawer = require("../shared/components/task-drawer.js");

test("System Template Catalog keeps one empty AI Board Golden Master", () => {
  const templates = Catalog.list();
  assert.equal(templates.length, 1);
  const template = Catalog.get(Catalog.GOLDEN_MASTER_ID);
  assert.equal(template.id, "ai-board-empty-golden-master");
  assert.equal(template.name, "空白 AI Board");
  assert.equal(template.status, "唯一正式模板");
  assert.deepEqual(template.adapters.map(adapter => adapter.label), ["AI Board Adapter", "WorkTodo Adapter"]);
  assert.deepEqual(template.domainData.map(data => data.label), ["AI Board Domain Data", "WorkTodo Domain Data"]);
  assert.deepEqual(template.sharedSurfaces, [
    "Shared Navigation / Shell",
    "Shared Header",
    "Shared Toolbar / Search / Filter",
    "Shared Workspace / Column",
    "Shared Task Card",
    "Shared Task Drawer / Properties",
    "Shared Work Content / Usage Scenario",
    "Shared Attachment / Checklist / Timeline",
    "Shared GPT Analysis",
    "Shared Responsive / Interaction"
  ]);
  assert.deepEqual(template.emptySurface, {
    id: "empty-golden-master-surface",
    renderer: "shared-golden-master",
    mode: "empty",
    domainData: false,
    fixture: false,
    cloudWrites: false
  });
  assert.equal(Object.hasOwn(template, "preview"), false);
});

test("Empty Golden Master catalog reserves lifecycle actions without writes", () => {
  const source = read("shared/components/system-template-catalog.js");
  const template = Catalog.get();
  assert.equal(template.capabilities.catalog, "multi-template-ready");
  assert.deepEqual(template.capabilities.empty, { domainData: false, fixture: false, cloudWrites: false });
  assert.equal(template.capabilities.workspace.fixedColumns, false);
  assert.deepEqual(template.capabilities.workspace.operations, ["add", "edit", "delete", "reorder", "move-task"]);
  assert.equal(template.capabilities.clone.enabled, false);
  assert.equal(template.capabilities.apply.enabled, false);
  assert.equal(template.persistence.cloudWrites, false);
  const forbiddenWriteApi = /DataService\s*[.(]|Supabase(?:Repository)?\s*[.(]|localStorage\s*[.(]|sessionStorage\s*[.(]|fetch\s*\(|rpc\s*\(/i;
  assert.doesNotMatch(source, forbiddenWriteApi);
  assert.doesNotMatch(source, /GM-FIX|golden-master-preview|fixtureKey/i);
});

test("System Template Manager mounts the same Empty Golden Master source", () => {
  const config = read("shared/app-config.js");
  const router = read("shared/app-router.js");
  const index = read("modules/worklog/index.html");
  const runtime = read("modules/worklog/worklog-app.js");
  assert.match(config, /"system-templates": \{ icon: "🧩", label: "系統模板"/);
  assert.match(router, /"system-templates"/);
  assert.match(index, /shared\/components\/system-template-catalog\.js/);
  assert.match(index, /shared\/components\/golden-master\.js/);
  assert.match(index, /shared\/theme\/golden-master\.css/);
  assert.doesNotMatch(index, /golden-master-fixture|golden-master-preview|golden-master-preview\.css/);
  assert.match(index, /allowedWorkspaces = new Set\(\["dashboard"[\s\S]*"system-templates"/);
  assert.match(runtime, /\["system-templates", "🧩", "系統模板"/);
  assert.match(runtime, /if \(activeWorkspace === "system-templates"\) return systemTemplates\(\);/);
  assert.match(runtime, /goldenMaster\.render\(/);
  assert.doesNotMatch(runtime, /ZhugeGoldenMasterPreview|template\.preview|GM-FIX/);
  assert.match(runtime, /data-open-workspace="sync">返回控制台/);
});

test("Empty Golden Master renders only the shared empty framework", () => {
  const html = GoldenMaster.render({
    header: { title: "AI Board", description: "Empty Golden Master", identityHint: "No Domain Data" },
    toolbar: { searchId: "goldenMasterSearch", disabled: true, status: "Empty · No Domain Data" },
    columns: [],
    components: {
      board: Board,
      card: Card,
      drawer: Drawer,
      shell: { renderHeader: options => `<header class="zhuge-shared-header"><h2>${options.title}</h2><p>${options.description}</p></header>` }
    }
  });
  assert.match(html, /data-golden-master="empty"/);
  assert.match(html, /data-golden-master-data="none"/);
  assert.match(html, /data-golden-master-toolbar="true"/);
  assert.match(html, /data-golden-master-board-shell="true"/);
  assert.match(html, /data-shared-task-board="golden-master"/);
  assert.match(html, /shared-task-board-empty/);
  assert.doesNotMatch(html, /GM-FIX|WLTK-|TASK-\d+|fixture|Domain Data rows/i);
});

test("AI Board and WorkTodo route Card, Board, Drawer, and binding through the same source", () => {
  const aiRuntime = read("app/Board/ai/board-runtime.js");
  const worktodoRuntime = read("modules/worklog/worklog-app.js");
  const worktodoAdapter = read("modules/worklog/components/worktodo-task-adapter.js");
  assert.match(aiRuntime, /ZhugeGoldenMaster\.renderCard/);
  assert.match(aiRuntime, /ZhugeGoldenMaster\.renderColumns/);
  assert.match(aiRuntime, /ZhugeGoldenMaster\.bindBoard/);
  assert.match(aiRuntime, /ZhugeGoldenMaster\??\.renderDrawer/);
  assert.match(worktodoRuntime, /goldenMaster\??\.renderBoard|foundation\.renderBoard/);
  assert.match(worktodoRuntime, /goldenMaster\??\.bindBoard|boardFoundation\??\.bindBoard/);
  assert.match(worktodoRuntime, /ZhugeGoldenMaster\.renderToolbar/);
  assert.match(worktodoAdapter, /ZhugeGoldenMaster/);
  assert.match(worktodoAdapter, /goldenMaster\??\.renderCard/);
  assert.match(worktodoAdapter, /goldenMaster\??\.renderDrawer/);
  assert.equal(exists("shared/components/golden-master-fixture.js"), false);
  assert.equal(exists("shared/components/golden-master-preview.js"), false);
  assert.equal(exists("shared/theme/golden-master-preview.css"), false);
});
