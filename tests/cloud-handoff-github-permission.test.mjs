import test from "node:test";
import assert from "node:assert/strict";
import {assessGitHubCodexCommentPermission} from "../labs/cloud-handoff/github-comment-permission.mjs";
const REPO="QQweasdzxc/zhuge-ai-os",APP_ID=5342644,AT=Date.parse("2026-10-16T10:00:00Z");
const verified=(overrides={})=>({source:"authenticated_github_app_api",app_id:APP_ID,
 installation_id:111,repository_full_name:REPO,repository_selection:"selected",
 repository_access_confirmed:true,permissions:{metadata:"read",pull_requests:"read",issues:"write"},
 verified_at:"2026-10-16T09:59:00Z",...overrides});
const gate=evidence=>assessGitHubCodexCommentPermission({repository:REPO,expectedAppId:APP_ID,evidence,now:AT});
test("GitHub PR comment requires one actual write permission; GitHub PR read is insufficient",()=>{
 const readonly=verified({permissions:{metadata:"read",contents:"read",pull_requests:"read",checks:"read",statuses:"read"}});
 assert.deepEqual(gate(readonly),{allowed:false,reason:"GITHUB_PR_COMMENT_WRITE_PERMISSION_MISSING"});
 assert.equal(gate(verified()).allowed,true);
 assert.equal(gate(verified({permissions:{pull_requests:"write"}})).allowed,true);
});
test("connected app is not sufficient proof of selected repository access",()=>{
 for(const modification of [
  {repository_access_confirmed:false},{repository_full_name:"evil-other/repo"},
  {repository_selection:"unknown"},{repository_selection:"selected",repository_access_confirmed:"yes"}
 ])assert.equal(gate(verified(modification)).allowed,false);
});
test("a different app, missing installation or untrusted UI state cannot authorize a post",()=>{
 for(const modification of [
  {source:"browser_checkbox"},{app_id:1},{installation_id:null},
  {installation_id:0}
 ])assert.equal(gate(verified(modification)).allowed,false);
 assert.equal(gate(undefined).allowed,false);
});
test("stale, future or absent permission evidence is never accepted",()=>{
 for(const when of ["2026-10-16T09:50:00Z","2026-10-16T10:01:00Z","invalid",""])
  assert.equal(gate(verified({verified_at:when})).allowed,false);
});
test("fail closed on unknown or malformed scope",()=>{
 assert.equal(assessGitHubCodexCommentPermission({repository:"",expectedAppId:APP_ID,evidence:verified(),now:AT}).allowed,false);
 assert.equal(assessGitHubCodexCommentPermission({repository:REPO,expectedAppId:0,evidence:verified(),now:AT}).allowed,false);
 assert.equal(gate(verified({permissions:null})).allowed,false);
 assert.equal(gate(verified({permissions:{issues:"READ",pull_requests:"write-ish"}})).allowed,false);
});
