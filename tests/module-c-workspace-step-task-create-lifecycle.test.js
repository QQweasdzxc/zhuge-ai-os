const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,board,todo,history,empty,task,owner,other}=require('./fixtures/module-c-workspace-lifecycle-sql');
async function value(db,sql,params=[]){return (await db.query(sql,params)).rows[0].result;}
async function state(db){return value(db,'select to_jsonb(s) result from board_instance_workflow_state s where board_instance_id=$1',[board]);}
async function published(db){return value(db,'select private.board_workflow_snapshot(published_workflow_version_id) result from board_instance_workflow_state where board_instance_id=$1',[board]);}
async function create(db,name,key){return value(db,'select to_jsonb(board_instance_create_workspace($1,$2,$3)) result',[board,name,key]);}
async function createTask(db,workspace,title){return value(db,'select to_jsonb(board_instance_create_task($1,$2,null,$3,null,$4,$5)) result',[board,title,'not_started',workspace,'published']);}
async function invariant(db){
 const p=await published(db);
 const active=(await db.query('select id from board_workspaces where board_instance_id=$1 and active and archived_at is null',[board])).rows.map(w=>w.id);
 assert.equal(p.steps.length,active.length);
 for(const id of active)assert.equal(p.steps.filter(s=>s.workspace_id===id).length,1,id);
 const ids=new Set(p.steps.map(s=>s.id));
 for(const edge of p.transitions){assert.ok(ids.has(edge.from_step_id));assert.ok(ids.has(edge.to_step_id));}
 return p;
}
async function userDraft(db){
 const p=await published(db);
 const steps=p.steps.map(s=>({...s,is_initial:false,is_completion:false}));
 steps.find(s=>s.workspace_id===todo).name='UNPUBLISHED node name';
 steps.find(s=>s.workspace_id===todo).role_key='gpt';
 steps.find(s=>s.workspace_id===todo).status_key='qa';
 const keys=new Map(p.steps.map(s=>[s.id,s.step_key]));
 const edges=p.transitions.map(e=>({...e,from_step_key:keys.get(e.from_step_id),to_step_key:keys.get(e.to_step_id)}));
 edges.push({transition_key:'user-only-edge',from_step_key:'custom-e2e',to_step_key:'todo',allowed_roles:['gpt'],requires_gate:true});
 const saved=await value(db,'select board_c_workflow_save_draft($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb) result',[board,'UNPUBLISHED workflow','User description',JSON.stringify(steps),JSON.stringify(edges),JSON.stringify([{step_key:'todo',gate_key:'user-only-gate',name:'User gate',required:true}]),JSON.stringify([{gate_key:'user-only-gate',evidence_key:'user-only-evidence',label:'User evidence',source_kind:'artifact'}])]);
 await db.query('update board_workflow_definitions set based_on_workflow_version_id=$2 where id=$1',[saved.workflow.id,p.id]);
 return value(db,'select private.board_workflow_snapshot($1) result',[saved.workflow.id]);
}
async function whole(db){return value(db,`select jsonb_build_object('workspaces',(select jsonb_agg(w order by id) from board_workspaces w),'definitions',(select jsonb_agg(d order by id) from board_workflow_definitions d),'steps',(select jsonb_agg(s order by id) from board_workflow_steps s),'edges',(select jsonb_agg(e order by id) from board_workflow_transitions e),'state',(select jsonb_agg(s) from board_instance_workflow_state s),'tasks',(select jsonb_agg(t order by id) from board_tasks t),'audit',(select jsonb_agg(a order by id) from engineering_activity_log a)) result`);}

