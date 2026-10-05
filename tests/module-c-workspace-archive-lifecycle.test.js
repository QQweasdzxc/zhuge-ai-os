const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../shared/board/board-read-service.js');
const {fixture,owner,other,board,foreignBoard,todo,history,completed,empty,foreignWorkspace,task}=require('./fixtures/module-c-workspace-lifecycle-sql');

async function value(db, sql, params = []) { return (await db.query(sql, params)).rows[0].result; }
async function archive(db, ws=history, instance=board) { return value(db,'select board_instance_archive_workspace($1,$2) result',[instance,ws]); }
async function restore(db, name=null) { return value(db,'select board_instance_restore_workspace($1,$2,$3) result',[board,history,name]); }
async function rejected(db, invoke, pattern) {
  const before = await value(db,`select jsonb_build_object('workspaces',(select jsonb_agg(w) from board_workspaces w),'tasks',(select jsonb_agg(t) from board_tasks t),'state',(select jsonb_agg(s) from board_instance_workflow_state s),'audit',(select jsonb_agg(a) from engineering_activity_log a)) result`);
  await assert.rejects(invoke,pattern);
  const after = await value(db,`select jsonb_build_object('workspaces',(select jsonb_agg(w) from board_workspaces w),'tasks',(select jsonb_agg(t) from board_tasks t),'state',(select jsonb_agg(s) from board_instance_workflow_state s),'audit',(select jsonb_agg(a) from engineering_activity_log a)) result`);
  assert.deepEqual(after,before,'Failed operation must roll back workspace/workflow/task/audit');
}

test('Module C archive/restore preserves Task-079 UUID, ownership, attachment, immutable workflow evidence and active exact-one bindings', async t => {
  const db = await fixture(); t.after(()=>db.close());
  const original = await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]);
  const oldVersion = original.workflow_version_id;
  const oldEvidence = await value(db,'select private.board_workflow_snapshot($1) result',[oldVersion]);
  const archived = await archive(db);
  assert.equal(archived.workspace.id, history); assert.equal(archived.workspace.active,false);
  assert.equal(archived.counts.history,1); assert.equal(archived.counts.current,0);
  assert.equal(archived.workflow.workflow.steps.some(s=>s.workspace_id===history),false);
  assert.equal(archived.workflow.workflow.steps.find(s=>s.workspace_id===todo).name,'PM custom phase');
  assert.deepEqual(archived.workflow.workflow.transitions.map(e=>e.transition_key),['todo-complete']);
  assert.equal(archived.workflow.workflow.gates.length,1); assert.equal(archived.workflow.workflow.evidence_requirements.length,1);
  const retired = await value(db,'select private.board_workflow_snapshot($1) result',[oldVersion]);
  for (const key of ['steps','transitions','gates','evidence_requirements']) assert.deepEqual(retired[key], oldEvidence[key]);
  const list = await value(db,'select board_instance_list_archived_workspaces($1) result',[board]);
  assert.equal(list.length,1); assert.equal(list[0].id,history); assert.deepEqual(list[0].counts.history_codes,['TASK-079']);
  assert.equal((await db.query('select id from board_workspaces where active and archived_at is null and id=$1',[history])).rows.length,0);
  const restored = await restore(db);
  assert.equal(restored.workspace.id,history); assert.equal(restored.workspace.active,true); assert.equal(restored.workspace.archived_at,null);
  assert.equal(restored.workflow.workflow.steps.filter(s=>s.workspace_id===history).length,1);
  assert.deepEqual(restored.workflow.workflow.transitions.map(e=>e.transition_key),['todo-complete'],'Restore must not recreate old incident edges');
  assert.equal((await value(db,'select board_instance_list_archived_workspaces($1) result',[board])).length,0);
  assert.deepEqual(await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]),original);
  assert.equal((await db.query('select object_key from retained_attachments where task_id=$1',[task])).rows[0].object_key,'unchanged-evidence');
  assert.deepEqual((await db.query("select action from engineering_activity_log where entity_type='board_workspace' order by id")).rows.map(r=>r.action).sort(),['workspace_archived','workspace_restored']);
  assert.equal(restored.workflow.workflow.steps.length,4);
  assert.equal(new Set(restored.workflow.workflow.steps.map(s=>s.workspace_id)).size,4);
});

