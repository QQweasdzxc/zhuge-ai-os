import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("labs/taskflow/pages-client/index.html","utf8");
const app=fs.readFileSync("labs/taskflow/pages-client/app.mjs","utf8");

test("AI project and task centers use native TaskFlow routes and the same Issue board",()=>{
  assert.match(html, /#\/tf\/ai-projects/);
  assert.match(html, /#\/tf\/ai-tasks/);
  assert.match(html, /tf-ai-kanban/);
  for(const executor of ["CO-01","CO-02","CO-03","GEM-01","GH-HELPER"]) assert.match(app, new RegExp(`"${executor}"`));
  assert.match(app, /const executor=route\.section===\"ai-projects\"/);
  assert.match(app, /dispatchAdapter\.list\(workspaceSlug\(\),\{executor\}\)/);
  assert.match(app, /routeFor\(\{issueId:item\.id\}\)/);
  assert.match(app, /原生 AI Issue/);
});

test("AI board keeps ordinary TaskFlow issues out of the AI projection",()=>{
  assert.match(app, /具備原生 AI 派工證據/);
  assert.match(app, /未將一般 TaskFlow 任務偽裝成 AI 案件/);
  assert.match(app, /專案與任務入口共用相同 Issue ID/);
  assert.match(app, /Native Project：/);
  assert.match(app, /GAP：未取得此 Workspace 唯一且已授權的 Executor→Native Project ID mapping/);
  assert.match(app, /item\.executor_id\|\|item\.executor/);
  assert.match(app, /item\.acl_allowed!==false/);
  assert.match(app, /zhuge-taskflow-web\.onrender\.com/);
});
