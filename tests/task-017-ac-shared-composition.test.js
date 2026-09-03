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

  assert.match(navigation, /procurement: \{ icon: "🧾", label: "庶務行政", group: "camp-child", enabled: true, visible: true/);
  assert.match(navigation, /management: \{ icon: "🛠️", label: "管理功能", group: "system", enabled: true, visible: true/);
  assert.match(navigation, /management: "modules\/worklog\/\?app=1&workspace=management"/);
  assert.match(navigation, /\["worklog", "tasks-new", "procurement", "investment"\]/);
  assert.match(config, /procurement: \{ icon: "🧾", label: "庶務行政", group: "camp-child", enabled: true/);
  assert.match(config, /management: \{ icon: "🛠️", label: "管理功能", group: "system", enabled: true/);

  const sync = worklog.slice(worklog.indexOf("function sync()"), worklog.indexOf("function nextKnowledgeId()"));
  assert.match(worklog, /function management\(\)/);
  assert.match(worklog, /aria-label="管理功能內容"/);
  assert.doesNotMatch(sync, /管理功能|template-management-center|control-center-entry/);
  assert.match(procurement, /data-procurement-nav="board"/);
  assert.match(procurement, /data-procurement-nav="vendors"/);
  assert.match(procurement, /shared\/components\/golden-master\.js/);
  assert.match(procurement, /shared\/components\/golden-master-runtime\.js/);
  assert.match(procurement, /modules\/worklog\/services\/gas-board-service\.js/);
});

test("GAS consumer returns a truthful empty state and has no cross-module write fallback", async () => {
  const GasBoardService = require("../modules/worklog/services/gas-board-service.js");
  const service = GasBoardService.create();
  const result = await service.load();

  assert.equal(result.consumerId, "worklog-procurement");
  assert.equal(result.applicationScope, "procurement");
  assert.equal(result.boardName, "庶務行政");
  assert.equal(result.taskCodePrefix, "GAS");
  assert.equal(result.dataStatus, "not-configured");
  assert.equal(result.workspaces.length, 1);
  assert.equal(result.workspaces[0].key, "procurement-gas");
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.principles, []);
  assert.deepEqual(result.systemMaps, []);
  await assert.rejects(service.createTask(), error => error?.code === "GAS_DATA_SOURCE_NOT_CONFIGURED");
  await assert.rejects(service.deleteWorkspace(), error => error?.code === "GAS_DATA_SOURCE_NOT_CONFIGURED");
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
