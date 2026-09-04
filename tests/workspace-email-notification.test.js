const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("Workspace Email source keeps settings Cloud-only and idempotent", () => {
  const migration = read("docs/supabase/20260904_c_workspace_email_notifications.sql");
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");
  const edge = read("supabase/functions/workspace-email-notification/index.ts");

  assert.match(migration, /create table if not exists public\.board_workspace_notification_settings/i);
  assert.match(migration, /board_instance_can_read/i);
  assert.match(migration, /board_instance_can_write/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.board_workspace_notification_settings from public, anon, authenticated/i);
  assert.match(migration, /engineering_workspace_email_notification_idempotency_idx/i);
  assert.doesNotMatch(migration, /drop table|drop column|delete from public\./i);
  assert.doesNotMatch(`${runtime}\n${service}\n${edge}`, /localStorage|sessionStorage|indexedDB/i);
  assert.match(runtime, /data-workspace-action=\\"settings\\"/);
  assert.match(runtime, /openWorkspaceSettings\(workspace\)/);
  assert.match(service, /board_get_workspace_notification_settings/);
  assert.match(service, /board_save_workspace_notification_settings/);
  assert.match(edge, /workspace-email-v1:\$\{movement\.id\}/);
  assert.match(edge, /already_processed/);
  const accessSource = edge.match(/async function resolveBoardAccess[\s\S]*?\n\}/)?.[0] || "";
  assert.match(accessSource, /from\("engineering_members"\)[\s\S]*\.eq\("is_active", true\)/);
  assert.doesNotMatch(accessSource, /from\("engineering_members"\)[\s\S]*\.eq\("active", true\)/);
  assert.match(edge, /hasWorkspaceEntry/); // guards must remain explicit in the source
  assert.match(runtime, /bindWorkspaceSettingsMenus/);
  const ivtk = read("modules/investment/services/ivtk-board-adapter.js");
  assert.match(ivtk, /data-workspace-menu/);
  assert.match(ivtk, /ZhugeGoldenMasterWorkspaceSettings/);
});

test("all formal C consumers load the shared Module C runtime", () => {
  const consumers = [
    "app/Board/worktodo/index.html",
    "app/Board/ai/index.html",
    "app/Board/procurement/index.html",
    "modules/investment/index.html"
  ];
  consumers.forEach(file => {
    const source = read(file);
    assert.match(source, /golden-master-runtime\.js/, `${file} must mount shared Module C runtime`);
    assert.match(source, /golden-master\.css/, `${file} must load shared Module C styles`);
  });
});

test("generic C movement calls the notification Function only after the RPC", async () => {
  const BoardRead = require("../shared/board/board-read-service.js");
  const calls = [];
  const gateway = {
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return { id: "task-1", work_code: "TASK-1", title: "Card", workspace_id: "workspace-2", status: "ready" };
    },
    invokeFunction: async (name, body) => {
      calls.push(["function", name, body]);
      return { ok: true, sent: false, reason: "disabled" };
    }
  };

  const task = await BoardRead.moveTaskWorkspace("task-1", "workspace-2", "QA", { gateway });
  assert.equal(task.workspaceId, "workspace-2");
  assert.deepEqual(calls.map(call => call[0]), ["rpc", "function"]);
  assert.equal(calls[1][1], "workspace-email-notification");
  assert.deepEqual(calls[1][2], { task_id: "task-1", workspace_id: "workspace-2" });
});

test("WorkTodo content edits do not notify, while workspace/status edits do", async () => {
  const BoardRead = require("../shared/board/board-read-service.js");
  const notifications = [];
  const gateway = {
    rpc: async (name, args) => ({
      id: args.p_task_id,
      work_code: "WLTK-1",
      title: "Card",
      workspace_id: "workspace-2",
      status: "in_progress"
    }),
    invokeFunction: async (name, body) => {
      notifications.push([name, body]);
      return { ok: true };
    }
  };

  await BoardRead.worktodoUpdateTask({ taskId: "task-1", patch: { title: "Updated" } }, { gateway });
  assert.equal(notifications.length, 0);
  await BoardRead.worktodoUpdateTask({ taskId: "task-1", patch: { workspace_id: "workspace-2" } }, { gateway });
  await BoardRead.worktodoUpdateTask({ taskId: "task-1", patch: { status: "in_progress" } }, { gateway });
  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications[0][1], { task_id: "task-1", workspace_id: "workspace-2" });
});

test("Board Instance C exposes the same Cloud settings RPCs and movement hook", async () => {
  const BoardRead = require("../shared/board/board-read-service.js");
  const calls = [];
  const gateway = {
    select: async () => [{ id: "instance-1", name: "GAS", task_code_prefix: "GAS", active: true }],
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      if (name === "board_get_workspace_notification_settings") return { workspace_id: args.p_workspace_id, enabled: false };
      if (name === "board_save_workspace_notification_settings") return { workspace_id: args.p_workspace_id, enabled: true };
      return { id: "task-1", work_code: "GAS-1", title: "Card", workspace_id: "workspace-2", status: "ready" };
    },
    invokeFunction: async (name, body) => {
      calls.push(["function", name, body]);
      return { ok: true };
    }
  };
  const service = BoardRead.createInstanceService({ boardInstanceId: "instance-1", gateway });

  assert.deepEqual(await service.getWorkspaceNotificationSettings("workspace-2"), { workspace_id: "workspace-2", enabled: false });
  await service.saveWorkspaceNotificationSettings("workspace-2", { enabled: true });
  await service.moveTaskWorkspace("task-1", "workspace-2");
  assert.equal(calls.filter(call => call[0] === "function").length, 1);
  assert.equal(calls.find(call => call[0] === "function")[1], "workspace-email-notification");
});
