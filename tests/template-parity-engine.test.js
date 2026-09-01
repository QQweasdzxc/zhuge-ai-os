const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const engine = require(path.join(ROOT, "shared/components/template-parity-engine.js"));
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("C is the only parity baseline and exposes the full semantic capability inventory", () => {
  const inventory = engine.canonicalInventory();
  assert.equal(inventory.baseline, "C Mother Template");
  assert.equal(inventory.capabilities.length, 15);
  assert.deepEqual(inventory.capabilities.map(item => item.id), engine.expectedCapabilities().map(item => item.id));
  assert.equal(inventory.capabilities.some(item => item.id === "consumer-to-consumer"), false);
  assert.equal(inventory.capabilities.find(item => item.id === "data-boundary").contract.compareDirection, "consumer-to-c");
  const drawer = inventory.capabilities.find(item => item.id === "drawer");
  assert.deepEqual(drawer.contract.agreementScheduleFrame, {
    key: "agreement-schedule",
    framework: "shared-task-drawer-property",
    label: "約定日期／約定期間",
    editor: "controlled-shared-agreement-date-editor",
    dataIndependent: true
  });
});

test("same capability count with a different semantic fingerprint is a template Gap", () => {
  const baseline = engine.createInventory([
    { id: "card", label: "Card", fingerprint: "fp-card-c" },
    { id: "drawer", label: "Drawer", fingerprint: "fp-drawer-c" }
  ], { baseline: "C Mother Template" });
  const consumer = engine.createInventory([
    { id: "card", label: "Card", fingerprint: "fp-card-consumer" },
    { id: "drawer", label: "Drawer", fingerprint: "fp-drawer-c" }
  ], { baseline: "AI Board" });
  const report = engine.compare(baseline, consumer);
  assert.equal(report.motherCount, 2);
  assert.equal(report.consumerCount, 2);
  assert.equal(report.matchCount, 1);
  assert.equal(report.gapCount, 1);
  assert.equal(report.fingerprint, "MISMATCH");
  assert.deepEqual(report.differences.map(item => item.type), ["mismatch"]);
  assert.equal(report.inventory.find(item => item.id === "card").status, "DIFFERENT");
  assert.equal(report.inventory.find(item => item.id === "drawer").status, "MATCH");
  assert.match(report.differences[0].detail, /Fingerprint／Behavior/);
});

test("missing and extra capabilities are reported separately with readable differences", () => {
  const baseline = engine.createInventory([
    { id: "card", label: "Card", fingerprint: "fp-card" },
    { id: "drawer", label: "Drawer", fingerprint: "fp-drawer" }
  ], { baseline: "C Mother Template" });
  const consumer = engine.createInventory([
    { id: "card", label: "Card", fingerprint: "fp-card" },
    { id: "custom", label: "Consumer 私有模板能力", fingerprint: "fp-custom" }
  ], { baseline: "WorkTodo" });
  const report = engine.compare(baseline, consumer);
  assert.equal(report.gapCount, 2);
  assert.deepEqual(report.differences.map(item => item.type), ["missing", "extra"]);
  assert.equal(report.inventory.find(item => item.id === "drawer").status, "MISSING");
  assert.equal(report.inventory.find(item => item.id === "custom").status, "EXTRA");
  assert.match(engine.formatReport(report), /Template Gap：2/);
  assert.match(engine.formatReport(report), /Consumer 私有模板能力/);
});

test("a missing C Drawer agreement-date frame is a real template Gap", () => {
  const baseline = engine.canonicalInventory();
  const consumerContracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));
  const { agreementScheduleFrame: _removed, ...drawerWithoutSchedule } = consumerContracts.drawer;
  consumerContracts.drawer = drawerWithoutSchedule;
  const consumer = engine.collectConsumerInventory({ baseline: "AI Board", consumerId: "ai-board", contracts: consumerContracts });
  const report = engine.compare(baseline, consumer);
  const drawer = report.inventory.find(item => item.id === "drawer");
  assert.equal(drawer.status, "DIFFERENT");
  assert.equal(report.gapCount, 1);
  assert.match(engine.formatReport(report), /DIFFERENT｜Drawer/);
});

