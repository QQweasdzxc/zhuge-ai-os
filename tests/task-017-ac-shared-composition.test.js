const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const BoardReadService = require("../shared/board/board-read-service.js");

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

  const window = { ZhugeTemplateAdoptionRuntime: { isCreator: true } };
  const document = { readyState: "loading", body: null, addEventListener() {} };
  vm.runInNewContext(navigation, { window, document });
  const nav = window.ZhugeSharedNavigation;
  const boards = [
    { id: "qa-official-gas", name: "Official administrative board", task_code_prefix: "GAS" },
    { id: "qa-work", name: "Arbitrary work board", task_code_prefix: "ANYW", project_assignment: "worklog" },
    { id: "qa-invest", name: "Arbitrary investment board", task_code_prefix: "ANYI", project_assignment: "investment" },
    { id: "qa-unassigned", name: "Arbitrary independent board", task_code_prefix: "ANYU" }
  ].map(row => BoardReadService.normalizeBoardInstance({ template_key: "c", is_template_instance: false, active: true, ...row }));
  const html = nav.render({ externalRoot: "/", boardInstances: boards });
  const item = id => {
    const match = [...html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
      .find(match => match[2].includes(`data-shared-nav-item="${id}"`));
    assert.ok(match, `${id} is reachable`);
    return { attrs: match[2], content: match[3], index: match.index };
  };
  for (const id of ["management", "sync"]) {
    assert.equal(nav.DEFAULT_REGISTRY[id].group, "system");
    const href = item(id).attrs.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&");
    const url = new URL(href, "https://qa.invalid");
    assert.equal(url.pathname, "/modules/worklog/");
    assert.equal(url.searchParams.get("app"), "1");
    assert.equal(url.searchParams.get("workspace"), id);
    assert.ok(item(id).index > html.indexOf('data-nav-group="system"'), `${id} is a system entry`);
  }
  assert.equal(nav.DEFAULT_REGISTRY.procurement.group, "camp-child");
  assert.match(item("procurement").attrs, /side-item-child/);
  assert.match(item("procurement").attrs, /href="\/app\/Board\/procurement\/"/);
  assert.ok(item("procurement").index > item("worklog").index);
  assert.ok(item("procurement").index < item("investment").index);
  assert.ok(!html.includes('consumer-board:qa-official-gas'), "GAS has no duplicate Generic entry");
  assert.match(item("consumer-board:qa-work").attrs, /side-item-child/);
  assert.ok(item("consumer-board:qa-work").index > item("worklog").index);
  assert.ok(item("consumer-board:qa-work").index < item("investment").index);
  assert.match(item("consumer-board:qa-invest").attrs, /side-item-child/);
  assert.ok(item("consumer-board:qa-invest").index > item("investment").index);
  assert.ok(item("consumer-board:qa-invest").index < html.indexOf('data-nav-group="consumer-boards"'));
  assert.ok(item("consumer-board:qa-unassigned").index > html.indexOf('data-nav-group="consumer-boards"'));
  assert.doesNotMatch(item("consumer-board:qa-unassigned").attrs, /side-item-child/);
  assert.match(config, /procurement: \{ icon: "🧾", label: "庶務行政", group: "camp-child", enabled: true/);
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
  assert.match(procurement, /shared\/components\/golden-master\.js/);
  assert.match(procurement, /shared\/components\/golden-master-runtime\.js/);
  assert.doesNotMatch(procurement, /modules\/worklog\/services\/gas-board-service\.js/);
  assert.match(procurement, /data-golden-master-surface/);
});

test("Investment keeps one portfolio C view and consolidates Watchlist as a workspace", () => {
  const config = read("modules/investment/config/module-config.js");
  const shell = read("modules/investment/components/module-shell.js");
  const moduleSource = read("modules/investment/services/investment-module.js");
  const entry = read("modules/investment/index.html");
  const board = read("app/Board/investment/index.html");
  const adapter = read("modules/investment/services/ivtk-board-adapter.js");

  assert.match(config, /pages: Object\.freeze\(\["overview", "portfolio", "transactions", "strategy", "settings", "import"\]\)/);
  assert.doesNotMatch(shell, /watchlist:/);
  assert.doesNotMatch(moduleSource, /InvestmentWatchlistPage/);
  assert.match(moduleSource, /page === "watchlist" \? "portfolio" : page/);
  assert.match(moduleSource, /if \(state\.activePage === "portfolio"\)/);
  assert.doesNotMatch(entry, /pages\/watchlist-page\.js/);
  assert.match(board, /id="investmentNavigation"[^>]*data-investment-navigation="canonical"/);
  assert.match(board, /modules\/investment\/components\/module-shell\.js/);
  assert.doesNotMatch(board, /procurement-content-tabs investment-c-tabs/);
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
