const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardReadService = require("../shared/board/board-read-service.js");

test("C route loads the canonical Cloud MDTK host and shared runtime", () => {
  const html = read("app/Board/template-preview/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(html, /data-template-page-id="template-c"/);
  assert.doesNotMatch(html, /shared\/services\/c-mtdk-store\.js/);
  assert.match(html, /shared\/board\/board-read-service\.js/);
  assert.match(html, /shared\/supabase\/supabase-gateway\.js/);
  assert.match(html, /shared\/components\/task-action-adapters\.js/);
  assert.doesNotMatch(html, /worklog-app|repositories\.js|data-service\.js/);
  assert.match(runtime, /applicationScope === "c"/);
  assert.doesNotMatch(runtime, /ZhugeCTemplateMDTKStore/);
});

test("C service resolves the registry and uses the generic board contract", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "board_resolve_template_instance") {
        return { id: "c-instance", task_code_prefix: "MDTK", template_key: "c", authorization_mode: "owner", owner_uuid: "owner" };
      }
      if (name === "board_instance_create_task") {
        return { id: "mdtk-task-1", board_instance_id: "c-instance", work_code: "MDTK-001", title: args.p_title, status: args.p_status, workspace_id: "mdtk-todo" };
      }
      if (name === "board_instance_create_workspace") {
        return { id: "mdtk-workspace-1", board_instance_id: "c-instance", workspace_key: args.p_workspace_key, name: args.p_name, sort_order: 60, active: true };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const service = BoardReadService.createInstanceService({ gateway, templateKey: "c" });
  const task = await service.createTask({ title: "MDTK Cloud task", summary: "canonical" });
  const workspace = await service.createWorkspace("MDTK QA");
  assert.equal(task.boardInstanceId, "c-instance");
  assert.equal(task.applicationScope, "c");
  assert.equal(task.workCode, "MDTK-001");
  assert.equal(workspace.boardInstanceId, "c-instance");
  assert.match(workspace.key, /^mdtk-custom-/);
  assert.deepEqual(calls.map(call => call.name), [
    "board_resolve_template_instance",
    "board_instance_create_task",
    "board_instance_create_workspace"
  ]);
  assert.equal(calls[1].args.p_board_instance_id, "c-instance");
});
