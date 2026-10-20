const test=require("node:test");
const assert=require("node:assert/strict");
const {assess}=require("../tools/taskflow-pages-feasibility");
test("DM-00 to DM-03 native TaskFlow Review candidate stays gated from Production",()=>{
 const r=assess();
 assert.equal(r.scope,"DM00_DM03_REVIEW");
 assert.equal(r.status,"DM_REVIEW_CANDIDATE_READY_FOR_RUNTIME_QA");
 for(const [name,pass] of Object.entries(r.gates))assert.equal(pass,true,name);
 assert.equal(r.deploymentAllowed,false,"release requires published runtime QA and PM acceptance");
 assert.equal(r.pmRuntimeQARequired,true);
 assert.equal(r.otherPagesOutsideScope,true);
 assert.equal(r.githubAppAllowed,false);
 assert.equal(r.taskflowLiveDispatchAllowed,true);
});
