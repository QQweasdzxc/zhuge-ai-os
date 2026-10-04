const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,fn,read,board,todo,completed,foreignBoard,foreignWorkspace}=require('./fixtures/module-c-workspace-lifecycle-sql');
const correction=read('supabase/migrations/20261004082429_module_c_archive_version_coverage_mixed_scope_ordering.sql');
async function setup(){
 const db=await fixture(false);
 await db.exec(`alter table board_tasks add archived_by uuid,add updated_at timestamptz default now();
 truncate engineering_activity_log;alter table engineering_activity_log alter column id drop default;alter table engineering_activity_log alter column id type bigint using 0;create sequence qa_audit_id;alter table engineering_activity_log alter column id set default nextval('qa_audit_id');`);
 const scheduler=read('docs/supabase/20260912_c_completion_archive_scheduler_v2.sql');
 await db.exec(scheduler.slice(scheduler.indexOf('create table'),scheduler.indexOf('create or replace function')));
 await db.exec(fn(read('docs/supabase/20260913_c_completion_archive_optional_workflow.sql'),'private.board_c_completion_archive_context'));
 await db.exec(fn(read('docs/supabase/20260915_c_completion_archive_actor_label_system.sql'),'private.board_c_reconcile_completion_archive_lifecycle_core'));
 await db.exec(correction);
 await db.exec(fn(read('supabase/migrations/20261002193217_task_35_module_c_workspace_ordering_authority.sql'),'public.board_instance_reorder_workspaces'));
 return db;
}
async function result(db,sql,args=[]){return(await db.query(sql,args)).rows[0].result;}
async function task(db,workspace,mode='published'){return result(db,'select to_jsonb(board_instance_create_task($1,$2,null,$3,null,$4,$5)) result',[board,'QA completion fixture','not_started',workspace,mode]);}
async function due(db,id){await db.query("update board_tasks set completion_at=now()-interval '25 hours',archive_due_at=now()-interval '1 hour' where id=$1",[id]);}
async function snapshot(db,id){return result(db,'select to_jsonb(t) result from board_tasks t where id=$1',[id]);}
for(const route of ['scheduler','board-read','task-read'])test(`Completion archive ${route} covers retired/current/unbound without rebinding or changing due evidence`,async t=>{
 const db=await setup();t.after(()=>db.close());
 const unbound=await task(db,completed,'unbound');await due(db,unbound.id);
 const retired=await task(db,completed);await due(db,retired.id);
 await db.query('select board_instance_create_workspace($1,$2,$3)',[board,'Structural workspace','structural']);
 const current=await task(db,completed);await due(db,current.id);
 const before=await Promise.all([retired,current,unbound].map(x=>snapshot(db,x.id)));
 const pointer=await result(db,'select to_jsonb(s) result from board_instance_workflow_state s where board_instance_id=$1',[board]);
 assert.notEqual(before[0].workflow_version_id,pointer.published_workflow_version_id);
 assert.equal(before[1].workflow_version_id,pointer.published_workflow_version_id);assert.equal(before[2].workflow_version_id,null);
 const run=()=>result(db,route==='scheduler'?'select private.board_c_completion_archive_scheduler_run() result':'select board_c_reconcile_completion_archive_lifecycle_v2($1,$2) result',route==='scheduler'?[]:[board,pointer.published_workflow_version_id]);
 let archive;
 if(route==='task-read'){for(const row of before)await db.query('select board_c_reconcile_completion_archive_lifecycle_v2($1,null,$2)',[board,row.id]);archive={archived_count:3};}else archive=await run();
 assert.equal(archive.archived_count??archive.cards_archived,3);if(route==='scheduler')assert.equal(archive.error_count,0);
 for(const row of before){const after=await snapshot(db,row.id);assert.ok(after.archived_at);for(const key of ['workflow_version_id','current_workflow_step_id','workspace_id','owner_uuid','completion_at','archive_due_at'])assert.equal(after[key],row[key],key);}
 const retry=await run();assert.equal(retry.archived_count??retry.cards_archived,0);
});
test('mixed-scope reorder accepts exactly the same active Board set, preserves identity/audit, rejects cross/partial/duplicate lists',async t=>{
 const db=await setup();t.after(()=>db.close());
 await db.query("update board_workspaces set application_scope=case when id=$1 then null else 'worktodo' end where board_instance_id=$2",[todo,board]);
 const original=(await db.query('select * from board_workspaces where board_instance_id=$1 and active order by sort_order',[board])).rows,ids=original.map(w=>w.id).reverse();
 const r=await result(db,'select board_instance_reorder_workspaces($1::uuid[]) result',[ids]);assert.ok(r.audit_id);
 const after=(await db.query('select * from board_workspaces where board_instance_id=$1 and active order by sort_order',[board])).rows;assert.deepEqual(after.map(w=>w.id),ids);
 for(const w of after){const old=original.find(o=>o.id===w.id);for(const key of ['board_instance_id','workspace_key','application_scope','owner_uuid','active','created_by','created_at'])assert.deepEqual(w[key],old[key]);}
 assert.ok((await db.query('select 1 from engineering_activity_log where id=$1',[r.audit_id])).rows.length);
 for(const bad of [ids.slice(1),[ids[0],...ids.slice(0,-1)],[foreignWorkspace,...ids.slice(1)]])await assert.rejects(()=>db.query('select board_instance_reorder_workspaces($1::uuid[])',[bad]),/every active workspace|authorization/i);
 const final=(await db.query('select * from board_workspaces where board_instance_id=$1 and active order by sort_order',[board])).rows;assert.deepEqual(final,after);
 await assert.rejects(()=>db.query('update board_workspaces set owner_uuid=gen_random_uuid() where id=$1',[after.find(w=>w.application_scope==='worktodo').id]),/controlled WorkTodo|identity/i);
});
