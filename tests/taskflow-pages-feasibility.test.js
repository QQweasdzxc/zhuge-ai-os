const test=require("node:test");
const assert=require("node:assert/strict");
const {assess}=require("../tools/taskflow-pages-feasibility");
test("current redirect-only root is not mislabeled complete native TaskFlow dashboard",()=>{
 const r=assess();
 assert.equal(r.status,"BLOCKED_NOT_READY");
 assert.equal(r.gates["canonical-root-preserves-pages-origin"],false);
 assert.equal(r.gates["full-taskflow-client-available"],false);
 assert.equal(r.githubAppAllowed,false);
 assert.equal(r.deploymentAllowed,false);
 assert.equal(r.taskflowLiveDispatchAllowed,false);
});
