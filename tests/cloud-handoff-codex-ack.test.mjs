import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transitionHandoff } from "../labs/cloud-handoff/contract.mjs";
import { previewCodexMention } from "../labs/cloud-handoff/codex-github-mention.mjs";
import {
  parseCodexAck,assessCodexAck,createCodexAckReader
} from "../labs/cloud-handoff/codex-ack-reconciler.mjs";

const REPO="QQweasdzxc/zhuge-ai-os";
const SHA="199ea823af0692ca99e222b024ee3238cbc3a9fc";
const NONCE="0123456789abcdef0123456789abcdef";
const THREAD="01a13ee3-8cb4-7e81-9cac-b26a6cebf570";
const PR=52,REQUEST_ID=11881,ACK_ID=11882;
const BASE="https://github.com/"+REPO+"/pull/"+PR+"#issuecomment-";
const API="https://api.github.com/repos/"+REPO+"/issues/"+PR;
const AT="2026-10-15T10:10:00Z";
const user={login:"QQweasdzxc",type:"User"};
const bot={login:"chatgpt-codex-connector[bot]",type:"Bot"};

function claimed(){
  const p=new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json",import.meta.url);
  const r=JSON.parse(readFileSync(p,"utf8"));
  r.source.clean=true;r.source.dirty_files=0;r.next_actor="co";
  const ready=transitionHandoff(r,{action:"writer_stopped",actor:"co",
    expected_revision:0,at:"2026-10-15T10:00:00Z",
    stop_evidence:"codex-worker-confirmed-stopped"});
  return transitionHandoff(ready,{action:"claim",actor:"co",
    expected_revision:1,at:"2026-10-15T10:00:01Z",
    lease_id:"server-generated-unique-lease-ABC",
    lease_until:"2026-10-15T11:00:00Z",verified_git_sha:SHA,
    dispatch_id:NONCE});
}
function request(){
  return {id:REQUEST_ID,issue_url:API,html_url:BASE+REQUEST_ID,
    created_at:"2026-10-15T10:00:02Z",user,
    body:previewCodexMention({
      repository:REPO,prNumber:PR,issueNumber:45,sha:SHA,
      taskflowIdentifier:"LAB-45",approvalId:"approved-20261015-051",dispatchId:NONCE
    }).body};
}
function ackBody(changes={}){
  return '<!-- ZHUGE_CODEX_ACK_V1 '+JSON.stringify({
    dispatch_id:NONCE,checkpoint_sha:SHA,status:"accepted",thread_id:THREAD,
    ...changes
  })+' -->\n\nProvider read-only acknowledgement; nothing committed.';
}
function ack(changes={},body=ackBody()){
  return {id:ACK_ID,issue_url:API,html_url:BASE+ACK_ID,
    created_at:"2026-10-15T10:02:00Z",user:bot,body,...changes};
}
function assess(comments=[ack()],changes={}){
  return assessCodexAck({claim:claimed(),requestComment:request(),
    candidateComments:comments,repository:REPO,prNumber:PR,
    expectedRequestCommentId:REQUEST_ID,now:AT,...changes});
}

