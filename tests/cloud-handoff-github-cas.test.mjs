import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transitionHandoff } from "../labs/cloud-handoff/contract.mjs";
import { createGithubCasStore } from "../labs/cloud-handoff/github-cas.mjs";
const b = () => JSON.parse(readFileSync(new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json", import.meta.url), "utf8"));
function ready() {
  const r=b();r.source.clean=true;r.source.dirty_files=0;
  return transitionHandoff(r,{action:"writer_stopped",actor:"co",expected_revision:0,at:"2026-10-15T06:00:00Z",stop_evidence:"provider-confirmed-stopped-20261015"});
}
const git = "199ea823af0692ca99e222b024ee3238cbc3a9fc";
function proposal() {
  const current=ready();
  const next=transitionHandoff(current,{
    action:"claim",actor:"gem",expected_revision:1,
    at:"2026-10-15T06:05:00Z",lease_id:"unique-generated-lease-1234567",
    lease_until:"2026-10-15T07:05:00Z",verified_git_sha:git
  });
  return {current,next};
}
const repo="QQweasdzxc/zhuge-ai-os";
function mockFetch(current, {branchSha=git,putStatus=201}={}) {
  const calls=[];
  const fetcher=async(url,opt)=>{
    calls.push({url,method:opt.method,hasAuth:Boolean(opt.headers.Authorization)});
    if(url.includes("/contents/") && opt.method==="GET"){
      return Response.json({type:"file",sha:"old-blob-sha",encoding:"base64",content:Buffer.from(JSON.stringify(current)).toString("base64")});
    }
    if(url.includes("/branches/"))return Response.json({commit:{sha:branchSha}});
    if(opt.method==="PUT"){
      if(putStatus!==201)return new Response("conflict",{status:putStatus});
      const body=JSON.parse(opt.body);
      assert.equal(body.sha,"old-blob-sha");
      assert.equal(body.branch,"review/cloud-ledger-test");
      const pushed=JSON.parse(Buffer.from(body.content,"base64").toString("utf8"));
      assert.equal(pushed.phase,"CLAIMED");
      return Response.json({content:{sha:"new-blob-sha"},commit:{sha:"new-commit-sha"}},{status:201});
    }
    throw Error("unhandled fake Github request");
  };
  return {fetcher,calls};
}
function adapter(fetcher) {
  return createGithubCasStore({repository:repo,ledgerBranch:"review/cloud-ledger-test",token:"test-secret-not-real",fetcher});
}
test("a durable GitHub Contents CAS claim validates task and branch SHA",async()=>{
  const {current,next}=proposal();
  const f=mockFetch(current);const store=adapter(f.fetcher);
  const result=await store.claimWithCas({task:"GH-45",expectedRevision:1,expectedSha:git,next});
  assert.equal(result.committed,true);
  assert.equal(result.revision,2);
  assert.equal(f.calls.length,3);
  assert.ok(f.calls.every(x=>x.hasAuth));
});
test("GitHub branch moved before CAS: no remote write",async()=>{
  const {current,next}=proposal();
  const f=mockFetch(current,{branchSha:"a".repeat(40)});
  const r=await adapter(f.fetcher).claimWithCas({task:"GH-45",expectedRevision:1,expectedSha:git,next});
  assert.equal(r.committed,false);
  assert.equal(r.reason,"source_branch_moved");
  assert.ok(!f.calls.some(x=>x.method==="PUT"));
});
test("simultaneous CAS writer loses with 409 rather than launching",async()=>{
  const {current,next}=proposal();
  const f=mockFetch(current,{putStatus:409});
  const r=await adapter(f.fetcher).claimWithCas({task:"GH-45",expectedRevision:1,expectedSha:git,next});
  assert.deepEqual(r,{committed:false,reason:"concurrent_cas_conflict"});
});
test("no claim without seeded handoff; malicious task path and main ledger rejected",async()=>{
  const {current,next}=proposal();
  const f=mockFetch({...current,revision:0});
  assert.equal((await adapter(f.fetcher).claimWithCas({task:"GH-45",expectedRevision:1,expectedSha:git,next})).committed,false);
  assert.throws(()=>createGithubCasStore({repository:repo,ledgerBranch:"main",token:"x"}),/isolated/);
  await assert.rejects(adapter(f.fetcher).load("../bad"),/invalid task id/);
});
test("token is never returned as a public manifest field",async()=>{
  const {current}=proposal();const f=mockFetch(current);
  const read=await adapter(f.fetcher).load("GH-45");
  assert.equal(read.data.owner,null);
  assert.ok(!JSON.stringify(read).includes("test-secret-not-real"));
});
