const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("Module A exposes Management as a peer of Control Console and keeps GAS isolated", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  const config = read("shared/app-config.js");
  const worklog = read("modules/worklog/worklog-app.js");
  const procurement = read("app/Board/procurement/index.html");
  const policy = read("shared/services/template-adoption-policy.js");

  assert.match(navigation, /procurement: \{ icon: "🧾", label: "庶務行政（GAS）", group: "camp-child", enabled: true, visible: true/);
  assert.match(navigation, /management: \{ icon: "🛠️", label: "管理功能", group: "system", enabled: true, visible: true/);
  assert.match(navigation, /management: "modules\/worklog\/\?app=1&workspace=management"/);
  assert.match(navigation, /\["worklog", "tasks-new", "procurement", "investment"\]/);
  assert.match(config, /procurement: \{ icon: "🧾", label: "庶務行政（GAS）", group: "camp-child", enabled: true/);
  assert.match(config, /management: \{ icon: "🛠️", label: "管理功能", group: "system", enabled: true/);
  assert.match(policy, /management: Object\.freeze\(\{[\s\S]*requiredTemplates: Object\.freeze\(\["navigation"\]\)/);
  assert.match(policy, /procurement: Object\.freeze\(\{[\s\S]*supportedTemplates: Object\.freeze\(\["navigation", "board"\]\), requiredTemplates: Object\.freeze\(\["navigation", "board"\]\)/);
  assert.match(policy, /investment: Object\.freeze\(\{[\s\S]*supportedTemplates: Object\.freeze\(\["navigation", "board"\]\), requiredTemplates: Object\.freeze\(\["board"\]\)/);

  const sync = worklog.slice(worklog.indexOf("function sync()"), worklog.indexOf("function nextKnowledgeId()"));
  assert.match(worklog, /function management\(\)/);
  assert.match(worklog, /aria-label="管理功能內容"/);
  assert.doesNotMatch(sync, /管理功能|template-management-center|control-center-entry/);
  assert.match(procurement, /data-procurement-nav="board"/);
  assert.match(procurement, /data-procurement-nav="vendors"/);
  assert.match(procurement, /data-procurement-board-instance-id="38d8d4b1-6d01-4d58-835b-b2beb61fc6b9"/);
  assert.match(procurement, /shared\/components\/golden-master\.js/);
  assert.match(procurement, /shared\/components\/golden-master-runtime\.js/);
  assert.doesNotMatch(procurement, /modules\/worklog\/services\/gas-board-service\.js/);
});

test("GAS consumer mounts the canonical C runtime and keeps its empty state truthful", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const procurement = read("app/Board/procurement/index.html");

  assert.match(procurement, /shared\/components\/golden-master-runtime\.js/);
  assert.doesNotMatch(procurement, /gas-board-service/);
  assert.match(runtime, /applicationScope: "procurement"/);
  assert.match(runtime, /createInstanceService\(\{ templateKey: "c", applicationScope: "procurement", boardInstanceId: requestedBoardInstanceId/);
  assert.match(runtime, /目前沒有正式 GAS 資料/);
});

test("Investment keeps one portfolio C view and consolidates Watchlist as a workspace", () => {
  const config = read("modules/investment/config/module-config.js");
  const shell = read("modules/investment/components/module-shell.js");
  const moduleSource = read("modules/investment/services/investment-module.js");
  const entry = read("modules/investment/index.html");
  const adapter = read("modules/investment/services/ivtk-board-adapter.js");

  assert.match(config, /pages: Object\.freeze\(\["overview", "portfolio", "strategy", "settings", "import"\]\)/);
  assert.doesNotMatch(shell, /watchlist:/);
  assert.doesNotMatch(moduleSource, /InvestmentWatchlistPage/);
  assert.match(moduleSource, /page === "watchlist" \? "portfolio" : page/);
  assert.match(moduleSource, /if \(state\.activePage === "portfolio"\)/);
  assert.doesNotMatch(entry, /pages\/watchlist-page\.js/);
  assert.match(adapter, /renderBoard\(\{/);
  assert.doesNotMatch(adapter, /investment-ivtk-fallback-board/);
  assert.doesNotMatch(adapter, /<article class=\"\$\{escape\(options\.className/);
  assert.match(adapter, /data-investment-source-kind/);
  assert.match(adapter, /readOnly: true/);
  assert.doesNotMatch(adapter, /board_tasks[\s\S]{0,240}(quantity|market_value|unrealized_pnl)/i);
});

test("C consumers do not re-expose the retired data-health operation", () => {
  const goldenMaster = read("shared/components/golden-master.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  const worktodo = read("app/Board/worktodo/index.html");

  assert.doesNotMatch(goldenMaster, /healthCheckBtn|healthCheckModal|資料健康檢查|資料健康度檢查/);
  assert.doesNotMatch(runtime, /legacyHealthCheckVisible|syncLegacyHealthCheckUi|runHealthCheck\(|ensureHealthModal\(|healthCheckBtn|healthCheckModal|includeHealthCheck/);
  assert.doesNotMatch(worktodo, /healthCheckBtn|資料健康檢查|資料健康度檢查/);
});
