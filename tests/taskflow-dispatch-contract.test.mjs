import test from "node:test";
import assert from "node:assert/strict";
import {
  DISPATCH_METADATA_KEYS,
  buildIssuePayload,
  buildMetadata,
  deriveDispatchState,
  isExactSha,
  requiredGithubUrl,
  requiredHttpsUrl
} from "../labs/taskflow/pages-client/dispatch-contract.mjs";

const form={
  workCode:"DM-02",
  title:"接通真實 Agent 啟動入口",
  owner:"CO-02",
  priority:"urgent",
  agentId:"agent-uuid",
  nextStep:"確認 provider capability 與 ACK readback",
  sourceEvidence:"https://github.com/QQweasdzxc/zhuge-ai-os/issues/51",
  acceptance:"PM 可在 native card 看到 task ID 與 provider evidence",
  github:{
    issueUrl:"https://github.com/QQweasdzxc/zhuge-ai-os/issues/51",
    prUrl:"https://github.com/QQweasdzxc/zhuge-ai-os/pull/95",
    commitUrl:"https://github.com/QQweasdzxc/zhuge-ai-os/commit/0123456789abcdef0123456789abcdef01234567",
    ciUrl:"https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/1",
    sha:"0123456789abcdef0123456789abcdef01234567"
  }
};

test("DM payload is a native TaskFlow issue payload with no second task id",()=>{
  const payload=buildIssuePayload(form);
  assert.equal(payload.title,"DM-02｜接通真實 Agent 啟動入口");
  assert.equal(payload.status,"todo");
  assert.equal(payload.priority,"urgent");
  assert.equal(payload.assignee_type,"agent");
  assert.equal(payload.assignee_id,"agent-uuid");
  assert.match(payload.description,/工作編號：DM-02/);
  assert.match(payload.description,/Provider Run ID：未取得/);
});

test("native metadata preserves required intake and evidence fields as flat primitives",()=>{
  const metadata=buildMetadata(form,{dispatchStatus:"ACK_PENDING",taskId:"task-1",observedAt:"2026-10-20T00:00:00.000Z"});
  assert.equal(metadata[DISPATCH_METADATA_KEYS.workCode],"DM-02");
  assert.equal(metadata[DISPATCH_METADATA_KEYS.dispatchStatus],"ACK_PENDING");
  assert.equal(metadata[DISPATCH_METADATA_KEYS.taskId],"task-1");
  assert.equal(metadata[DISPATCH_METADATA_KEYS.githubSha],form.github.sha);
  assert.equal(metadata[DISPATCH_METADATA_KEYS.githubShaSource],"manual_record_pending_native_readback");
  assert.ok(Object.values(metadata).every(value=>["string","number","boolean"].includes(typeof value)));
});

test("dispatch state trusts active native task runs over stale metadata",()=>{
  const issue={metadata:{[DISPATCH_METADATA_KEYS.dispatchStatus]:"ACK_PENDING"}};
  assert.equal(deriveDispatchState(issue,[{id:"task-1",status:"running"}]),"RUNNING");
  assert.equal(deriveDispatchState(issue,[{id:"task-2",status:"queued"}]),"ACK_PENDING");
  assert.equal(deriveDispatchState({metadata:{[DISPATCH_METADATA_KEYS.dispatchStatus]:"BLOCKED"}},[]),"BLOCKED");
});

test("source and GitHub evidence reject unsafe or incomplete references",()=>{
  assert.equal(requiredHttpsUrl("https://example.com/evidence"),"https://example.com/evidence");
  assert.equal(requiredGithubUrl("https://github.com/org/repo/issues/1"),"https://github.com/org/repo/issues/1");
  assert.throws(()=>requiredHttpsUrl("http://example.com/evidence"),/https/);
  assert.throws(()=>requiredGithubUrl("https://example.com/issues/1"),/GitHub/);
  assert.equal(isExactSha("0123456789abcdef0123456789abcdef01234567"),true);
  assert.equal(isExactSha("0123456"),false);
});

test("dispatch contract accepts stable cross-module work codes and truthful terminal states",()=>{
  assert.doesNotThrow(()=>buildIssuePayload({workCode:"OPS-001",title:"Ops",owner:"CO-02",priority:"high"}));
  assert.equal(deriveDispatchState({metadata:{zhuge_dispatch_status:"FAILED",zhuge_observed_at:new Date().toISOString()}},[{status:"failed"}]),"FAILED");
  assert.equal(deriveDispatchState({metadata:{zhuge_dispatch_status:"RUNNING",zhuge_observed_at:new Date(Date.now()-31*60*1000).toISOString()}},[]),"STALE");
  assert.equal(deriveDispatchState(null,[]),"UNKNOWN");
});
