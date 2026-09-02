const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "app/dashboard/zhuge-dashboard.js"), "utf8");
const worklog = fs.readFileSync(path.join(root, "modules/worklog/worklog-app.js"), "utf8");
const worktodoAdapter = fs.readFileSync(path.join(root, "modules/worklog/components/worktodo-task-adapter.js"), "utf8");
const dashboardAdapter = fs.readFileSync(path.join(root, "modules/worklog/components/worktodo-dashboard-adapter.js"), "utf8");
const landing = fs.readFileSync(path.join(root, "index.html"), "utf8");
const worklogEntry = fs.readFileSync(path.join(root, "modules/worklog/index.html"), "utf8");
const workspaceTheme = fs.readFileSync(path.join(root, "shared/theme/zhuge-workspace.css"), "utf8");
const worklogCss = fs.readFileSync(path.join(root, "modules/worklog/worklog.css"), "utf8");
const realtime = fs.readFileSync(path.join(root, "shared/api/realtime-service.js"), "utf8");

test("Dashboard and WorkLog share recent-update task ordering", () => {
  assert.match(worklog, /function sortTasksByRecentUpdate\(list = \[\]\)/);
  assert.match(worklog, /return sortTasksByRecentUpdate\(filtered\)/);
  assert.match(dashboard, /data-formal-work-summary/);
  assert.match(dashboardAdapter, /latestProgressAt/);
});

