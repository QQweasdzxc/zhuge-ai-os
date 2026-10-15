import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createTaskflowIssueReader, validateTaskflowIssue, verifyNativeDispatch
} from "../labs/cloud-handoff/taskflow-bridge.mjs";
import { previewCodexMention, createCodexGithubMentionAdapter } from "../labs/cloud-handoff/codex-github-mention.mjs";
import { transitionHandoff } from "../labs/cloud-handoff/contract.mjs";
import { dispatchTaskflowCodex } from "../labs/cloud-handoff/taskflow-codex-dispatch.mjs";

const ISSUE="11111111-1111-4111-8111-111111111111";
const WORKSPACE="22222222-2222-4222-8222-222222222222";
const PROJECT="33333333-3333-4333-8333-333333333333";
const SHA="199ea823af0692ca99e222b024ee3238cbc3a9fc";
const REPO="QQweasdzxc/zhuge-ai-os";
const APPROVAL="PMAPPROVED-20261015-001";
function native(){
  return {id:ISSUE,workspace_id:WORKSPACE,project_id:PROJECT,revision:7,
    identifier:"LAB-51",title:"Co/Gem cloud dispatch",status:"in_progress",
    status_category:"started",duplicate_of:null};
}
function ready(){
  const path=new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json",import.meta.url);
  const m=JSON.parse(readFileSync(path,"utf8"));
  m.source.clean=true;m.source.dirty_files=0;
  m.task.taskflow_issue_id=ISSUE;
  m.next_actor="co";
  const released=transitionHandoff(m,{
    action:"writer_stopped",actor:"co",expected_revision:0,
    at:"2026-10-15T10:00:00Z",stop_evidence:"provider-stop-verified-receipt"
  });
  return released;
}
function nativeReader(){return async()=>native();}
function safeAdapters(overrides={}){
  let posted=0;
  const mockFetch=async(url,options)=>{
    posted++;
    assert.equal(url,"https://api.github.com/repos/"+REPO+"/issues/52/comments");
    assert.equal(options.method,"POST");
    assert.match(JSON.parse(options.body).body,/^@codex/);
    assert.match(JSON.parse(options.body).body,/Checkpoint SHA: 199ea823/);
    return Response.json({id:999881,html_url:"https://github.com/"+REPO+"/pull/52#issuecomment-999881"},{status:201});
  };
  const launchGithubMention=createCodexGithubMentionAdapter({
    repository:REPO,prNumber:52,token:"test-only-fake-token",
    writeEnabled:true,fetcher:mockFetch,
    approvalVerifier:async()=>true,liveHeadVerifier:async()=>true
  });
  const args={
    snapshot:ready(),workspaceId:WORKSPACE,projectId:PROJECT,
    expectedTaskflowRevision:7,readTaskflowIssue:nativeReader(),
    authorizePM:async()=>true,verifyApprovalRef:async()=>true,approvalId:APPROVAL,
    now:"2026-10-15T10:01:00Z",leaseId:"unique-trusted-claim-id-123",
    leaseUntil:"2026-10-15T11:01:00Z",
    verifyGitHead:async()=>true,verifyWorkerStopped:async()=>true,
    claimWithCas:async({next})=>({committed:true,revision:next.revision}),
    launchGithubMention,
    ...overrides
  };
  return {args,getPosts:()=>posted};
}

test("native TF GET authenticates to /api/issues/:id and keeps DB authority",async()=>{
  let calls=0;
  const reader=createTaskflowIssueReader({
    apiOrigin:"https://taskflow-api.example.test/",
    accessToken:"server-only-test-bearer",
    fetcher:async(url,options)=>{
      calls++;
      assert.equal(url,"https://taskflow-api.example.test/api/issues/"+ISSUE+"/?workspace_id="+WORKSPACE);
      assert.equal(options.method,"GET");
      assert.equal(options.headers.Authorization,"Bearer server-only-test-bearer");
      assert.equal(options.redirect,"error");
      return Response.json(native());
    }
  });
  const result=await reader.load({issueId:ISSUE,workspaceId:WORKSPACE,projectId:PROJECT,revision:7});
  assert.equal(result.identifier,"LAB-51");
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(result).includes("server-only-test-bearer"));
});

test("cross-workspace, wrong project, stale revision and completed native tasks DENY",()=>{
  for(const change of [
    x=>{x.workspace_id=PROJECT;},
    x=>{x.project_id=WORKSPACE;},
    x=>{x.revision=6;},
    x=>{x.status_category="done";},
    x=>{x.status_category="";},
    x=>{x.duplicate_of={id:"another"};}
  ]){
    const input=native();change(input);
    assert.throws(()=>validateTaskflowIssue(input,{issueId:ISSUE,workspaceId:WORKSPACE,projectId:PROJECT,revision:7}),/taskflow bridge/);
  }
});

