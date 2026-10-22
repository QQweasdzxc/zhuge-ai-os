import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app=fs.readFileSync("labs/taskflow/pages-client/app.mjs","utf8");
const matrix=fs.readFileSync("docs/30_QA/site-integration-118/NATIVE-PROJECT-TASK-REUSE-MATRIX.md","utf8");

test("native project mapping is fail-closed and never inferred from names",()=>{
  assert.match(app,/item\.executor_id\|\|item\.executor/);
  assert.match(app,/item\.acl_allowed!==false/);
  assert.match(app,/item\.access_allowed!==false/);
  assert.doesNotMatch(app,/item\.name,item\.title,item\.slug,item\.key/);
});

test("unsupported native mutations remain an explicit integration gap",()=>{
  assert.match(matrix,/Status movement／drag/);
  assert.match(matrix,/不提供前端假更新/);
  assert.match(matrix,/改派與歷史/);
  assert.match(matrix,/Project status movement mutation contract/);
});
