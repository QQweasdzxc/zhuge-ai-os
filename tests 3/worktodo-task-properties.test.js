const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const Adapter = require("../modules/worklog/components/worktodo-task-adapter.js");

function sharedDrawer() {
  return {
    render(options = {}) {
      const properties = (options.properties || []).map(item => {
        const action = item.interactive ? ` data-task-property-action="${item.action}"` : "";
        return `<div class="shared-task-drawer-property"${action}><strong data-task-property-value>${item.value || "—"}</strong><span>${item.label}</span></div>`;
      }).join("");
      return `<div class="shared-task-drawer"><div class="shared-task-drawer-properties">${properties}</div>${(options.sections || []).map(section => section.html).join("")}${options.activity?.topHtml || ""}${options.activity?.html || ""}${options.activity?.composerHtml || ""}</div>`;
    }
  };
}

test("WorkTodo keeps canonical property data while omitting it from the Card/Drawer UX", () => {
  const vm = Adapter.normalize({
    id: "cloud-task-1",
    work_code: "WLTK-001",
    title: "整理需求",
    work_property: "產品規劃",
    estimated_minutes: 90,
    status: "in_progress",
    priority: "p1"
  });
  assert.equal(vm.workProperty, "產品規劃");
  assert.equal(vm.estimatedMinutes, 90);
  const html = Adapter.render(vm, { drawer: sharedDrawer(), readOnly: false });
  assert.doesNotMatch(html, /工作屬性/);
  assert.doesNotMatch(html, /產品規劃/);
  assert.match(html, /預估時間/);
  assert.match(html, /1 小時 30 分鐘/);
  assert.doesNotMatch(html, /data-task-property-action="work-property"/);
  assert.match(html, /data-task-property-action="estimated-minutes"/);
});

test("WorkTodo property capability uses the canonical controlled path", () => {
  const migration = read("docs/supabase/20260820_worktodo_task_properties.sql");
  const repository = read("shared/api/repositories.js");
  const service = read("shared/api/data-service.js");

  assert.match(migration, /ADD COLUMN IF NOT EXISTS work_property text NOT NULL DEFAULT ''/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.worktodo_update_task_properties/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /work_journal_entries/);
  assert.match(migration, /work_property[\s\S]*estimated_minutes/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.worktodo_update_task_properties/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.worktodo_update_task_properties[\s\S]*authenticated/);
  assert.match(migration, /distinct from user_work_models\.category/);
  assert.doesNotMatch(migration, /FROM\s+public\.user_work_models/i);
  assert.match(repository, /worktodo_update_task_properties/);
  assert.match(service, /updateWorkTodoTaskProperties/);
});

test("WorkTodo property mapping does not create a second task presentation", () => {
  const adapter = read("modules/worklog/components/worktodo-task-adapter.js");
  assert.match(adapter, /ZhugeSharedTaskDrawer/);
  assert.match(adapter, /ZhugeSharedTaskCard/);
  assert.match(adapter, /workProperty/);
  assert.match(adapter, /預估時間/);
  assert.doesNotMatch(adapter, /user_work_models/);
});
