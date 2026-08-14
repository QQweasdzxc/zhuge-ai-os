const test = require("node:test");
const assert = require("node:assert/strict");

global.getSharedSessionSnapshot = () => ({ isAuthenticated: true, user_id: "qjc" });
global.ZhugeIdentity = { normalize: value => ({ ...value, isAuthenticated: true }) };
const Board = require("../shared/board/board-read-service.js");

test("Engineering Data Health is read-only and reports duplicate and stale findings", async () => {
  const gateway = {
    select: async table => {
      if (table === "board_tasks") return [
        { id: "1", work_code: "TASK-001", title: "相同需求", summary: "A", status: "done", updated_at: "2026-08-10T00:00:00Z" },
        { id: "2", work_code: "TASK-001", title: "相同需求", summary: "B", status: "ready", updated_at: "2026-08-09T00:00:00Z" }
      ];
      if (table === "engineering_checklist_items") return [];
      return [];
    }
  };
  const report = await Board.runHealthCheck({
    gateway,
    engineeringMemory: {
      status: "ready",
      records: [{ knowledgeCode: "TASK-026-SYSTEM-MAP", knowledgeType: "system_map", title: "系統藍圖", summary: "old", content: "", version: "", updatedAt: "2026-08-01T00:00:00Z" }],
      failures: []
    }
  });
  assert.equal(report.writable, false);
  assert.ok(report.findings.some(item => item.type === "duplicate_code"));
  assert.ok(report.findings.some(item => item.type === "stale_knowledge"));
  assert.equal(report.findings.some(item => item.type === "schema_capability"), false);
});
