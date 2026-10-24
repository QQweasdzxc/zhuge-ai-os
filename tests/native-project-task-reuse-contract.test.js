import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {NATIVE_EXECUTORS, NATIVE_EXECUTOR_PROJECT_MAP_SCHEMA, NATIVE_EXECUTOR_PROJECT_MAP_SOURCE, nativeTaskFlowProjectPath, resolveNativeExecutorProjectMappings} from "../labs/taskflow/pages-client/native-project-mapping-contract.mjs";
import {selectVerifiedNativeAIIssues} from "../labs/taskflow/pages-client/dispatch-workbench.mjs";

const html=fs.readFileSync("labs/taskflow/pages-client/index.html","utf8");
const app=fs.readFileSync("labs/taskflow/pages-client/app.mjs","utf8");
const matrix=fs.readFileSync("docs/30_QA/site-integration-118/NATIVE-PROJECT-TASK-REUSE-MATRIX.md","utf8");
const workspaceId="11111111-1111-4111-8111-111111111111";
const projectIds={
  "CO-01":"22222222-2222-4222-8222-222222222222",
  "CO-02":"33333333-3333-4333-8333-333333333333",
  "CO-03":"44444444-4444-4444-8444-444444444444",
  "GEM-01":"55555555-5555-4555-8555-555555555555",
  "GH-HELPER":"66666666-6666-4666-8666-666666666666"
};
const now=Date.parse("2026-10-23T10:00:00.000Z");

function mappingRow(executorId,projectId=projectIds[executorId],overrides={}){
  return {executor_id:executorId,project_id:projectId,workspace_id:workspaceId,source:NATIVE_EXECUTOR_PROJECT_MAP_SOURCE,
    workspace_access:"ALLOW",project_access:"ALLOW",...overrides};
}
function mappingEnvelope(mappings=NATIVE_EXECUTORS.map(executor=>mappingRow(executor)),overrides={}){
  return {schema:NATIVE_EXECUTOR_PROJECT_MAP_SCHEMA,source:NATIVE_EXECUTOR_PROJECT_MAP_SOURCE,workspace_id:workspaceId,
    checked_at:new Date(now-1000).toISOString(),mappings,...overrides};
}
function issue(id,{workspace=workspaceId,status="todo",metadata={}}={}){
  return {id,workspace_id:workspace,project_id:projectIds["CO-01"],status,metadata};
}
function readModel(nativeIssue,{id="intent-1",executor="CO-01",state="UNKNOWN",workspace=workspaceId,overrides={}}={}){
  return {schema:"zhuge-taskflow-dispatch-persistence-v1",status_source:"TASKFLOW_RUNTIME_READ_MODEL",intent_id:id,
    issue_id:nativeIssue.id,workspace,executor_id:executor,provider:"codex",state,...overrides};
}

test("all five executor mappings remain GAP without a server-owned mapping envelope",()=>{
  const projects=NATIVE_EXECUTORS.map(executor_id=>({id:projectIds[executor_id],executor_id,workspace_id:workspaceId,acl_allowed:true,access_allowed:true,name:executor_id,slug:executor_id.toLowerCase()}));
  const resolved=resolveNativeExecutorProjectMappings(projects,{workspaceId,now});
  assert.deepEqual(resolved.map(row=>row.state),["GAP","GAP","GAP","GAP","GAP"]);
  assert.ok(resolved.every(row=>row.reason==="MAPPING_AUTHORITY_NOT_CONNECTED"));
});

test("a fresh server-owned unique mapping resolves only to an existing native Project UUID route",()=>{
  const resolved=resolveNativeExecutorProjectMappings(mappingEnvelope(),{workspaceId,now});
  assert.ok(resolved.every(row=>row.state==="VERIFIED"));
  assert.equal(resolved.length,5);
  assert.equal(new Set(resolved.map(row=>row.projectId)).size,5);
  assert.equal(nativeTaskFlowProjectPath("zhuge-team",projectIds["CO-01"]),`/zhuge-team/projects/${projectIds["CO-01"]}`);
  assert.equal(nativeTaskFlowProjectPath("zhuge-team","CO-01"),"");
});

test("duplicate executor mappings and one Project shared across executors fail closed",()=>{
  const duplicatedExecutor=mappingEnvelope([mappingRow("CO-01"),mappingRow("CO-01","77777777-7777-4777-8777-777777777777")]);
  const first=resolveNativeExecutorProjectMappings(duplicatedExecutor,{workspaceId,now});
  assert.equal(first.find(row=>row.executorId==="CO-01").reason,"DUPLICATE_EXECUTOR_MAPPING");

  const sharedProject=mappingEnvelope([mappingRow("CO-01",projectIds["CO-01"]),mappingRow("CO-02",projectIds["CO-01"])]);
  const second=resolveNativeExecutorProjectMappings(sharedProject,{workspaceId,now});
  assert.equal(second.find(row=>row.executorId==="CO-01").reason,"DUPLICATE_PROJECT_MAPPING");
  assert.equal(second.find(row=>row.executorId==="CO-02").reason,"DUPLICATE_PROJECT_MAPPING");
});

