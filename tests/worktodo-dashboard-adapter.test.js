const test = require("node:test");
const assert = require("node:assert/strict");

const Adapter = require("../modules/worklog/components/worktodo-dashboard-adapter.js");

test("Formal WorkTodo summary classifies Cloud workspace stages and keeps completed work out of active rows", () => {
  const result = Adapter.summarize({
    source: "fake canonical WorkTodo source",
    tasks: [
      { id: "t-progress", workCode: "WLTK-001", title: "進行中的正式工作", workspaceKey: "worktodo-inprogress", workspaceName: "進行中", updatedAt: "2026-09-02T09:00:00Z" },
      { id: "t-reply", workCode: "WLTK-002", title: "等待回覆的正式工作", workspaceKey: "worktodo-waiting-reply", workspaceName: "等待回覆", updatedAt: "2026-09-02T08:00:00Z" },
      { id: "t-blocked", workCode: "WLTK-003", title: "被阻塞的正式工作", workspaceKey: "worktodo-blocked", workspaceName: "阻塞", updatedAt: "2026-09-02T07:00:00Z" },
      { id: "t-ready", workCode: "WLTK-004", title: "待開始的正式工作", workspaceKey: "worktodo-todo", workspaceName: "待開始", updatedAt: "2026-09-02T06:00:00Z" },
      { id: "t-done", workCode: "WLTK-005", title: "已完成的正式工作", workspaceKey: "worktodo-completed", workspaceName: "完成", updatedAt: "2026-09-02T05:00:00Z" }
    ]
  });

  assert.equal(result.state, "ready");
  assert.equal(result.readOnly, true);
  assert.equal(result.counts.total, 5);
  assert.equal(result.counts.active, 4);
  assert.equal(result.counts.not_started, 1);
  assert.equal(result.counts.in_progress, 1);
  assert.equal(result.counts.waiting_reply, 1);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.counts.completed, 1);
  assert.deepEqual(result.tasks.map(task => task.id), ["t-progress", "t-reply", "t-blocked", "t-ready"]);
  assert.equal(result.tasks[0].statusLabel, "進行中");
  assert.deepEqual(result.workspaceCounts.map(item => [item.key, item.count]), [
    ["worktodo-todo", 1],
    ["worktodo-inprogress", 1],
    ["worktodo-waiting-reply", 1],
    ["worktodo-blocked", 1]
  ]);
});

test("Formal WorkTodo summary load uses the canonical WorkTodo application scope", async () => {
  const calls = [];
  const summary = await Adapter.load({
    service: {
      load: async options => {
        calls.push(options);
        return { tasks: [{ id: "t-1", title: "正式工作", workspaceKey: "worktodo-todo", workspaceName: "待開始" }] };
      }
    }
  });
  assert.equal(summary.state, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].applicationScope, "worktodo");
});

test("Formal WorkTodo summary fails closed when the canonical read service fails", async () => {
  const summary = await Adapter.load({
    service: { load: async () => { const error = new Error("Cloud unavailable"); error.code = "CLOUD_READ_FAILED"; throw error; } }
  });
  assert.equal(summary.state, "error");
  assert.equal(summary.readOnly, true);
  assert.equal(summary.code, "CLOUD_READ_FAILED");
  assert.equal(summary.message, "正式工作摘要暫時無法取得");
});