test('Workspace archive rejects current work, completion designation, empty workspace, foreign scope without mutation; user drafts remain unpublished', async t => {
  const db = await fixture(); t.after(()=>db.close());
  await db.query('update board_tasks set completion_at=now(),archive_due_at=null where id=$1',[task]);
  await rejected(db,()=>archive(db),/進行中的卡片/);
  await db.query('update board_tasks set completion_at=null where id=$1',[task]);
  await rejected(db,()=>archive(db,completed),/完成工作區/);
  await rejected(db,()=>archive(db,empty),/空工作區/);
  await rejected(db,()=>archive(db,foreignWorkspace),/狀態已變更/);
  await db.query('insert into board_workflow_definitions(board_instance_id,version_no,name) values($1,2,$2)',[board,'Unsaved draft']);
  const orphan = await value(db,"select to_jsonb(d) result from board_workflow_definitions d where status='draft'");
  await archive(db);
  assert.equal((await value(db,'select to_jsonb(d) result from board_workflow_definitions d where id=$1',[orphan.id])).status,'draft');
  await db.exec(`select set_config('request.uid','${other}',false);`);
  await rejected(db,()=>archive(db),/權限/);
  await assert.rejects(()=>value(db,'select board_instance_list_archived_workspaces($1) result',[board]),/權限/);
});

test('Restore validates collision, order and same identity; initializes independent Steps without publishing user Drafts', async t => {
  const db = await fixture(false); t.after(()=>db.close());
  assert.equal((await archive(db)).workflow.workflow.transitions.length,0);
  await rejected(db,()=>restore(db,''),/請輸入工作區名稱/);
  await db.query('insert into board_workspaces(id,board_instance_id,workspace_key,name,sort_order) values(gen_random_uuid(),$1,$2,$3,20)',[board,'collision','TASK-081-E2E-20260922']);
  await rejected(db,()=>restore(db),/同名/);
  const restored = await restore(db,'恢復歷史');
  assert.equal(restored.workspace.sort_order,50); assert.equal(restored.workspace.id,history); assert.equal(restored.workflow.workflow.transitions.length,0);
  await archive(db);
  await db.query('insert into board_workflow_definitions(board_instance_id,version_no,name) values($1,(select max(version_no)+1 from board_workflow_definitions where board_instance_id=$1),$2)',[board,'Pending']);
  const beforeDraft=await value(db,"select to_jsonb(d) result from board_workflow_definitions d where status='draft'");
  await restore(db,'恢復歷史');
  assert.equal((await value(db,'select to_jsonb(d) result from board_workflow_definitions d where id=$1',[beforeDraft.id])).status,'draft');
  await archive(db);
  await db.exec("update board_instance_workflow_state set draft_workflow_version_id=null; delete from board_workflow_definitions where status='draft';");
  // Simulate a retained legacy archived Completion identity; restoring it may
  // not create two canonical Completion designations even without Workflow.
  await db.query('update board_workspaces set workspace_key=$2 where id=$1',[history,'legacy-completed']);
  await rejected(db,()=>restore(db,'恢復歷史'),/多個 Completion/);
});

test('Empty workspace delete remains soft-deactivate; populated delete still fails closed and is never moved', async t => {
  const db = await fixture(false); t.after(()=>db.close());
  await rejected(db,()=>value(db,'select board_instance_delete_workspace($1) result',[history]),/仍有卡片/);
  const removed = await value(db,'select board_instance_delete_workspace($1) result',[empty]);
  assert.equal(removed.empty_workspace,true); assert.equal(removed.moved_task_count,0);
  const row=(await db.query('select * from board_workspaces where id=$1',[empty])).rows[0];
  assert.equal(row.active,false); assert.ok(row.archived_at); assert.equal(row.id,empty);
  assert.equal((await value(db,'select board_instance_list_archived_workspaces($1) result',[board])).length,0);
});

