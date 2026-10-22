import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app=fs.readFileSync("labs/taskflow/pages-client/app.mjs","utf8");
const matrix=fs.readFileSync("docs/30_QA/site-integration-118/NATIVE-PROJECT-TASK-REUSE-MATRIX.md","utf8");

test("native project mapping is explicit and fail-closed when IDs are absent",()=>{
  assert.match(app,/const executors=\["CO-01","CO-02","CO-03","GEM-01","GH-HELPER"\]/);
  assert.match(app,/GAP：Executor、Workspace、ACL 的 Native Project 對應缺失或不唯一/);
  assert.match(app,/item\?\.executor_id\|\|item\?\.executor/);
  assert.match(app,/item\?\.acl_allowed===true/);
  assert.match(app,/item\?\.access_allowed===true/);
  assert.match(app,/item\?\.workspace_id\|\|""\)===workspaceId/);
  assert.match(app,/matches\.length===1\?matches\[0\]:null/);
  assert.doesNotMatch(app,/item\.name,item\.title,item\.slug,item\.key/);
  assert.match(app,/project\.id/);
  assert.match(app,/workspaceSlug\(\)/);
});

test("unsupported native mutations remain an explicit integration gap",()=>{
  assert.match(matrix,/Status movement／drag/);
  assert.match(matrix,/不提供前端假更新/);
  assert.match(matrix,/改派與歷史/);
  assert.match(matrix,/Project status movement mutation contract/);
});