test('Workspace RPC atomically creates Step +1 / Edge +0 and preserves every unpublished Draft setting',async t=>{
 const db=await fixture();t.after(()=>db.close());
 const old=await published(db),draft=await userDraft(db);
 const originalTask=await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]);
 const workspace=await create(db,'Independent','request-key');
 const next=await invariant(db);
 assert.equal(next.steps.length,old.steps.length+1);
 assert.deepEqual(next.transitions.map(e=>e.transition_key),old.transitions.map(e=>e.transition_key));
 assert.equal(next.name,old.name);assert.equal(next.description,old.description);
 assert.equal(next.steps.find(s=>s.workspace_id===todo).name,'PM custom phase');
 assert.equal(next.steps.find(s=>s.workspace_id===todo).role_key,'co');
 assert.equal(next.gates.some(g=>g.gate_key==='user-only-gate'),false);
 const after=await value(db,'select private.board_workflow_snapshot($1) result',[draft.id]);
 assert.equal(after.status,'draft');assert.equal((await state(db)).draft_workflow_version_id,draft.id);
 for(const k of ['name','description','published_at','published_by','retired_at','created_at','updated_at'])assert.deepEqual(after[k],draft[k],k);
 for(const k of ['transitions','gates','evidence_requirements'])assert.deepEqual(after[k],draft[k],k);
 for(const s of draft.steps)assert.deepEqual(after.steps.find(n=>n.id===s.id),s,'Existing Draft node settings/IDs unchanged');
 assert.equal(after.steps.length,draft.steps.length+1);assert.equal(after.based_on_workflow_version_id,next.id);
 const card=await createTask(db,workspace.id,'Independent TASK');
 assert.equal(card.workspace_id,workspace.id);assert.equal(card.workflow_version_id,next.id);
 assert.equal(card.current_workflow_step_id,next.steps.find(s=>s.workspace_id===workspace.id).id);
 assert.equal((await published(db)).id,next.id,'Bound create does not republish unnecessarily');
 const retry=await create(db,'Independent','request-key');assert.equal(retry.id,workspace.id);
 assert.equal((await published(db)).id,next.id);
 assert.deepEqual(await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]),originalTask);
 const retired=await value(db,'select private.board_workflow_snapshot($1) result',[old.id]);
 for(const k of ['steps','transitions','gates','evidence_requirements'])assert.deepEqual(retired[k],old[k]);
});

test('Create TASK repairs legacy 資源分享與參考 / 暫緩 bindings without Edge or Draft publication',async t=>{
 const db=await fixture();t.after(()=>db.close());
 const draft=await userDraft(db),old=await published(db);
 const rows=(await db.query(`insert into board_workspaces(board_instance_id,workspace_key,name,sort_order) values($1,'resources','資源分享與參考',50),($1,'paused','暫緩',60) returning *`,[board])).rows;
 for(const ws of rows){
  const card=await createTask(db,ws.id,ws.name+' TASK');
  assert.equal(card.workspace_id,ws.id);assert.ok(card.current_workflow_step_id);
  const p=await invariant(db);const node=p.steps.find(s=>s.workspace_id===ws.id);
  assert.equal(p.transitions.some(e=>e.from_step_id===node.id||e.to_step_id===node.id),false);
  assert.equal((await state(db)).draft_workflow_version_id,draft.id);
  assert.equal((await value(db,'select private.board_workflow_snapshot($1) result',[draft.id])).status,'draft');
 }
 assert.deepEqual((await published(db)).transitions.map(e=>e.transition_key),old.transitions.map(e=>e.transition_key));
});

test('Archive / restore / soft-deactivate synchronize Published and Draft nodes, retain history, and never recreate incident Edges',async t=>{
 const db=await fixture();t.after(()=>db.close());const draft=await userDraft(db);
 const originalTask=await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]);
 await db.query('select board_instance_archive_workspace($1,$2)',[board,history]);
 const archived=await invariant(db);assert.equal(archived.steps.some(s=>s.workspace_id===history),false);
 const draftAfterArchive=await value(db,'select private.board_workflow_snapshot($1) result',[draft.id]);
 assert.equal(draftAfterArchive.status,'draft');assert.equal(draftAfterArchive.name,draft.name);
 assert.equal(draftAfterArchive.steps.some(s=>s.workspace_id===history),false);
 assert.equal(draftAfterArchive.transitions.some(e=>e.transition_key==='user-only-edge'),false);
 assert.equal(draftAfterArchive.steps.find(s=>s.workspace_id===todo).name,'UNPUBLISHED node name');
 assert.deepEqual(draftAfterArchive.gates,draft.gates);assert.deepEqual(draftAfterArchive.evidence_requirements,draft.evidence_requirements);
 await db.query('select board_instance_restore_workspace($1,$2)',[board,history]);
 const restored=await invariant(db),node=restored.steps.find(s=>s.workspace_id===history);
 assert.equal(restored.steps.length,archived.steps.length+1);assert.ok(node);
 assert.equal(restored.transitions.length,archived.transitions.length);
 assert.equal(restored.transitions.some(e=>e.from_step_id===node.id||e.to_step_id===node.id),false);
 const d=await value(db,'select private.board_workflow_snapshot($1) result',[draft.id]);
 assert.equal(d.steps.filter(s=>s.workspace_id===history).length,1);assert.deepEqual(d.transitions,draftAfterArchive.transitions);
 await db.query('select board_instance_delete_workspace($1)',[empty]);
 const removed=await invariant(db);assert.equal(removed.steps.some(s=>s.workspace_id===empty),false);
 assert.equal((await value(db,'select private.board_workflow_snapshot($1) result',[draft.id])).steps.some(s=>s.workspace_id===empty),false);
 assert.deepEqual(await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]),originalTask);
});