test("TaskFlow identity and authorized PM gate must both pass",async()=>{
  const snap=ready();
  await assert.rejects(verifyNativeDispatch({
    snapshot:snap,workspaceId:WORKSPACE,projectId:PROJECT,expectedRevision:7,
    readIssue:nativeReader(),authorizePM:async()=>false
  }),/PM authorization denied/);
  await assert.rejects(verifyNativeDispatch({
    snapshot:snap,workspaceId:WORKSPACE,projectId:PROJECT,expectedRevision:7,
    readIssue:async()=>({...native(),workspace_id:PROJECT}),authorizePM:async()=>true
  }),/workspace mismatch/);
  const missing=structuredClone(snap);missing.task.taskflow_issue_id=null;
  await assert.rejects(verifyNativeDispatch({
    snapshot:missing,workspaceId:WORKSPACE,projectId:PROJECT,expectedRevision:7,
    readIssue:nativeReader(),authorizePM:async()=>true
  }),/native mapping missing/);
});

test("authorized TF→GitHub simulation creates exactly one comment but no provider ACK",async()=>{
  const {args,getPosts}=safeAdapters();
  const output=await dispatchTaskflowCodex(args);
  assert.deepEqual(output,{
    state:"PENDING_PROVIDER_ACK",dispatchReceipt:"github-comment-999881",claimedRevision:2
  });
  assert.equal(getPosts(),1);
});

test("unauthorized PM, stale TF revision and wrong assigned actor never post",async()=>{
  for(const override of [
    {authorizePM:async()=>false},
    {verifyApprovalRef:async()=>false},
    {expectedTaskflowRevision:8},
    {snapshot:{...ready(),next_actor:"gem"}},
    {approvalId:"short"}
  ]){
    const {args,getPosts}=safeAdapters(override);
    await assert.rejects(dispatchTaskflowCodex(args));
    assert.equal(getPosts(),0);
  }
});

test("opaque PM reference alone is not approval: transport checks the trusted authority",async()=>{
  let posts=0;
  const adapter=createCodexGithubMentionAdapter({
    repository:REPO,prNumber:52,token:"test-only-fake-token",
    writeEnabled:true,approvalVerifier:async()=>false,
    liveHeadVerifier:async()=>true,
    fetcher:async()=>{posts++;return Response.json({id:123,html_url:"incorrect"},{status:201});}
  });
  const {args}=safeAdapters({launchGithubMention:adapter});
  // The initial approval was valid and CAS already committed. Revocation
  // between claim and comment is quarantined, never silently retried.
  await assert.rejects(dispatchTaskflowCodex(args),/needs reconciliation/);
  assert.equal(posts,0);
});

test("disabled adapter, changed live PR head and stale CAS cannot trigger Codex",async()=>{
  for(const failure of ["disabled","sha","cas"]){
    let posted=0;
    const a=safeAdapters();
    const disabled=createCodexGithubMentionAdapter({
      repository:REPO,prNumber:52,token:"test-only-fake-token",
      writeEnabled:false,
      approvalVerifier:async()=>true,liveHeadVerifier:async()=>true,
      fetcher:async()=>{posted++;throw Error("no calls expected");}
    });
    const overrides=failure==="disabled"?{launchGithubMention:disabled}:
      failure==="sha"?{verifyGitHead:async()=>false}:
      {claimWithCas:async()=>({committed:false})};
    await assert.rejects(dispatchTaskflowCodex({...a.args,...overrides}));
    assert.equal(a.getPosts(),0);
    assert.equal(posted,0);
  }
});

test("comment failure AFTER CAS is quarantined; no retry is attempted",async()=>{
  let attempts=0;
  const adapter=createCodexGithubMentionAdapter({
    repository:REPO,prNumber:52,token:"test-only-fake-token",
    writeEnabled:true,
    approvalVerifier:async()=>true,liveHeadVerifier:async()=>true,
    fetcher:async()=>{attempts++;return new Response("unavailable",{status:503});}
  });
  const {args}=safeAdapters({launchGithubMention:adapter});
  await assert.rejects(dispatchTaskflowCodex(args),/needs reconciliation/);
  assert.equal(attempts,1);
});

test("mention text preview is deterministic and does not contain token or TaskFlow private context",()=>{
  const p=previewCodexMention({
    repository:REPO,prNumber:52,issueNumber:51,sha:SHA,
    taskflowIdentifier:"LAB-51",approvalId:APPROVAL
  });
  assert.match(p.body,/@codex/);
  assert.match(p.body,/Draft PR #52/);
  assert.match(p.body,/Issue #51/);
  assert.doesNotMatch(p.body,/test-only-fake-token/);
});
