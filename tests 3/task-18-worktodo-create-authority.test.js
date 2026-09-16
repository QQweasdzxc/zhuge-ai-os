const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("WorkTodo Assistant create is routed through the shared C board-instance writer", async () => {
  const calls = [];
  const gateway = {
    select: async (table, query) => {
      calls.push({ type: "select", table, query });
      if (table === "board_instances") {
        return [{ id: "worktodo-board", legacy_application_scope: "worktodo", task_code_prefix: "WLTK", active: true }];
      }
      if (table === "board_workspaces") {
        return [{ id: "worktodo-default", workspace_key: "worktodo-todo", active: true, sort_order: 10 }];
      }
      return [];
    },
    rpc: async (name, params) => {
      calls.push({ type: "rpc", name, params });
      assert.equal(name, "board_instance_create_task");
      return {
        id: "task-created-by-c",
        board_instance_id: params.p_board_instance_id,
        workspace_id: params.p_workspace_id,
        work_code: "WLTK-999",
        title: params.p_title,
        status: params.p_status,
        usage_scenario: params.p_usage_scenario
      };
    }
  };

  const created = await BoardRead.createCanonicalWorkTodoTask({
    title: "AI Assistant task",
    status: "not_started",
    usageScenario: "AI Assistant"
  }, { gateway });

  assert.equal(created.boardInstanceId, "worktodo-board");
  assert.equal(created.workspaceId, "worktodo-default");
  assert.equal(created.workCode, "WLTK-999");
  assert.deepEqual(calls.filter(call => call.type === "rpc").map(call => call.name), ["board_instance_create_task"]);
  const workspaceRead = calls.find(call => call.type === "select" && call.table === "board_workspaces");
  assert.match(workspaceRead.query, /board_instance_id=eq\.worktodo-board/);
  assert.match(read("shared/board/board-read-service.js"), /WORKTODO_DEFAULT_WORKSPACE_KEY = "worktodo-todo"/);
});

test("current WorkTodo runtime contains no caller of the retired create RPC", () => {
  const source = [
    read("shared/board/board-read-service.js"),
    read("modules/worklog/worklog-app.js"),
    read("shared/components/task-action-adapters.js")
  ].join("\n");
  const closure = read("docs/supabase/20260913_worktodo_legacy_create_authority_closure.sql");
  assert.doesNotMatch(source, /gateway\.rpc\(["']worktodo_create_task["']/);
  assert.match(source, /gateway\.rpc\(["']board_instance_create_task["']/);
  assert.match(closure, /revoke\s+all\s+on\s+function\s+public\.worktodo_create_task\(text, text, text, text, uuid\)/i);
  assert.match(closure, /from public, anon, authenticated, service_role/);
});
