const test=require("node:test");
const assert=require("node:assert/strict");
const {assess}=require("../tools/taskflow-pages-feasibility");
test("home-only native TaskFlow candidate is implemented without expanding to inner pages",()=>{
 const r=assess();
 assert.equal(r.scope,"HOME_ONLY");
 assert.equal(r.status,"HOME_CANDIDATE_READY_FOR_RUNTIME_QA");
 for(const [name,pass] of Object.entries(r.gates))assert.equal(pass,true,name);
 assert.equal(r.deploymentAllowed,false,"release requires published runtime QA and PM acceptance");
 assert.equal(r.pmRuntimeQARequired,true);
 assert.equal(r.otherPagesOutsideScope,true);
 assert.equal(r.githubAppAllowed,false);
 assert.equal(r.taskflowLiveDispatchAllowed,false);
});