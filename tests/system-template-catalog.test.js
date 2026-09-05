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

test("System Template Catalog keeps one operational C Golden Master", () => {
  const templates = Catalog.list();
  assert.equal(templates.length, 1);
  const template = Catalog.get(Catalog.GOLDEN_MASTER_ID);
  assert.equal(template.id, "ai-board-empty-golden-master");
  assert.equal(template.name, "C 唯一看板母版");
  assert.equal(template.label, "C Operational Motherboard");
  assert.equal(template.type, "canonical-motherboard");
  assert.equal(template.status, "唯一正式母版");
  assert.equal(template.operational, true);
  assert.equal(template.moduleTaskPrefix, "MDTK");
  assert.deepEqual(template.adapters.map(adapter => adapter.label), ["AI Board Adapter", "WorkTodo Adapter", "C Operational Motherboard / MDTK"]);
  assert.deepEqual(template.domainData.map(data => data.label), ["AI Board Domain Data", "WorkTodo Domain Data", "C MDTK Canonical Cloud Data"]);
  assert.equal(template.publishedRelease, "shared/config/template-release.js");
  assert.equal(template.boardInstanceRegistry, "board_instances");
  assert.deepEqual(template.sharedSurfaces, [
    "Shared Navigation / Shell",
    "Shared Header",
    "Shared Toolbar / Search / Filter / Sort",
    "Shared Workspace / Column / Move",
    "Shared Task Card",
    "Shared Task Drawer / Properties",
    "Shared Work Content / Usage Scenario",
    "Shared Checklist / Progress / Activity",
    "Shared General / Progress Attachment",
    "Shared Agreement / Schedule",
    "Shared GPT Analysis",
    "Shared Loading / Busy / Error / Confirm / Refresh",
    "Shared Responsive / Interaction"
  ]);
  assert.deepEqual(template.emptySurface, {
    id: "c-motherboard-surface",
    renderer: "shared-golden-master",
    mode: "operational-motherboard",
    domainData: true,
    fixture: false,
    cloudWrites: true
  });
  assert.deepEqual(template.preview, {
    renderer: "shared-golden-master",
    mode: "operational-motherboard",
    domainData: true,
    fixture: false,
    cloudWrites: true
  });
});

test("C Golden Master catalog describes the published canonical Cloud lifecycle", () => {
  const source = read("shared/components/system-template-catalog.js");
  const template = Catalog.get();
  assert.equal(template.capabilities.catalog, "c-operational-motherboard");
  assert.deepEqual(template.capabilities.empty, { domainData: true, fixture: false, cloudWrites: true });
  assert.equal(template.capabilities.workspace.fixedColumns, false);
  assert.equal(template.capabilities.workspace.source, "board_instances + board_workspaces");
  assert.deepEqual(template.capabilities.workspace.operations, ["add", "edit", "delete", "reorder", "move-task"]);
  assert.deepEqual(template.capabilities.adoptionSwitch, {
    enabled: true,
    state: "published",
    off: "尚未採用已發布 C 母版",
    on: "使用已發布 C 母版與自身資料",
    phase: "Phase 3"
  });
  assert.equal(template.capabilities.clone.enabled, false);
  assert.equal(template.capabilities.apply.enabled, true);
  assert.equal(template.capabilities.apply.state, "published");
  assert.equal(template.persistence.mode, "canonical-supabase-board-instance");
  assert.equal(template.persistence.cloudWrites, true);
  const forbiddenWriteApi = /DataService\s*[.(]|Supabase(?:Repository)?\s*[.(]|localStorage\s*[.(]|sessionStorage\s*[.(]|fetch\s*\(|rpc\s*\(/i;
  assert.doesNotMatch(source, forbiddenWriteApi);
  assert.doesNotMatch(source, /GM-FIX|golden-master-preview|fixtureKey/i);
  assert.match(read("shared/components/c-template-preview.js"), /neutralViewModel/);
  assert.match(read("app/Board/template-preview/index.html"), /canonicalCTemplatePreview/);
});

test("Template Management Center is the single adoption presentation", () => {
  const config = read("shared/app-config.js");
  const router = read("shared/app-router.js");
  const index = read("modules/worklog/index.html");
  const runtime = read("modules/worklog/worklog-app.js");
  const management = read("shared/components/template-management-center.js");
  assert.doesNotMatch(config, /system-templates/);
  assert.doesNotMatch(router, /system-templates/);
  assert.match(index, /shared\/components\/system-template-catalog\.js/);
  assert.match(index, /shared\/components\/template-management-center\.js/);
  assert.match(index, /shared\/components\/golden-master\.js/);
  assert.match(index, /shared\/theme\/golden-master\.css/);
  assert.doesNotMatch(index, /golden-master-fixture|golden-master-preview|golden-master-preview\.css/);
  assert.match(index, /allowedWorkspaces = new Set\(\["dashboard"[\s\S]*"settings"/);
  assert.match(runtime, /ZhugeTemplateManagementCenter\.render\(\)/);
  assert.match(runtime, /data-template-management-center/);
  assert.doesNotMatch(runtime, /function systemTemplates\(|system-template-manager/);
  assert.match(management, /Template Registry/);
  assert.match(management, /Cloud Adoption State/);
  assert.match(management, /data-template-management-switch/);
  assert.match(management, /data-template-management-preview/);
  assert.match(runtime, /onPreview: templateId => openSystemTemplateWindow/);
  assert.doesNotMatch(runtime, /ZhugeGoldenMasterPreview|template\.preview|GM-FIX/);
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

test("Golden Master owns the shared priority presentation decision", () => {
  const drawer = {
    render(options) {
      return JSON.stringify(options.properties || []);
    }
  };
  const html = GoldenMaster.renderDrawer({
    properties: [
      { key: "workspace", label: "工作區", value: "進行中" },
      { key: "priority", label: "優先度", value: "P1" },
      { key: "due-date", label: "約定日期", value: "2026/08/21" },
      { key: "status", label: "目前狀態", value: "進行中" }
    ]
  }, { drawer });

  assert.match(html, /工作區/);
  assert.match(html, /目前狀態/);
  assert.doesNotMatch(html, /優先度/);
  assert.match(html, /約定日期|2026\/08\/21/);
});

test("AI Board and WorkTodo route Card, Board, Drawer, and binding through the same source", () => {
  const aiRuntime = read("shared/components/golden-master-runtime.js");
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