test("the 15 categories expand into a complete recursive machine inventory", () => {
  const contracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));
  const report = engine.runManual({ contracts, consumerId: "ai-board", consumerLabel: "AI Board" });
  const drawer = report.inventory.find(item => item.id === "drawer");
  const agreement = drawer.children.find(item => item.id === "drawer.agreementScheduleFrame");
  assert.equal(report.motherCount, 15);
  assert.ok(report.machineMotherCount > report.motherCount);
  assert.equal(report.machineGapCount, 0);
  assert.equal(report.machineMatchCount, report.machineMotherCount);
  assert.equal(agreement.status, "MATCH");
  assert.ok(agreement.children.some(item => item.id === "drawer.agreementScheduleFrame.key"));
  assert.match(engine.formatReport(report), /完整機器比對/);
  assert.match(engine.formatReport(report), /drawer\.agreementScheduleFrame/);
});

test("recursive machine comparison reports child MISSING, EXTRA, and DIFFERENT", () => {
  const baseline = engine.canonicalInventory();
  const baseContracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));

  const missingContracts = JSON.parse(JSON.stringify(baseContracts));
  delete missingContracts.drawer.agreementScheduleFrame;
  const missing = engine.compare(baseline, engine.collectConsumerInventory({ contracts: missingContracts, baseline: "AI Board" }));
  assert.ok(missing.differenceDetails.some(item => item.status === "MISSING" && item.path === "agreementScheduleFrame"));
  assert.equal(missing.gapCount, 1);

  const extraContracts = JSON.parse(JSON.stringify(baseContracts));
  extraContracts.card.consumerOnlyTemplateChild = { renderer: "consumer-private" };
  const extra = engine.compare(baseline, engine.collectConsumerInventory({ contracts: extraContracts, baseline: "WorkTodo" }));
  assert.ok(extra.differenceDetails.some(item => item.status === "EXTRA" && item.path === "consumerOnlyTemplateChild"));
  assert.equal(extra.gapCount, 1);

  const differentContracts = JSON.parse(JSON.stringify(baseContracts));
  differentContracts.drawer.agreementScheduleFrame.editor = "different-editor";
  const different = engine.compare(baseline, engine.collectConsumerInventory({ contracts: differentContracts, baseline: "QAT" }));
  assert.ok(different.differenceDetails.some(item => item.status === "DIFFERENT" && item.path === "agreementScheduleFrame.editor"));
  assert.equal(different.gapCount, 1);
});

test("same top-level count with different child content is not a false 100% match", () => {
  const baseContracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));
  const consumerContracts = JSON.parse(JSON.stringify(baseContracts));
  consumerContracts.card.renderer = "ConsumerCard.render";
  const report = engine.compare(engine.canonicalInventory(), engine.collectConsumerInventory({ contracts: consumerContracts, baseline: "AI Board" }));
  assert.equal(report.motherCount, 15);
  assert.equal(report.consumerCount, 15);
  assert.equal(report.inventory.find(item => item.id === "card").status, "DIFFERENT");
  assert.ok(report.differenceDetails.some(item => item.status === "DIFFERENT" && item.path === "renderer"));
  assert.equal(report.fingerprint, "MISMATCH");
});

test("the runtime probe independently detects a Drawer agreement-date frame that is not rendered", () => {
  const root = {
    ZhugeGoldenMaster: {},
    ZhugeSharedTaskBoard: {},
    ZhugeSharedTaskCard: { render: () => '<div class="shared-task-card-title"></div>' },
    ZhugeSharedTaskDrawer: { render: () => '<div data-shared-task-region="activity"></div>' },
    ZhugeSharedTaskActionContract: { ACTIONS: [] },
    ZhugeBoardRuntime: {}
  };
  const document = { querySelector: () => null };
  const consumer = engine.collectConsumerInventory({ root, document, baseline: "AI Board" });
  const report = engine.compare(engine.canonicalInventory(), consumer);
  const drawer = report.inventory.find(item => item.id === "drawer");
  assert.equal(drawer.children.find(item => item.id === "drawer.agreementScheduleFrame").status, "MISSING");
  assert.ok(report.differenceDetails.some(item => item.status === "MISSING" && item.path === "agreementScheduleFrame"));
  assert.notEqual(report.fingerprint, "MATCH");
});

test("a complete report exposes every capability with an explicit status", () => {
  const contracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));
  const report = engine.runManual({ contracts, consumerId: "q-at", consumerLabel: "QAT" });
  assert.equal(report.inventory.length, 15);
  assert.equal(report.inventory.every(item => ["MATCH", "MISSING", "EXTRA", "DIFFERENT"].includes(item.status)), true);
  assert.equal(report.inventory.filter(item => item.status === "MATCH").length, 15);
  assert.match(engine.formatReport(report), /Capability Inventory：/);
  assert.equal((engine.formatReport(report).match(/^- MATCH｜/gm) || []).length, 15);
});

