const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardReadService = require("../shared/board/board-read-service.js");
const GoldenMaster = require("../shared/components/golden-master.js");

function navigationApi() {
  const listeners = {};
  const document = {
    readyState: "loading",
    body: null,
    addEventListener(name, handler) { listeners[name] = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return {}; }
  };
  const window = {
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia() { return { matches: false }; },
    ZhugeFoundationConfig: { version: { version: "0.9.0-alpha.9.13", build: "20260829-1024" } }
  };
  const context = { window, document, MutationObserver: undefined, console };
  vm.runInNewContext(read("shared/components/zhuge-navigation.js"), context, { filename: "zhuge-navigation.js" });
  return window.ZhugeSharedNavigation;
}

test("Legacy generic C provisioning is fail-closed and never reaches Cloud", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      throw new Error(`unexpected legacy RPC: ${name}`);
    }
  };
  await assert.rejects(
    () => BoardReadService.provisionConsumer({ name: "QA Template Board", prefix: "QAT", templateKey: "c" }, { gateway }),
    error => error.code === "C_CONSUMER_PROVISION_LEGACY_RETIRED"
  );
  assert.deepEqual(calls, []);
});

test("Legacy C provisioning ACL retirement preserves only controlled service access", () => {
  const retirement = read("docs/supabase/20260915_retire_legacy_c_provisioning.sql");
  assert.match(retirement, /revoke all on function public\.board_provision_consumer\(\s*text,\s*text,\s*text\s*\)\s+from public, anon, authenticated/i);
  assert.match(retirement, /grant execute on function public\.board_provision_consumer\(\s*text,\s*text,\s*text\s*\)\s+to service_role/i);
  assert.match(retirement, /historical|maintenance/i);
});

test("Generic C board registry only exposes active non-template C consumers", async () => {
  const gateway = {
    async select(table, query) {
      assert.equal(table, "board_instances");
      assert.match(query, /is_template_instance=eq\.false/);
      assert.match(query, /legacy_application_scope=is.null/);
      assert.match(query, /template_key=eq\.c/);
      return [
        { id: "qa", name: "QA Template Board", task_code_prefix: "QAT", template_key: "c", active: true, is_template_instance: false },
        { id: "mother", name: "C 母版", task_code_prefix: "MDTK", template_key: "c", active: true, is_template_instance: true },
        { id: "legacy", name: "Legacy", task_code_prefix: "TASK", template_key: "c", active: true, is_template_instance: false, legacy_application_scope: "ai_board" }
      ];
    }
  };
  const boards = await BoardReadService.listBoardInstances({ gateway });
  assert.deepEqual(boards.map(board => board.id), ["qa"]);
  assert.equal(boards[0].taskCodePrefix, "QAT");
});

test("Generic module consumer status reads the full registry identity set", async () => {
  const gateway = {
    async select(table, query) {
      assert.equal(table, "board_instances");
      assert.match(query, /template_key=eq\.c/);
      return [
        { id: "mother", name: "C 母版測試", task_code_prefix: "MDTK", template_key: "c", active: true, is_template_instance: true },
        { id: "worktodo-instance", name: "工作待辦", task_code_prefix: "WLTK", template_key: "c", active: true, is_template_instance: false, legacy_application_scope: "worktodo" },
        { id: "ai-instance", name: "AI Board", task_code_prefix: "TASK", template_key: "c", active: true, is_template_instance: false, legacy_application_scope: "ai_board" },
        { id: "qa-instance", name: "QA Template Board", task_code_prefix: "QAT", template_key: "c", active: true, is_template_instance: false },
      ];
    }
  };
  const consumers = await BoardReadService.listModuleConsumers({ templateKey: "c", gateway });
  assert.deepEqual(consumers.map(consumer => consumer.consumerId), ["c", "worktodo", "ai-board", "qa-instance"]);
  assert.equal(consumers[3].consumerLabel, "QA Template Board");
});