test("Dashboard formal task rows route to the current WorkTodo workspace", () => {
  assert.match(dashboard, /data-dashboard-add-task="1"/);
  assert.match(dashboard, /data-formal-work-task=/);
  assert.match(worklog, /function openDashboardTask\(taskId = ""\)/);
  const handlerStart = worklog.indexOf('function openDashboardTask(taskId = "")');
  const handlerEnd = worklog.indexOf("\n}\n\nfunction openDashboardNewTask", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const dashboardTaskHandler = worklog.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(dashboardTaskHandler, /openTaskJournal|activeWorkspace = "tasks"|openTabs\.push\("tasks"\)|render\(/);
  assert.match(dashboardTaskHandler, /fail-closed/);
  assert.match(worklog, /function openDashboardNewTask\(\) \{[\s\S]*?openWorkspace\("tasks-new"\);/);
  assert.match(worklog, /document\.querySelectorAll\("\[data-task-new\]"\)\.forEach\(button => button\.onclick = \(\) => openWorkspace\("tasks-new"\)\)/);
  assert.doesNotMatch(worklog, /function openDashboardNewTask\(\) \{[\s\S]*?taskDrawerOpen = true/);
});

test("Chat adjustment and saved shell state cannot reopen Legacy Task UI", () => {
  const assistantEditStart = worklog.indexOf('document.querySelectorAll("[data-assistant-edit-task]")');
  const assistantEditEnd = worklog.indexOf('document.querySelectorAll("[data-assistant-confirm-entry]")', assistantEditStart);
  assert.ok(assistantEditStart >= 0 && assistantEditEnd > assistantEditStart);
  const assistantEditHandler = worklog.slice(assistantEditStart, assistantEditEnd);
  assert.doesNotMatch(assistantEditHandler, /activeWorkspace = "tasks"|openTabs\.push\("tasks"\)|rememberWorkspace\("tasks"\)|render\(/);
  assert.match(assistantEditHandler, /請先建立待辦，再到正式工作待辦調整/);

  const normalizeStart = worklog.indexOf("function normalizeWorkspaceState()");
  const normalizeEnd = worklog.indexOf("\n}\n\nfunction rememberWorkspace", normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  const normalizeHandler = worklog.slice(normalizeStart, normalizeEnd);
  assert.match(normalizeHandler, /activeWorkspace === "tasks"/);
  assert.match(normalizeHandler, /id !== "tasks"/);
});

test("Legacy Task and Journal realtime channels are retired while Work Entry remains", () => {
  assert.doesNotMatch(realtime, /table: "user_tasks"/);
  assert.doesNotMatch(realtime, /table: "work_journal_entries"/);
  assert.match(realtime, /table: "work_entries"/);
});

test("AI Assistant new-task action uses the canonical WorkTodo create contract", () => {
  assert.match(worklogEntry, /\.\.\/\.\.\/shared\/board\/board-read-service\.js/);
  assert.match(worklog, /data-assistant-create-task\]\"\)\.forEach\(button => button\.onclick = async/);
  assert.match(worklog, /createService\.worktodoCreateTask\(\{[\s\S]*?status: \"not_started\"/);
  assert.match(worklog, /data-assistant-create-task[\s\S]*?openWorkspace\(\"tasks-new\"\)/);
  assert.doesNotMatch(worklog, /data-assistant-create-task[\s\S]*?createTask\(title\)/);
});

test("WorkTodo journal uses the Shared Task Drawer timeline", () => {
  assert.match(worklog, /ZhugeWorkTodoTaskAdapter/);
  assert.match(worktodoAdapter, /data-worktodo-shared-drawer/);
  assert.match(worktodoAdapter, /data-worktodo-journal-entry/);
  assert.doesNotMatch(worklog, /task-latest-journal/);
});

test("Dashboard new-task action is visibly primary and auth entry targets Dashboard", () => {
  assert.match(dashboard, /data-dashboard-add-task="1"/);
  assert.match(dashboard, /<button type="button" class="btn2" data-dashboard-add-task="1">/);
  assert.match(landing, /modules\/worklog\/\?app=1&amp;workspace=dashboard/);
  assert.match(worklogEntry, /\?app=1&amp;workspace=dashboard/);
  assert.match(worklogEntry, /allowedWorkspaces = new Set\(\["dashboard"/);
  assert.match(workspaceTheme, /\.zhuge-module-shell \.btn2:hover/);
});

test("Authenticated Dashboard handoff keeps the shared WorkLog session", () => {
  const navigation = fs.readFileSync(path.join(root, "shared/components/zhuge-navigation.js"), "utf8");
  const dashboardEntry = fs.readFileSync(path.join(root, "app/dashboard/index.html"), "utf8");
  assert.ok(navigation.includes('dashboard: "modules/worklog/?app=1&workspace=dashboard"'));
  assert.match(dashboardEntry, /redirectAuthenticatedDashboard/);
  assert.match(dashboardEntry, /getSupabaseAuthUser/);
  assert.ok(dashboardEntry.includes('location.replace("../../modules/worklog/?app=1&workspace=dashboard")'));
});

test("Dashboard uses the formal WorkTodo summary and preserves recent workspace history", () => {
  assert.match(dashboard, /zhugeRootFormalWorkSummaryMarkup/);
  assert.match(dashboard, /正式資料/);
  assert.match(dashboard, /工作摘要/);
  assert.match(dashboard, /前往工作待辦/);
  assert.match(dashboard, /目前沒有待處理的正式工作/);
  assert.match(dashboard, /data-formal-work-task=/);
  assert.match(dashboard, /is-fallback/);
  assert.match(worklogEntry, /components\/worktodo-dashboard-adapter\.js/);
  assert.match(worklog, /refreshFormalWorkSummary/);
  assert.match(dashboardAdapter, /applicationScope: "worktodo"/);
  assert.match(dashboardAdapter, /Supabase Shared Data Gateway/);
  assert.match(dashboard, /最近使用/);
  assert.match(worklogEntry, /requestedWorkspace !== "dashboard"/);
  const workspaceStateStart = worklog.indexOf("function normalizeWorkspaceState()");
  const workspaceStateEnd = worklog.indexOf("\n}\n\nfunction rememberWorkspace", workspaceStateStart);
  assert.ok(workspaceStateStart >= 0 && workspaceStateEnd > workspaceStateStart);
  const workspaceState = worklog.slice(workspaceStateStart, workspaceStateEnd);
  assert.match(workspaceState, /Recent workspaces are history, not open tabs/);
  assert.match(worklog, /function rememberWorkspace\(id\) \{[\s\S]*?slice\(0, 6\)/);
  const openWorkspaceStart = worklog.indexOf("function openWorkspace(id)");
  const openWorkspaceEnd = worklog.indexOf("\n}\n\nfunction activateWorkspace", openWorkspaceStart);
  assert.ok(openWorkspaceStart >= 0 && openWorkspaceEnd > openWorkspaceStart);
  const openWorkspace = worklog.slice(openWorkspaceStart, openWorkspaceEnd);
  assert.match(openWorkspace, /if \(id === "dashboard"\)/);
  assert.doesNotMatch(openWorkspace, /recentWorkspaces = \[\]/);
});

test("Settings keeps existing controls while using a compact responsive layout", () => {
  assert.match(worklog, /class="panel settings-page"/);
  assert.match(worklog, /settings-summary-grid/);
  assert.match(worklog, /settings-form-grid/);
  assert.match(worklog, /id="resetProfile"/);
  assert.match(worklog, /id="logoutBtn"/);
  assert.match(worklogCss, /\.workspace-worklog \.settings-summary-grid/);
  assert.match(worklogCss, /\.workspace-worklog \.settings-form-grid/);
  assert.match(worklogCss, /@media\(max-width:767px\)[\s\S]*settings-actions button\{width:100%\}/);
});

test("Control Center entries use the shared card surface", () => {
  assert.match(worklog, /class="control-center-entry"/);
  assert.match(workspaceTheme, /\.control-center-entry \{/);
  assert.match(workspaceTheme, /background: var\(--zhuge-surface\)/);
});
