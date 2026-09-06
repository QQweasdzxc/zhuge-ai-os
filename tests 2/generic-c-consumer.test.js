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

test("Generic C provisioning is a single authenticated Cloud contract", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { board_instance_id: "qa-instance" };
    }
  };
  const result = await BoardReadService.provisionConsumer({ name: "QA Template Board", prefix: "QAT", templateKey: "c" }, { gateway });
  assert.deepEqual(result, { board_instance_id: "qa-instance" });
  assert.deepEqual(calls, [{
    name: "board_provision_consumer",
    args: { p_name: "QA Template Board", p_task_code_prefix: "QAT", p_template_key: "c" }
  }]);
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
  assert.match(rendered, /QA Template Board（QAT）/);
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
