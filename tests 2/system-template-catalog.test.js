const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Catalog = require("../shared/components/system-template-catalog.js");
const Board = require("../shared/components/task-board.js");
const Card = require("../shared/components/task-card.js");
const Drawer = require("../shared/components/task-drawer.js");
const Fixture = require("../shared/components/golden-master-fixture.js");
const Preview = require("../shared/components/golden-master-preview.js");

test("System Template Catalog keeps one AI Board Golden Master", () => {
  const templates = Catalog.list();
  assert.equal(templates.length, 1);
  const template = Catalog.get(Catalog.GOLDEN_MASTER_ID);
  assert.equal(template.id, "ai-board-empty-golden-master");
  assert.equal(template.name, "空白 AI Board");
  assert.equal(template.status, "唯一正式模板");
  assert.deepEqual(template.adapters.map(adapter => adapter.label), ["AI Board Adapter", "WorkTodo Adapter"]);
  assert.deepEqual(template.domainData.map(data => data.label), ["AI Board Domain Data", "WorkTodo Domain Data"]);
  assert.deepEqual(template.sharedSurfaces, [
    "Shared Shell / Header",
    "Shared Task Board",
    "Shared Task Card",
    "Shared Task Drawer",
    "Shared Toolbar / Workspace Contract",
    "Work Journal Timeline"
  ]);
});

test("System Template Catalog reserves multi-template actions without writes", () => {
  const source = read("shared/components/system-template-catalog.js");
  const template = Catalog.get();
  assert.equal(template.capabilities.catalog, "multi-template-ready");
  assert.equal(template.capabilities.preview.fixtureOnly, true);
  assert.equal(template.capabilities.preview.readOnly, true);
  assert.equal(template.capabilities.preview.cloudWrites, false);
  assert.equal(template.capabilities.workspace.fixedColumns, false);
  assert.deepEqual(template.capabilities.workspace.operations, ["add", "edit", "delete", "reorder", "move-task"]);
  assert.equal(template.capabilities.clone.enabled, false);
  assert.equal(template.capabilities.apply.enabled, false);
  assert.equal(template.persistence.cloudWrites, false);
  const forbiddenWriteApi = /DataService\s*[.(]|Supabase(?:Repository)?\s*[.(]|localStorage\s*[.(]|sessionStorage\s*[.(]|fetch\s*\(|rpc\s*\(/i;
  assert.doesNotMatch(source, forbiddenWriteApi);
  assert.doesNotMatch(read("shared/components/golden-master-fixture.js"), forbiddenWriteApi);
  assert.doesNotMatch(read("shared/components/golden-master-preview.js"), forbiddenWriteApi);
});

test("System Template Manager is routed from Control Center", () => {
  const config = read("shared/app-config.js");
  const router = read("shared/app-router.js");
  const index = read("modules/worklog/index.html");
  const runtime = read("modules/worklog/worklog-app.js");
  assert.match(config, /"system-templates": \{ icon: "🧩", label: "系統模板"/);
  assert.match(router, /"system-templates"/);
  assert.match(index, /shared\/components\/system-template-catalog\.js/);
  assert.match(index, /shared\/components\/golden-master-fixture\.js/);
  assert.match(index, /shared\/components\/golden-master-preview\.js/);
  assert.match(index, /shared\/theme\/golden-master-preview\.css/);
  assert.match(index, /allowedWorkspaces = new Set\(\["dashboard"[\s\S]*"system-templates"/);
  assert.match(runtime, /\["system-templates", "🧩", "系統模板"/);
  assert.match(runtime, /if \(activeWorkspace === "system-templates"\) return systemTemplates\(\);/);
  assert.match(runtime, /data-open-workspace="sync">返回控制台/);
});

test("System Template Manager uses the shared Golden Master Preview Renderer", () => {
  const runtime = read("modules/worklog/worklog-app.js");
  const manager = runtime.match(/function systemTemplates\(\) \{[\s\S]*?\n\}\n\nfunction nextKnowledgeId/);
  assert.ok(manager, "systemTemplates function should be present");
  assert.match(manager[0], /ZhugeGoldenMasterPreview/);
  assert.match(manager[0], /template\.preview\.fixtureKey/);
  assert.doesNotMatch(manager[0], /template\.preview\.columns/);
  assert.match(manager[0], /data-template-action/);
  assert.match(manager[0], /disabled aria-disabled="true"/);
  assert.doesNotMatch(manager[0], /DataService\s*[.(]|Supabase(?:Repository)?\s*[.(]|localStorage\s*[.(]|sessionStorage\s*[.(]|fetch\s*\(|rpc\s*\(/i);
});

test("Golden Master Preview renders the complete fixture through shared Board/Card/Drawer", () => {
  const fixture = Fixture.get();
  assert.equal(fixture.id, Fixture.FIXTURE_ID);
  const html = Preview.render({
    fixture,
    board: Board,
    card: Card,
    drawer: Drawer,
    shell: { renderHeader: options => `<header class="zhuge-shared-header"><h2>${options.title}</h2><p>${options.description}</p>${options.actionMarkup || ""}</header>` }
  });
  assert.match(html, /data-golden-master-preview/);
  assert.match(html, /data-mounted="true"/);
  assert.match(html, /data-shared-task-board="ai-board-golden-master-preview"/);
  assert.equal((html.match(/data-shared-task-board-column=/g) || []).length, 4);
  assert.match(html, /data-golden-master-preview-card="gm-fixture-task"/);
  assert.match(html, /data-shared-task-drawer/);
  assert.match(html, /data-shared-task-properties/);
  assert.match(html, /Checklist/);
  assert.match(html, /golden-master-preview-analysis/);
  assert.match(html, /data-shared-task-timeline/);
  assert.match(html, /golden-master-fixture-spec\.md/);
});