test("C Runtime exposes name/prefix provisioning without a consumer-specific source path", () => {
  const header = GoldenMaster.renderHeaderActions({ applicationScope: "c", canCreateConsumer: true });
  const operations = GoldenMaster.renderOperations({ applicationScope: "c", itemLabel: "MDTK", canCreateConsumer: true });
  assert.match(header, /data-board-create-consumer/);
  assert.match(header, /建立看板/);
  assert.match(operations, /id="consumerBoardName"/);
  assert.match(operations, /id="consumerBoardPrefix"/);
  assert.match(operations, /建立並套用 C 母版/);
  assert.match(operations, /data-consumer-create-status|id="consumerCreateStatus"/);
  assert.doesNotMatch(operations, /c-mtdk-store|localStorage/);
});

test("Shared Navigation renders registry-driven C consumer routes", () => {
  const navigation = navigationApi();
  const rendered = navigation.render({
    externalRoot: "/",
    boardInstances: [{ id: "qa-instance", name: "QA Template Board", taskCodePrefix: "QAT", templateKey: "c", active: true }],
    activeBoardInstanceId: "qa-instance",
    version: "0.9.0-alpha.9.13",
    build: "20260829-1024"
  });
  assert.match(rendered, /套用的看板/);
  assert.match(rendered, /class="side-item-label">QA Template Board<\/span>/);
  assert.doesNotMatch(rendered, /QA Template Board（QAT）/);
  assert.match(rendered, /boardInstanceId=qa-instance/);
  assert.match(rendered, /class="side-item on/);
});

test("Provisioning migration is atomic, generic, and initializes the C default workspace set", () => {
  const migration = read("docs/supabase/20260829_generic_c_consumer_provisioning.sql");
  assert.match(migration, /create or replace function public\.board_provision_consumer/);
  assert.match(migration, /grant execute on function public\.board_provision_consumer\(text, text, text\) to authenticated/);
  assert.match(migration, /'待辦'/);
  assert.match(migration, /'進行中'/);
  assert.match(migration, /'待驗收'/);
  assert.match(migration, /'已完成'/);
  assert.match(migration, /'status', 'adopted'/);
  assert.match(migration, /v_instance\.id::text/);
  assert.match(migration, /commit;/i);
  assert.doesNotMatch(migration, /insert into public\.board_tasks/);
});

test("Generic consumer creation closes the anonymous low-level instance ACL", () => {
  const security = read("docs/supabase/20260829_harden_board_instance_creation_security.sql");
  assert.match(security, /revoke execute on function public\.board_create_instance\(text, text, text\)/);
  assert.match(security, /from public, anon, authenticated, service_role/);
  assert.match(security, /grant execute on function public\.board_create_instance\(text, text, text\)\s+to postgres/);
  assert.doesNotMatch(security, /grant execute[\s\S]*to authenticated/);
});

const identityKeys = ["boardInstanceId", "name", "taskCodePrefix", "templateKey", "projectAssignment", "legacyApplicationScope", "isTemplateInstance", "consumerId", "consumerRole", "legacyCompatibilityIdentity", "identityResolved"];
const identityOf = value => Object.fromEntries(identityKeys.map(key => [key, value[key]]));

for (const assignment of [null, "worklog", "investment"]) {
  test(`Consumer identity is stable across all service entries: ${assignment || "unassigned"}`, async () => {
    const row = { id: "consumer-fixture", name: "任意名稱", task_code_prefix: "IVTK", template_key: "c", project_assignment: assignment, legacy_application_scope: null, is_template_instance: false, active: true };
    const gateway = { async select(table, query) {
      if (table === "board_instances") {
        if (!query.includes("select=*")) assert.match(query, /project_assignment/);
        return [row];
      }
      assert.match(query, /board_instance_id=eq.consumer-fixture/);
      return [];
    }, async rpc() { throw new Error("Read-only identity projection must not mutate Cloud"); } };
    const previous = global.getSharedSessionSnapshot;
    global.getSharedSessionSnapshot = () => ({ isAuthenticated: true });
    try {
      const normalized = BoardReadService.normalizeBoardInstance(row);
      const [listed] = await BoardReadService.listBoardInstances({ gateway });
      const [consumer] = await BoardReadService.listModuleConsumers({ gateway });
      const service = BoardReadService.createInstanceService({ gateway, boardInstanceId: row.id, consumerId: "stale-caller-identity", readOnly: true });
      assert.equal(service.requestedConsumerId, "stale-caller-identity");
      assert.equal(Object.hasOwn(service, "consumerId"), false);
      const loaded = await service.load();
      assert.equal(Object.hasOwn(service, "consumerId"), false);
      assert.equal(service.requestedConsumerId, "stale-caller-identity");
      for (const projection of [listed, consumer, loaded]) assert.deepEqual(identityOf(projection), identityOf(normalized));
      assert.equal(loaded.consumerRole, "generic-consumer");
      assert.equal(loaded.consumerId, row.id);
      assert.equal(loaded.projectAssignment, assignment || "");
      const renamed = BoardReadService.normalizeBoardInstance({ ...row, name: "C 母版", task_code_prefix: "GAS" });
      assert.equal(renamed.consumerId, normalized.consumerId);
      assert.equal(renamed.consumerRole, normalized.consumerRole);
    } finally {
      if (previous === undefined) delete global.getSharedSessionSnapshot;
      else global.getSharedSessionSnapshot = previous;
    }
  });
}

test("Legacy compatibility derives from persisted role/scope, never prefix", async () => {
  const rows = [
    { id: "mother-fixture", is_template_instance: true, legacy_application_scope: null, task_code_prefix: "OTHER" },
    { id: "ai-fixture", is_template_instance: false, legacy_application_scope: "ai_board", task_code_prefix: "OTHER" },
    { id: "worktodo-fixture", is_template_instance: false, legacy_application_scope: "worktodo", task_code_prefix: "OTHER" },
    { id: "gas-fixture", is_template_instance: false, legacy_application_scope: "procurement", task_code_prefix: "GAS" },
    { id: "investment-fixture", is_template_instance: false, legacy_application_scope: null, task_code_prefix: "IVTK" },
    { id: "personal-fixture", is_template_instance: false, legacy_application_scope: "worktodo-user-fixture", task_code_prefix: "PERSONAL" }
  ].map(row => ({ ...row, template_key: "c", name: "任意名稱", active: true }));
  const projections = await BoardReadService.listModuleConsumers({ gateway: { async select() { return rows; } } });
  assert.deepEqual(projections.map(row => row.consumerId), ["c", "ai-board", "worktodo", "procurement", "investment-fixture", "worktodo-user-fixture"]);
  assert.deepEqual(projections.map(row => row.consumerRole), ["mother", "legacy-adopter", "legacy-adopter", "legacy-adopter", "generic-consumer", "legacy-adopter"]);
  const previous = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = () => ({ isAuthenticated: true });
  try {
    for (const row of rows) {
      const gateway = { async select(table) { return table === "board_instances" ? [row] : []; } };
      const loaded = await BoardReadService.createInstanceService({ gateway, boardInstanceId: row.id, readOnly: true }).load();
      assert.deepEqual(identityOf(loaded), identityOf(projections.find(item => item.id === row.id)));
    }
  } finally {
    if (previous === undefined) delete global.getSharedSessionSnapshot;
    else global.getSharedSessionSnapshot = previous;
  }
});

test("Incomplete identity cannot be guessed as Mother or Generic", async () => {
  for (const row of [{}, { id: "unknown", template_key: "c" }, { id: "unknown", is_template_instance: false }]) {
    const normalized = BoardReadService.normalizeBoardInstance(row);
    assert.equal(normalized.identityResolved, false);
    assert.equal(normalized.consumerRole, "unknown");
    assert.equal(normalized.consumerId, "");
    const gateway = { async select() { return [row]; } };
    assert.deepEqual(await BoardReadService.listBoardInstances({ gateway }), []);
    assert.deepEqual(await BoardReadService.listModuleConsumers({ gateway }), []);
    if (row.id) await assert.rejects(BoardReadService.createInstanceService({ gateway, boardInstanceId: row.id, readOnly: true }).load(), { code: "BOARD_INSTANCE_IDENTITY_UNRESOLVED" });
  }
});
