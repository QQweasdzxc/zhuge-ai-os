const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("AI Board and WorkLog use the same Zhuge AI OS Shared Navigation component", () => {
  const index = read("app/Board/ai/index.html");
  const nav = read("shared/components/zhuge-navigation.js");
  const css = read("shared/theme/zhuge-navigation.css");
  const worklog = read("modules/worklog/worklog-app.js");
  const worklogIndex = read("modules/worklog/index.html");
  const investmentIndex = read("modules/investment/index.html");
  const investmentModule = read("modules/investment/services/investment-module.js");
  const investmentShell = read("modules/investment/components/module-shell.js");
  assert.match(index, /id="zhugeSharedNavigation"/);
  assert.match(index, /shared\/components\/zhuge-navigation\.js/);
  assert.match(index, /shared\/theme\/zhuge-navigation\.css/);
  assert.match(worklog, /ZhugeSharedNavigation\.render/);
  assert.match(worklogIndex, /shared\/components\/zhuge-navigation\.js/);
  assert.match(worklog, /version: VERSION,\s*build: BUILD_TIME/);
  assert.match(investmentIndex, /shared\/config\/version\.js/);
  assert.match(investmentModule, /version: release\.version, build: release\.build/);
  for (const label of ["WorkLog", "工作待辦", "Investment", "AI Board", "工程準則", "系統藍圖", "Knowledge", "控制台", "設定"]) assert.match(nav, new RegExp(label));
  assert.match(nav, /data-zhuge-shared-navigation/);
  assert.doesNotMatch(nav, /investment:[^\n]*status:\s*["']SIT["']/);
  assert.doesNotMatch(read("shared/app-config.js"), /investment:[^\n]*status:\s*["']SIT["']/);
  assert.match(nav, /sectionMarkup\("AI Board", "🤖", \["ai-board-board", "ai-board-principles", "ai-board-system-map"\]/);
  assert.match(nav, /sectionHeadingMarkup/);
  assert.doesNotMatch(nav, /sectionMarkup\("AI Board", "🤖", \["ai-board",/);
  assert.match(nav, /procurement: \{ icon: "🚧", label: "施工中", group: "construction", enabled: false, visible: false/);
  assert.match(nav, /function isVisible\(item\)/);
  assert.match(nav, /ids\.filter\(id => isVisible\(registry\[id\]\)\)/);
  assert.doesNotMatch(nav, /const construction =/);
  assert.doesNotMatch(nav, /agentPanel|DEFAULT_AGENTS|工時 Agent|投資 Agent/);
  assert.doesNotMatch(nav, /label: "採購營帳"/);
  assert.doesNotMatch(nav, /label: "Travel"/);
  assert.match(nav, /ZhugeFoundationConfig/);
  assert.match(css, /\.os-sidebar/);
  assert.match(css, /\.side-section-heading/);
  assert.match(css, /\.side-item\.on/);
  assert.match(css, /\.workspace-shell-header/);
  assert.match(css, /\.workspace-subnav/);
  assert.match(css, /\.workspace-content-container/);
  assert.match(css, /--zhuge-sidebar-item-height: 46px/);
  assert.match(css, /--zhuge-sidebar-child-height: 42px/);
  assert.match(css, /canonical Sidebar geometry/i);
  assert.doesNotMatch(read("shared/theme/zhuge-workspace.css"), /--zhuge-sidebar-item-height\s*:/);
  assert.doesNotMatch(read("modules/worklog/worklog.css"), /workspace-worklog \.side-item\{min-height:46px/);
  assert.doesNotMatch(read("modules/worklog/worklog.css"), /workspace-worklog \.os-sidebar\{min-height/);
  assert.match(read("shared/app-config.js"), /tasks: \{ icon: "🗂️", label: "工作待辦", navLabel: "工作待辦（舊）"/);
  assert.ok(worklogIndex.indexOf("./worklog.css") < worklogIndex.indexOf("shared/theme/zhuge-navigation.css"), "WorkLog content CSS must load before canonical navigation CSS");
  const stylesheetOrder = [
    [index, "shared/theme/zhuge-workspace.css"],
    [read("app/Board/worktodo/index.html"), "shared/theme/zhuge-workspace.css"],
    [read("app/dashboard/index.html"), "shared/theme/zhuge-dashboard.css"],
    [investmentIndex, "shared/theme/zhuge-workspace.css"]
  ];
  for (const [source, lastContentStyle] of stylesheetOrder) {
    assert.ok(source.indexOf(lastContentStyle) < source.indexOf("shared/theme/zhuge-navigation.css"), `${lastContentStyle} must load before canonical navigation CSS`);
  }
  assert.doesNotMatch(read("shared/theme/zhuge-workspace.css"), /Canonical Sidebar geometry/);
  assert.doesNotMatch(read("shared/theme/zhuge-workspace.css"), /\.zhuge-module-shell .*\.os-sidebar/);
  assert.doesNotMatch(read("shared/theme/zhuge-dashboard.css"), /\.zhuge-dashboard-shell .*\.os-sidebar/);
  assert.match(index, /class="zhuge-module-shell workspace-shell"/);
  assert.match(index, /class="top workspace-shell-header"/);
  assert.match(index, /class="workspace-tabs workspace-subnav"/);
  assert.doesNotMatch(index, /board-local-nav/);
  assert.match(investmentShell, /workspace-shell-header/);
  assert.match(worklog, /workspace-context-bar workspace-shell-header/);
  assert.match(worklog, /os-shell workspace-shell workspace-/);
  assert.match(read("modules/worklog/worklog.css"), /Shared Workspace Shell parity/);
  assert.match(read("modules/worklog/worklog.css"), /workspace-shell\.workspace-worklog/);
  assert.match(read("shared/theme/zhuge-workspace.css"), /workspace-worklog \.workspace-canvas[\s\S]*min-height: 0/);
  assert.match(read("shared/theme/zhuge-workspace.css"), /workspace-worklog \.daily-workspace[\s\S]*min-height: 0/);
});

test("Shared Navigation opens WorkLog internal destinations without a private Board router", () => {
  const nav = read("shared/components/zhuge-navigation.js");
  const worklog = read("modules/worklog/index.html");
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=tasks/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=library/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=sync/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=settings/);
  assert.match(worklog, /allowedWorkspaces = new Set/);
  assert.match(worklog, /zhuge_os_open_tabs_v1/);
  assert.match(worklog, /zhuge_os_active_workspace_v1/);
  assert.doesNotMatch(indexSource(), /window\.history\.back\(/);
});

function indexSource() { return read("app/Board/ai/index.html"); }