test("data, workspace, card content, and identity are explicitly ignored by the template comparison", () => {
  const baseline = engine.canonicalInventory();
  const consumer = engine.collectConsumerInventory({
    baseline: "WorkTodo",
    consumerId: "worktodo",
    contracts: Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract])),
    data: { title: "different card content", workspace: "different workspace", identity: "different identity" }
  });
  const report = engine.compare(baseline, consumer);
  assert.equal(report.gapCount, 0);
  assert.deepEqual(report.ignoredData, ["data", "workspace", "card-content", "identity"]);
});

test("manual and automatic guards use the same Compare path and never repair", () => {
  const contracts = Object.fromEntries(engine.expectedCapabilities().map(item => [item.id, item.contract]));
  const options = { contracts, consumerId: "ai-board", consumerLabel: "AI Board" };
  const manual = engine.runManual(options);
  const automatic = engine.runAutoGuard({ ...options, trigger: "regression" });
  assert.equal(manual.gapCount, 0);
  assert.equal(automatic.gapCount, 0);
  assert.equal(manual.motherCount, automatic.motherCount);
  assert.deepEqual(manual.differences, automatic.differences);
  assert.equal(manual.trigger, "manual");
  assert.equal(automatic.trigger, "regression");
  assert.equal(typeof engine.repair, "undefined");
});

test("the three formal Board pages load one shared Parity Engine before the shared runtime", () => {
  for (const file of ["app/Board/template-preview/index.html", "app/Board/ai/index.html", "app/Board/worktodo/index.html"]) {
    const html = read(file);
    const parityIndex = html.indexOf("shared/components/template-parity-engine.js");
    const runtimeIndex = html.indexOf("shared/components/golden-master-runtime.js");
    assert.ok(parityIndex >= 0, `${file} must load the shared parity engine`);
    assert.ok(runtimeIndex > parityIndex, `${file} must load the parity engine before the runtime`);
  }
  const goldenMaster = read("shared/components/golden-master.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(goldenMaster, /id: "templateParityBtn"/);
  assert.match(goldenMaster, /data-golden-master-action/);
  assert.match(goldenMaster, /data-golden-master-status-menu/);
  assert.match(goldenMaster, /data-template-release-popover/);
  assert.match(runtime, /runTemplateParityCheck\("publish"/);
  assert.match(runtime, /runTemplateParityCheck\("adopt"/);
  assert.match(runtime, /runParityGuard: options/);
  assert.match(runtime, /Parity Check 僅 Compare／Detect／Report/);
  assert.match(runtime, /includeSearch: false/);
  assert.match(runtime, /data-golden-master-search-toggle/);
  assert.match(runtime, /data-golden-master-search-clear/);
  assert.match(runtime, /boardSearchPanel/);
  assert.match(runtime, /bannerDismissTimer/);
  assert.match(runtime, /setTimeout\(\(\) =>/);
  const css = read("shared/theme/golden-master.css");
  assert.match(css, /golden-master-tab-tools/);
  assert.match(css, /board-read-status\[data-state="success"\]\{position:fixed/);
});

test("the Golden Master owns one shared status-menu action set for every consumer", () => {
  const goldenMaster = require(path.join(ROOT, "shared/components/golden-master.js"));
  const markup = goldenMaster.renderHeaderActions({ applicationScope: "worktodo" });
  assert.equal((markup.match(/id="templateParityBtn"/g) || []).length, 1);
  assert.equal((markup.match(/id="healthCheckBtn"/g) || []).length, 1);
  assert.equal((markup.match(/id="refreshBoardBtn"/g) || []).length, 1);
  assert.equal((markup.match(/data-golden-master-status-menu/g) || []).length, 1);
  assert.match(markup, /data-golden-master-action="template-parity"/);
  assert.match(markup, /⇄ 與母版比對<\/button>/);
  assert.match(markup, /資料健康檢查（唯讀）<\/button>/);
  const toolbarMarkup = goldenMaster.renderToolbar({ actions: [{ id: "templateParityBtn", label: "Consumer duplicate" }] });
  assert.doesNotMatch(toolbarMarkup, /templateParityBtn/);
  assert.doesNotMatch(toolbarMarkup, /data-template-release-popover/);
  assert.doesNotMatch(goldenMaster.renderToolbar({ includeSearch: false, searchId: "boardSearch" }), /id="boardSearch"/);
});
