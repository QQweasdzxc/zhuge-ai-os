const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Catalog = require("../shared/components/system-template-catalog.js");
const Board = require("../shared/components/task-board.js");

test("System Template Catalog keeps one AI Board Golden Master", () => {
  const templates = Catalog.list();
  assert.equal(templates.length, 1);
  const template = Catalog.get(Catalog.GOLDEN_MASTER_ID);
  assert.equal(template.id, "ai-board-empty-golden-master");
  assert.equal(template.name, "空白 AI Board");
  assert.equal(template.status, "唯一正式模板");
  assert.deepEqual(template.adapters.map(adapter => adapter.label), ["AI Board Adapter", "WorkTodo Adapter"]);
  assert.deepEqual(template.domainData.map(data => data.label), ["AI Board Domain Data", "WorkTodo Domain Data"]);
  assert.deepEqual(template.sharedSurfaces, ["Shared Task Board", "Shared Task Card", "Shared Task Drawer", "Work Journal Timeline"]);
});

test("System Template Catalog reserves multi-template actions without writes", () => {
  const source = read("shared/components/system-template-catalog.js");
  const template = Catalog.get();
  assert.equal(template.capabilities.catalog, "multi-template-ready");
  assert.equal(template.capabilities.clone.enabled, false);
  assert.equal(template.capabilities.apply.enabled, false);
  assert.equal(template.persistence.cloudWrites, false);
  assert.doesNotMatch(source, /supabase|DataService|localStorage|sessionStorage|fetch\s*\(|rpc\s*\(/i);
});

test("System Template Manager is routed from Control Center", () => {
  const config = read("shared/app-config.js");
  const router = read("shared/app-router.js");
  const index = read("modules/worklog/index.html");
  const runtime = read("modules/worklog/worklog-app.js");
  assert.match(config, /"system-templates": \{ icon: "🧩", label: "系統模板"/);
  assert.match(router, /"system-templates"/);
  assert.match(index, /shared\/components\/system-template-catalog\.js/);
  assert.match(index, /allowedWorkspaces = new Set\(\["dashboard"[\s\S]*"system-templates"/);
  assert.match(runtime, /\["system-templates", "🧩", "系統模板"/);
  assert.match(runtime, /if \(activeWorkspace === "system-templates"\) return systemTemplates\(\);/);
  assert.match(runtime, /data-open-workspace="sync">返回控制台/);
});

test("System Template Manager reuses the shared empty Task Board preview", () => {
  const runtime = read("modules/worklog/worklog-app.js");
  const manager = runtime.match(/function systemTemplates\(\) \{[\s\S]*?\n\}\n\nfunction nextKnowledgeId/);
  assert.ok(manager, "systemTemplates function should be present");
  assert.match(manager[0], /ZhugeSharedTaskBoard/);
  assert.match(manager[0], /template\.preview\.columns/);
  assert.match(manager[0], /data-template-action/);
  assert.match(manager[0], /disabled aria-disabled="true"/);
  assert.doesNotMatch(manager[0], /DataService|SupabaseRepository|localStorage|sessionStorage|fetch\s*\(|rpc\s*\(/i);

  const html = Board.render({
    boardKey: "ai-board-golden-master-preview",
    columns: [{ id: "empty-template-preview", name: "空白工作區", readOnly: true, reorderable: false, cards: [], emptyText: "Golden Master 不含任何 Domain Data。" }]
  });
  assert.match(html, /data-shared-task-board="ai-board-golden-master-preview"/);
  assert.match(html, /data-read-only="true"/);
  assert.match(html, /Golden Master/);
});