test('No Published Workflow initializes every Workspace with 0 Edge and leaves an existing Draft unpublished',async t=>{
 const db=await fixture(false);t.after(()=>db.close());
 await db.query(`insert into board_workflow_definitions(board_instance_id,version_no,name,description) values($1,1,'User unconfirmed','Keep me')`,[board]);
 const card=await createTask(db,todo,'First standalone TASK');
 const p=await invariant(db);assert.equal(p.transitions.length,0);assert.ok(card.current_workflow_step_id);
 const d=await value(db,"select private.board_workflow_snapshot(id) result from board_workflow_definitions where status='draft'");
 assert.equal(d.name,'User unconfirmed');assert.equal(d.description,'Keep me');assert.equal(d.steps.length,p.steps.length);
 assert.equal((await state(db)).draft_workflow_version_id,d.id);
});

test('Canonical lifecycle rollback restores Workspace, Published, user Draft and audit on failure; permission remains fail closed',async t=>{
 const db=await fixture();t.after(()=>db.close());await userDraft(db);
 const before=await whole(db);
 await db.exec(`create function fail_system_node() returns trigger language plpgsql as $$ begin if new.name='Reject system node' then raise exception 'Local injected validation failure'; end if; return new; end $$;create trigger reject_node before insert on board_workflow_steps for each row execute function fail_system_node();`);
 await assert.rejects(()=>create(db,'Reject system node','rollback-key'),/Local injected/);
 assert.deepEqual(await whole(db),before);
 await db.exec(`select set_config('request.uid','${other}',false);`);
 await assert.rejects(()=>create(db,'Denied','denied-key'),/Authenticated board access/);
 assert.deepEqual(await whole(db),before);
 const grants=(await db.query("select has_function_privilege('authenticated','public.board_instance_create_workspace(uuid,text,text)','execute') allowed,has_function_privilege('anon','public.board_instance_create_workspace(uuid,text,text)','execute') anon,has_function_privilege('authenticated','private.board_workspace_publish_lifecycle(uuid)','execute') helper")).rows[0];
 assert.deepEqual(grants,{allowed:true,anon:false,helper:false});
});

test('Canonical new Board provisioning and personal WorkTodo initialize every active Workspace Step with zero Edge',async t=>{
 const db=await fixture(false);t.after(()=>db.close());
 for(const args of [['Independent Board','NEW','c',null,null,null,'new-board-request'],['工作待辦','SELF','c','worktodo-self',null,null,'personal-board-request']]){
  const result=await value(db,'select board_provision_c_consumer_v2($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) result',args);
  assert.equal(result.workflow_status,'published');assert.equal(result.workflow.transitions.length,0);
  assert.equal(result.workflow.steps.length,result.workspaces.length);
  for(const ws of result.workspaces)assert.equal(result.workflow.steps.filter(s=>s.workspace_id===ws.id).length,1);
  const retry=await value(db,'select board_provision_c_consumer_v2($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) result',args);
  assert.equal(retry.board_instance_id,result.board_instance_id);assert.equal(retry.idempotent,true);
 }
});

test('Zero-edge readback uses semantic Completion designation instead of arbitrary graph endpoints',async t=>{
 const db=await fixture(false);t.after(()=>db.close());await createTask(db,todo,'Zero-edge TASK');
 const p=await invariant(db);assert.equal(p.transitions.length,0);assert.ok(p.steps.every(s=>s.is_completion));
 const scope=await value(db,'select private.board_c_completion_archive_scope($1,$2) result',[board,p.id]);
 const {completed}=require('./fixtures/module-c-workspace-lifecycle-sql');
 assert.equal(scope.completion_workspace_id,completed);assert.equal(scope.archive_delay_seconds,86400);
 await db.query('delete from board_workflow_steps where workflow_version_id=$1 and workspace_id=$2',[p.id,completed]);
 await assert.rejects(()=>value(db,'select private.board_c_completion_archive_scope($1,$2) result',[board,p.id]),/完成工作區尚未對應正式流程階段/);
 await db.query('update board_workspaces set workspace_key=$2 where id=$1',[completed,'independent-terminal']);
 const optional=await value(db,'select private.board_c_completion_archive_scope($1,$2) result',[board,p.id]);
 assert.equal(optional.state,'not_applicable');assert.equal(optional.completion_workspace_id,null);assert.equal(optional.scope_verified,true);
});
