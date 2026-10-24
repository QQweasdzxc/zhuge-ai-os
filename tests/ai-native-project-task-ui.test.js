import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {NATIVE_EXECUTORS, resolveNativeExecutorProjectMappings} from "../labs/taskflow/pages-client/native-project-mapping-contract.mjs";

const html=fs.readFileSync("labs/taskflow/pages-client/index.html","utf8");
const app=fs.readFileSync("labs/taskflow/pages-client/app.mjs","utf8");
const workspaceId="11111111-1111-4111-8111-111111111111";

test("AI project navigation is fail-closed and only links to verified native Project UUIDs",()=>{
  assert.match(html, /#\/tf\/ai-projects/);
  assert.match(app, /nativeTaskFlowProjectPath\(workspaceSlug\(\),mapping\.projectId\)/);
  assert.match(app, /target\.origin==="https:\/\/zhuge-taskflow-web\.onrender\.com"/);
  const noMapping=resolveNativeExecutorProjectMappings(null,{workspaceId});
  assert.deepEqual(noMapping.map(row=>row.executorId),NATIVE_EXECUTORS);
  assert.ok(noMapping.every(row=>row.state==="GAP"));
  assert.doesNotMatch(app,/item\?\.acl_allowed===true|item\?\.access_allowed===true|item\?\.executor_id/);
});

test("AI Tasks route does not render a second Kanban or expose the general human Issue list",()=>{
  assert.match(html, /#\/tf\/ai-tasks/);
  assert.match(html, /tf-ai-task-state/);
  assert.doesNotMatch(html, /tf-ai-kanban|tf-ai-column|tf-ai-card/);
  assert.match(app, /route\.section==="ai-tasks"/);
  assert.match(app, /refs\.nativeIssuesPanel\.hidden=\["dispatch","ai-projects","ai-tasks"\]/);
  assert.match(app, /TaskFlow 原生 AI-managed Tasks 篩選介面/);
  assert.doesNotMatch(app, /function renderAiKanban|function loadAiBoard/);
});