test("Codex ack requires a single exact machine-readable first-line marker",()=>{
  assert.equal(parseCodexAck(ackBody()).thread_id,THREAD);
  assert.equal(parseCodexAck("Quote:\n"+ackBody()),null);
  assert.equal(parseCodexAck(ackBody({thread_id:null})),null);
  assert.equal(parseCodexAck(ackBody({unknown_field:true})),null);
  assert.equal(parseCodexAck(ackBody({status:"blocked",thread_id:THREAD})),null);
  assert.equal(parseCodexAck(ackBody({status:"blocked",thread_id:null})).status,"blocked");
  assert.equal(parseCodexAck("<!-- ZHUGE_CODEX_ACK_V1 {bad json} -->"),null);
  assert.equal(parseCodexAck("<script>fake</script>"),null);
});
test("one official bot ACK with matching nonce, SHA, PR is observed, not RUNNING",()=>{
  const out=assess([request(),ack()]);
  assert.deepEqual(out,{
    state:"PROVIDER_ACK_OBSERVED",dispatchId:NONCE,requestedSha:SHA,
    reportedThreadId:THREAD,requestCommentId:REQUEST_ID,
    ackCommentId:ACK_ID,ackUrl:BASE+ACK_ID,requiresTaskflowRunVerification:true
  });
});
test("human impersonation, wrong scope, stale comments, missing marker all remain pending",()=>{
  const cases=[
    ack({user:{login:"chatgpt-codex-connector[bot]",type:"User"}}),
    ack({user:{login:"lookalike[bot]",type:"Bot"}}),
    ack({issue_url:"https://api.github.com/repos/other/repo/issues/52"}),
    ack({html_url:"https://github.com/another/repo/pull/52#issuecomment-11882"}),
    ack({id:100,html_url:BASE+100}),
    ack({created_at:"2026-10-15T09:00:00Z"}),
    ack({},'not a structured acknowledgement'),
    ack({},ackBody({dispatch_id:"abcdefabcdefabcdefabcdefabcdefab"}))
  ];
  for(const candidate of cases){
    const out=assess([candidate]);assert.equal(out.state,"PENDING_PROVIDER_ACK");
  }
});
test("bot response with same nonce but changed SHA or duplicate valid ACK is quarantined",()=>{
  assert.equal(assess([ack({},ackBody({checkpoint_sha:"a".repeat(40)}))]).state,
    "ACK_CONFLICT_REQUIRES_REVIEW");
  const next=ack({id:11900,html_url:BASE+11900,created_at:"2026-10-15T10:03:00Z"});
  assert.equal(assess([ack(),next]).state,"ACK_CONFLICT_REQUIRES_REVIEW");
});
test("provider blocked report never counts as launched",()=>{
  const result=assess([ack({},ackBody({status:"blocked",thread_id:null}))]);
  assert.equal(result.state,"PROVIDER_BLOCKED_OBSERVED");
  assert.equal(result.reportedThreadId,null);
  assert.equal(result.requiresTaskflowRunVerification,true);
});
test("original comment and persisted CAS identity must match or fail closed",()=>{
  const badReq={...request(),body:request().body.replace(NONCE,"f".repeat(32))};
  assert.throws(()=>assess([ack()],{requestComment:badReq}),/original GitHub request/);
  assert.throws(()=>assess([ack()],{expectedRequestCommentId:11879}),/request receipt/);
  const badClaim=claimed();badClaim.dispatch.id="f".repeat(32);
  assert.throws(()=>assess([ack()],{claim:badClaim}),/original GitHub request/);
  const unclaimed=claimed();unclaimed.phase="HANDOFF_READY";
  assert.throws(()=>assess([ack()],{claim:unclaimed}),/cloud handoff|durable writer claim/);
});
test("official authenticated GitHub read path is GET-only, and needs exact PR HEAD",async()=>{
  const urls=[];
  const fetcher=async (url,options)=>{
    urls.push({url,method:options.method,authenticated:Boolean(options.headers.Authorization)});
    if(url.endsWith("/issues/comments/"+REQUEST_ID))return Response.json(request());
    if(url.includes("/issues/52/comments?"))return Response.json([request(),ack()]);
    if(url.endsWith("/pulls/52"))return Response.json({number:52,state:"open",head:{sha:SHA}});
    throw Error("unexpected URL "+url);
  };
  const r=createCodexAckReader({repository:REPO,prNumber:PR,token:"test-only-github-token",fetcher});
  assert.equal((await r.reconcile({claim:claimed(),requestCommentId:REQUEST_ID,now:AT})).state,
    "PROVIDER_ACK_OBSERVED");
  assert.equal(urls.length,3);
  assert.ok(urls.every(x=>x.method==="GET"&&x.authenticated));
});
test("changed live PR HEAD and GitHub 403 cannot be treated as a provider ACK",async()=>{
  const reader=createCodexAckReader({repository:REPO,prNumber:PR,
    token:"test-only-github-token",fetcher:async (url)=>{
      if(url.endsWith("/issues/comments/"+REQUEST_ID))return Response.json(request());
      if(url.includes("/issues/52/comments?"))return Response.json([ack()]);
      return Response.json({number:52,state:"open",head:{sha:"f".repeat(40)}});
    }});
  const a=await reader.reconcile({claim:claimed(),requestCommentId:REQUEST_ID,now:AT});
  assert.equal(a.state,"ACK_CONFLICT_REQUIRES_REVIEW");
  assert.equal(a.reason,"review_branch_changed");
  const forbidden=createCodexAckReader({repository:REPO,prNumber:PR,
    token:"test-only-github-token",fetcher:async()=>new Response("denied",{status:403})});
  await assert.rejects(forbidden.reconcile({claim:claimed(),requestCommentId:REQUEST_ID,now:AT}),/read unavailable/);
});
test("no complete GitHub pagination means no claim of success",async()=>{
  const reader=createCodexAckReader({repository:REPO,prNumber:PR,
    token:"test-only-github-token",fetcher:async url=>{
      if(url.endsWith("/issues/comments/"+REQUEST_ID))return Response.json(request());
      if(url.includes("/issues/52/comments?"))return Response.json(Array(100).fill(ack()));
      throw Error("must not reach PR after incomplete page scan");
    }});
  const r=await reader.reconcile({claim:claimed(),requestCommentId:REQUEST_ID,now:AT});
  assert.equal(r.state,"ACK_CONFLICT_REQUIRES_REVIEW");
  assert.equal(r.reason,"unbounded_comment_history");
});