test('SQL current/history/retained projection matches shared completion/terminal contract and RPC grants fail closed', async t => {
  const db=await fixture(false); t.after(()=>db.close());
  const now=Date.now();
  const cases=[{status:'done'},{status:'completed'},{status:'inprogress',archivedAt:new Date(now).toISOString()},{status:'cancelled'},
    {status:'done',completionAt:new Date(now-10000).toISOString(),archiveDueAt:new Date(now+86400000).toISOString()},
    {status:'done',completionAt:new Date(now-10000).toISOString(),archiveDueAt:null},
    {status:'done',completionAt:new Date(now-10000).toISOString(),archiveDueAt:new Date(now-1000).toISOString()}, {status:'ready'}];
  for(const row of cases){
    await db.query('update board_tasks set status=$2,completion_at=$3,archive_due_at=$4,archived_at=$5 where id=$1',[task,row.status,row.completionAt||null,row.archiveDueAt||null,row.archivedAt||null]);
    const counts=await value(db,'select private.board_workspace_retention($1) result',[history]);
    assert.equal(counts.history,Number(shared.isArchiveTask(row)),JSON.stringify(row)); assert.equal(counts.retained_total,1);
  }
  // WorkTodo's current presentation is DB-stamp owned; a due timestamp alone
  // must never let archive bypass a still-current WLTK / personal WorkTodo row.
  for (const scope of ['worktodo','worktodo-user-00000000000040008000000000000001']) {
    await db.query('update board_instances set legacy_application_scope=$2 where id=$1',[board,scope]);
    await db.query(`update board_tasks set status=$2,completion_at=now()-interval '2 days',archive_due_at=now()-interval '1 day',archived_at=null where id=$1`,[task,'done']);
    assert.equal((await value(db,'select private.board_workspace_retention($1) result',[history])).current,1);
    await rejected(db,()=>archive(db),/進行中的卡片/);
    await db.query('update board_tasks set archived_at=now() where id=$1',[task]);
    assert.equal((await value(db,'select private.board_workspace_retention($1) result',[history])).history,1);
  }
  const grants = (await db.query("select has_function_privilege('authenticated','public.board_instance_archive_workspace(uuid,uuid)','execute') allowed,has_function_privilege('anon','public.board_instance_archive_workspace(uuid,uuid)','execute') anon,has_function_privilege('authenticated','private.board_workspace_publish_lifecycle(uuid)','execute') helper")).rows[0];
  assert.deepEqual(grants,{allowed:true,anon:false,helper:false});
  await db.exec(`select set_config('request.uid','',false);`);
  await rejected(db,()=>archive(db),/權限/);
});

test('Instance service scopes lifecycle RPCs, read-only rejects before mutation, and shared actions deduplicate per Workspace', async () => {
  const {createWorkspaceWorkflowGateway}=require('./fixtures/module-c-workspace-workflow-gateway');
  const harness=createWorkspaceWorkflowGateway({scope:'ai_board'});
  const calls=[];
  harness.gateway.rpc=async(name,payload)=>{calls.push({name,payload});return {name,payload};};
  const service=shared.createInstanceService({gateway:harness.gateway,boardInstanceId:harness.boardId});
  await service.archiveWorkspace(history);await service.restoreWorkspace(history,'Restored');await service.listArchivedWorkspaces();
  assert.deepEqual(calls.map(c=>c.payload),[
    {p_board_instance_id:harness.boardId,p_workspace_id:history},
    {p_board_instance_id:harness.boardId,p_workspace_id:history,p_name:'Restored'},
    {p_board_instance_id:harness.boardId}
  ]);
  await assert.rejects(()=>service.restoreWorkspace(history,'  '),e=>e.code==='WORKSPACE_NAME_REQUIRED');
  assert.equal(calls.length,3,'Explicit blank restore name must never become null/default or reach a writer');
  const readOnly=shared.createInstanceService({gateway:harness.gateway,boardInstanceId:harness.boardId,readOnly:true});
  await assert.rejects(()=>readOnly.archiveWorkspace(history),e=>e.code==='C_WORKFLOW_READ_ONLY');
  await assert.rejects(()=>readOnly.restoreWorkspace(history),e=>e.code==='C_WORKFLOW_READ_ONLY');
  assert.equal(calls.length,3);
  const {create}=require('../shared/components/task-action-contract');
  const writes=[];let release;
  const wait=new Promise(resolve=>release=resolve);
  const contract=create({adapter:{actions:{archiveWorkspace:async p=>{writes.push(p.workspaceId);await wait;return p.workspaceId;}}}});
  const first=contract.execute('archiveWorkspace',{workspaceId:history});
  assert.equal(contract.execute('archiveWorkspace',{workspaceId:history}),first);
  const second=contract.execute('archiveWorkspace',{workspaceId:todo});
  assert.notEqual(second,first);assert.deepEqual(writes,[history,todo]);
  release();await Promise.all([first,second]);assert.equal(contract.inFlight(),0);
});

