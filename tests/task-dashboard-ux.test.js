const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "app/dashboard/zhuge-dashboard.js"), "utf8");
const worklog = fs.readFileSync(path.join(root, "modules/worklog/worklog-app.js"), "utf8");
const landing = fs.readFileSync(path.join(root, "index.html"), "utf8");
const worklogEntry = fs.readFileSync(path.join(root, "modules/worklog/index.html"), "utf8");
const workspaceTheme = fs.readFileSync(path.join(root, "shared/theme/zhuge-workspace.css"), "utf8");

test("Dashboard and WorkLog share recent-update task ordering", () => {
  assert.match(worklog, /function sortTasksByRecentUpdate\(list = \[\]\)/);
  assert.match(worklog, /return sortTasksByRecentUpdate\(filtered\)/);
  assert.match(dashboard, /typeof sortTasksByRecentUpdate === "function"/);
});

test("Dashboard task actions use the existing task workspace flow", () => {
  assert.match(dashboard, /data-dashboard-add-task="1"/);
  assert.match(dashboard, /data-dashboard-task-id=/);
  assert.match(worklog, /function openDashboardTask\(taskId = ""\)/);
  assert.match(worklog, /openTaskJournal\(task.id\)/);
  assert.match(worklog, /function openDashboardNewTask\(\)/);
});

test("Task journal previews are collapsed until requested", () => {
  assert.match(worklog, /<details class="task-latest-journal">/);
  assert.match(worklog, /task-latest-journal-content/);
});

test("Dashboard new-task action is visibly primary and auth entry targets Dashboard", () => {
  assert.match(dashboard, /data-dashboard-add-task="1"/);
  assert.match(landing, /modules\/worklog\/\?app=1&amp;workspace=dashboard/);
  assert.match(worklogEntry, /\?app=1&amp;workspace=dashboard/);
  assert.match(worklogEntry, /allowedWorkspaces = new Set\(\["dashboard"/);
  assert.match(workspaceTheme, /zhuge-dashboard-section-actions \[data-dashboard-add-task\]/);
});

test("Control Center entries use the shared card surface", () => {
  assert.match(worklog, /class="control-center-entry"/);
  assert.match(workspaceTheme, /\.control-center-entry \{/);
  assert.match(workspaceTheme, /background: var\(--zhuge-surface\)/);
});
