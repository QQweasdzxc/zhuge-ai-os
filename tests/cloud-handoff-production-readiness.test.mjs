import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transitionHandoff} from "../labs/cloud-handoff/contract.mjs";
import {inspectTaskflowCoReadiness} from "../labs/cloud-handoff/production-readiness.mjs";

const ISSUE="11111111-1111-4111-8111-111111111111";
const WORKSPACE="22222222-2222-4222-8222-222222222222";
const PROJECT="33333333-3333-4333-8333-333333333333";
function native(){
  return {id:ISSUE,workspace_id:WORKSPACE,project_id:PROJECT,revision:7,
    identifier:"LAB-51",title:"Cloud job",status:"in_progress",status_category:"started",duplicate_of:null};
}
function ready(){
  const input=JSON.parse(readFileSync(new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json",import.meta.url),"utf8"));
  input.source.clean=true;input.source.dirty_files=0;input.task.taskflow_issue_id=ISSUE;input.next_actor="co";
  return transitionHandoff(input,{action:"writer_stopped",actor:"co",expected_revision:0,
    at:"2026-10-15T10:00:00Z",stop_evidence:"provider-stopped-verified-receipt"});
}
function inputs(overrides={}){
  return {workspaceId:WORKSPACE,projectId:PROJECT,issueId:ISSUE,revision:7,
    loadNativeIssue:async()=>native(),loadHandoff:async()=>ready(),
    checkGithubHead:async()=>true,verifyPmScope:async()=>true,
    verifyServerConfiguration:async()=>true,...overrides};
}
test("readiness never dispatches, writes, or claims Co running",async()=>{
  const status=await inspectTaskflowCoReadiness(inputs());
  assert.equal(status.status,"READY_FOR_PM_REVIEW");
  assert.equal(status.dispatchEnabled,false);
  assert.equal(status.providerRunning,false);
  assert.equal(status.issue,"LAB-51");
});
test("no server authority and invalid native IDs refuse without invoking adapters",async()=>{
  assert.equal((await inspectTaskflowCoReadiness({})).code,"INVALID_TASKFLOW_IDENTITY");
  assert.equal((await inspectTaskflowCoReadiness(inputs({verifyPmScope:null}))).code,"SERVER_AUTHORITY_NOT_CONFIGURED");
  let reads=0;
  const r=await inspectTaskflowCoReadiness(inputs({verifyPmScope:async()=>false,
    loadNativeIssue:async()=>{reads++;return native()}}));
  assert.equal(r.code,"TASKFLOW_PM_SCOPE_UNVERIFIED");assert.equal(reads,0);
});
test("missing checkpoint, stale GitHub SHA and missing provider authority all fail closed",async()=>{
  const blocked=await inspectTaskflowCoReadiness(inputs({loadHandoff:async()=>{
    const x=ready();x.phase="BLOCKED_CHECKPOINT";x.owner="co";x.lease=null;x.source.clean=false;
    x.source.dirty_files=4;x.source.executor_stopped=false;return x;
  }}));
  assert.equal(blocked.status,"BLOCKED");
  assert.equal((await inspectTaskflowCoReadiness(inputs({checkGithubHead:async()=>false}))).code,"GITHUB_HEAD_UNVERIFIED");
  assert.equal((await inspectTaskflowCoReadiness(inputs({verifyServerConfiguration:async()=>false}))).code,"SERVER_OR_PROVIDER_NOT_AUTHORIZED");
});
test("cannot fake a TaskFlow project or issue mapping, errors are sanitized",async()=>{
  assert.equal((await inspectTaskflowCoReadiness(inputs({loadNativeIssue:async()=>({...native(),project_id:WORKSPACE})}))).code,"READINESS_EVIDENCE_UNAVAILABLE");
  assert.equal((await inspectTaskflowCoReadiness(inputs({loadHandoff:async()=>({...ready(),task:{...ready().task,taskflow_issue_id:null}})}))).code,"HANDOFF_TASKFLOW_MAPPING_MISMATCH");
  assert.equal((await inspectTaskflowCoReadiness(inputs({loadNativeIssue:async()=>{throw Error("sensitive bearer");}}))).code,"READINESS_EVIDENCE_UNAVAILABLE");
});
