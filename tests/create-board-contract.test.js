const test=require('node:test'),assert=require('node:assert/strict');
const {provisioningDb,owner}=require('./fixtures/c-consumer-provisioning-db.js');
const Service=require('../shared/board/board-read-service.js');
async function provision(db,project,prefix,key=prefix,blueprint=null){return (await db.query('select board_provision_c_consumer_v2($1,$2,$3,$4,$5,$6,$7,$8) result',['QA '+prefix,prefix,'c',null,blueprint,null,key,project])).rows[0].result;}
test('project assignment is Board-only; each choice and repeat project use canonical zero-edge lifecycle',async t=>{
 const db=await provisioningDb();t.after(()=>db.close());
 for(const [project,prefix] of [[null,'QUN'],['worklog','QWL'],['investment','QIV'],['worklog','QW2']]){
  const p=await provision(db,project,prefix);assert.equal(p.board_instance.project_assignment,project);assert.equal(p.board_instance.legacy_application_scope,null);assert.equal(p.workspaces.length,4);assert.ok(p.workspaces.every(w=>w.application_scope===null));assert.equal(p.workflow.steps.length,4);assert.equal(p.workflow.transitions.length,0);assert.equal(p.module_adoption.status,'adopted');
  const retry=await provision(db,project,prefix);assert.equal(retry.board_instance.id,p.board_instance.id);assert.equal(retry.idempotent,true);
 }
 assert.equal((await db.query("select count(*) n from pg_proc where proname='board_provision_c_consumer_v2'")).rows[0].n,1);
});
test('provision failure is atomic; conflicting retry and invalid project fail closed',async t=>{
 const db=await provisioningDb();t.after(()=>db.close());
 const snapshot=async()=>JSON.stringify((await db.query("select jsonb_build_object('boards',(select jsonb_agg(b order by id) from board_instances b),'workspaces',(select jsonb_agg(w order by id) from board_workspaces w),'release',(select jsonb_agg(r) from module_releases r),'workflow',(select jsonb_agg(d order by id) from board_workflow_definitions d),'keys',(select jsonb_agg(k) from private.board_c_consumer_provision_idempotency k)) result")).rows[0].result);
 const before=await snapshot();await assert.rejects(()=>provision(db,'worklog','BAD','bad',JSON.stringify([{workspace_key:'INVALID!',name:'Bad'}])),/invalid workspace/);assert.equal(await snapshot(),before);
 await assert.rejects(()=>provision(db,'other','BAD'),/Project assignment/);assert.equal(await snapshot(),before);
 await provision(db,'worklog','RETRY');const after=await snapshot();await assert.rejects(()=>provision(db,'investment','RETRY'),/Idempotency Key/);assert.equal(await snapshot(),after);
 await db.query("select set_config('request.uid','',false)");await assert.rejects(()=>provision(db,null,'ANON'),/Authentication|Authenticated|authenticated/);
});
test('Shared service sends project separately, retaining legacy named RPC compatibility',async()=>{
 let args;const gateway={rpc:async(name,input)=>{assert.equal(name,'board_provision_c_consumer_v2');args=input;return {};}};
 await Service.provisionCConsumer({name:'QA',prefix:'QA',projectAssignment:'worklog',idempotencyKey:'qa'},{gateway});assert.equal(args.p_project_assignment,'worklog');assert.equal(args.p_application_scope,null);
 await Service.provisionCConsumer({name:'Personal',prefix:'SELF',applicationScope:'worktodo-self',idempotencyKey:'personal'},{gateway});assert.equal(args.p_application_scope,'worktodo-self');assert.ok(!Object.hasOwn(args,'p_project_assignment'));
});
test('extended RPC preserves personal WorkTodo and client ACL without a writable overload',async t=>{
 const db=await provisioningDb();t.after(()=>db.close());
 const acl=(await db.query("select has_function_privilege('anon','public.board_provision_c_consumer_v2(text,text,text,text,jsonb,jsonb,text,text)','EXECUTE') anon,has_function_privilege('authenticated','public.board_provision_c_consumer_v2(text,text,text,text,jsonb,jsonb,text,text)','EXECUTE') authenticated")).rows[0];assert.equal(acl.anon,false);assert.equal(acl.authenticated,true);
 const personal=(await db.query("select board_provision_c_consumer_v2('工作待辦','SELF','c','worktodo-self',null,null,'self-legacy-named') result")).rows[0].result;
 assert.equal(personal.workspaces.length,3);assert.ok(personal.workspaces.every(w=>w.application_scope==='worktodo-user-'+owner.replaceAll('-','')));assert.equal(personal.workflow.steps.length,3);assert.equal(personal.workflow.transitions.length,0);assert.equal(personal.board_instance.project_assignment,null);
});