test('WorkTodo real workspace trigger permits scoped archive/restore while preserving ordering and immutable ownership protections', async t=>{
  const db=await fixture();t.after(()=>db.close());
  await db.query('update board_instances set legacy_application_scope=$2 where id=$1',[board,'worktodo']);
  await db.query('update board_workspaces set application_scope=$2,owner_uuid=$3,created_by=$3 where board_instance_id=$1',[board,'worktodo',owner]);
  await db.query('update board_tasks set archived_at=now() where id=$1',[task]);
  const original=await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]);
  await assert.rejects(()=>db.query('update board_workspaces set active=false,archived_at=now() where id=$1',[history]),/controlled WorkTodo/);
  await rejected(db,()=>value(db,'select board_instance_delete_workspace($1) result',[completed]),/archive guard/);
  const removed=await value(db,'select board_instance_delete_workspace($1) result',[empty]);
  assert.equal(removed.empty_workspace,true);assert.equal(removed.moved_task_count,0);
  assert.equal((await db.query('select active from board_workspaces where id=$1',[empty])).rows[0].active,false);
  const archived=await archive(db);
  assert.equal(archived.workspace.id,history);assert.equal(archived.workspace.active,false);assert.equal(archived.workspace.owner_uuid,owner);
  assert.equal((await db.query("select current_setting('zhuge.module_c_workspace_lifecycle',true) marker")).rows[0].marker,'');
  await assert.rejects(()=>db.query('update board_workspaces set active=true,archived_at=null where id=$1',[history]),/controlled WorkTodo/);
  const restored=await restore(db,'WorkTodo history restored');
  assert.equal(restored.workspace.id,history);assert.equal(restored.workspace.owner_uuid,owner);assert.equal(restored.workspace.created_by,owner);
  assert.equal(restored.workflow.workflow.steps.filter(s=>s.workspace_id===history).length,1);
  assert.deepEqual(await value(db,'select to_jsonb(t) result from board_tasks t where id=$1',[task]),original);
  // A scoped marker is not a blanket identity bypass. Even a privileged local
  // test connection cannot change ownership or a different Workspace with it.
  await db.query("select set_config('zhuge.module_c_workspace_lifecycle',$1,false)",[history+':archive']);
  await assert.rejects(()=>db.query('update board_workspaces set active=false,archived_at=now(),owner_uuid=$2 where id=$1',[history,other]),/archive guard/);
  await assert.rejects(()=>db.query('update board_workspaces set active=false,archived_at=now() where id=$1',[todo]),/controlled WorkTodo/);
  await db.exec("select set_config('zhuge.module_c_workspace_lifecycle','',false); select set_config('zhuge.module_c_workspace_ordering','1',false);");
  await db.query('update board_workspaces set sort_order=99 where id=$1',[history]);
  await assert.rejects(()=>db.query('update board_workspaces set active=false,archived_at=now() where id=$1',[history]),/sort_order only/);
  assert.equal((await db.query('select active from board_workspaces where id=$1',[history])).rows[0].active,true);
});