test("missing mapping, cross-Workspace, ACL denial, wrong authority, and stale evidence fail closed",()=>{
  const missing=resolveNativeExecutorProjectMappings(mappingEnvelope([]),{workspaceId,now});
  assert.ok(missing.every(row=>row.reason==="MAPPING_NOT_FOUND"));

  const crossWorkspace=resolveNativeExecutorProjectMappings(mappingEnvelope(undefined,{workspace_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),{workspaceId,now});
  assert.ok(crossWorkspace.every(row=>row.reason==="WORKSPACE_SCOPE_MISMATCH"));

  const denied=resolveNativeExecutorProjectMappings(mappingEnvelope([mappingRow("CO-01",projectIds["CO-01"],{project_access:"DENY"})]),{workspaceId,now});
  assert.equal(denied[0].reason,"NATIVE_ACL_DENIED_OR_UNVERIFIED");

  const wrongSource=resolveNativeExecutorProjectMappings(mappingEnvelope(undefined,{source:"CLIENT_METADATA"}),{workspaceId,now});
  assert.ok(wrongSource.every(row=>row.reason==="MAPPING_AUTHORITY_UNVERIFIED"));

  const stale=resolveNativeExecutorProjectMappings(mappingEnvelope(undefined,{checked_at:new Date(now-10*60*1000).toISOString()}),{workspaceId,now});
  assert.ok(stale.every(row=>row.reason==="MAPPING_AUTHORITY_STALE"));
});

test("only protected canonical Native Dispatch records project AI-managed Issues",()=>{
  const human=issue("human-1",{metadata:{zhuge_executor:"CO-01",zhuge_work_code:"FAKE-01"}});
  const managed=issue("native-issue-1");
  const selected=selectVerifiedNativeAIIssues([
    {issue:human,runtime:null},
    {issue:human,runtime:readModel(human,{id:"",overrides:{schema:"client-fake-schema"}})},
    {issue:managed,runtime:readModel(managed)}
  ],{workspaceId});
  assert.deepEqual(selected.map(row=>row.issueId),["native-issue-1"]);
  assert.equal(selected[0].nativeStatus,"todo");
  assert.equal(selected[0].executorId,"CO-01");
});

test("Native Issue ID deduplication keeps identical readbacks once and excludes conflicting snapshots",()=>{
  const duplicate=issue("native-duplicate");
  const conflicting=issue("native-conflict",{status:"todo"});
  const selected=selectVerifiedNativeAIIssues([
    {issue:duplicate,runtime:readModel(duplicate)},
    {issue:{...duplicate},runtime:readModel(duplicate)},
    {issue:conflicting,runtime:readModel(conflicting,{id:"intent-conflict-a"})},
    {issue:issue("native-conflict",{status:"in_progress"}),runtime:readModel(conflicting,{id:"intent-conflict-b",state:"RUNNING"})}
  ],{workspaceId});
  assert.deepEqual(selected.map(row=>row.issueId),["native-duplicate"]);
});

test("AI Project and AI Tasks routes do not fall back to human Issue lists or a custom Kanban",()=>{
  assert.match(html,/href="#\/tf\/ai-projects"/);
  assert.match(html,/href="#\/tf\/ai-tasks"/);
  assert.match(html,/tf-ai-task-state/);
  assert.doesNotMatch(html,/tf-ai-kanban|tf-ai-column|tf-ai-card/);
  assert.match(app,/route\.section==="ai-tasks"/);
  assert.match(app,/refs\.nativeIssuesPanel\.hidden=\["dispatch","ai-projects","ai-tasks"\]/);
  assert.match(app,/Native Project：|TaskFlow Native Project：/);
  assert.match(app,/native_executor_project_mappings/);
  assert.doesNotMatch(app,/acl_allowed===true|access_allowed===true|item\?\.executor_id\|\|item\?\.executor/);
  assert.match(app,/TaskFlow 原生 AI-managed Tasks 篩選介面/);
  assert.match(matrix,/has no safe bulk AI filter today/);
  assert.match(matrix,/不載入未過濾的人類 Issue/);
});

test("unsupported native mutations remain a real integration gap",()=>{
  assert.match(matrix,/Status movement／drag/);
  assert.match(matrix,/不提供前端假更新/);
  assert.match(matrix,/改派與歷史/);
  assert.match(matrix,/Project status movement mutation contract/);
});
