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
    dataOnly: true
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
  assert.match(goldenMaster, /enableTemplateParity/);
  assert.match(goldenMaster, /filter\(item => !enableTemplateParity \|\| item\.id !== TEMPLATE_PARITY_ACTION\.id\)/);
  assert.match(runtime, /runTemplateParityCheck\("publish"/);
  assert.match(runtime, /runTemplateParityCheck\("adopt"/);
  assert.match(runtime, /runParityGuard: options/);
  assert.match(runtime, /Parity Check 僅 Compare／Detect／Report/);
});

test("the Golden Master owns one parity toolbar action for every consumer", () => {
  const goldenMaster = require(path.join(ROOT, "shared/components/golden-master.js"));
  const markup = goldenMaster.renderToolbar({
    enableTemplateParity: true,
    actions: [
      { id: "healthCheckBtn", label: "檢查資料健康度" },
      { id: "templateParityBtn", label: "Consumer duplicate" }
    ]
  });
  assert.equal((markup.match(/id="templateParityBtn"/g) || []).length, 1);
  assert.match(markup, /data-golden-master-action="template-parity"/);
  assert.match(markup, />與母版比對<\/button>/);
  const legacyMarkup = goldenMaster.renderToolbar({ actions: [{ id: "healthCheckBtn", label: "檢查資料健康度" }] });
  assert.doesNotMatch(legacyMarkup, /templateParityBtn/);
});
