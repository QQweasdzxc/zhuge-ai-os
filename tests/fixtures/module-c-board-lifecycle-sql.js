const fs=require('node:fs');
const path=require('node:path');
const {provisioningDb,board}=require('./c-consumer-provisioning-db');
const {owner,other,fn,read}=require('./module-c-workspace-lifecycle-sql');
const migration='20261005230418_module_c_board_instance_archive_restore.sql';
async function lifecycleDb(beforeMigration){
 const db=await provisioningDb();
 await db.exec(`alter table engineering_activity_log add column created_at timestamptz default now();
 create function is_engineering_member(roles text[] default array['owner','co','codex','qjc']) returns boolean language sql stable as $$ select exists(select 1 from app_users where auth_user_id=auth.uid() and role=any(roles)) $$;
 grant usage on schema public,auth to authenticated,anon;
 alter table board_instances enable row level security;
 grant select on board_instances to authenticated;
 create policy board_instances_generic_select on board_instances for select to authenticated using(board_instance_can_read(id));
 alter table engineering_activity_log enable row level security;
 grant select on engineering_activity_log to authenticated;
 create policy fixture_activity_read on engineering_activity_log for select to authenticated using(entity_type='board_instance' and board_instance_can_read(entity_id::uuid));

 `);
 await db.exec(read('supabase/migrations/20260910151958_20260910_c_workflow_audit_entity_types_fix.sql'));
 if(beforeMigration) await beforeMigration(db);
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8'));
 await db.exec(fn(read('docs/supabase/20260910_c_workflow_capability_v2.sql'),'public.board_c_workflow_get'));
 return db;
}
async function provision(db,assignment=null,prefix='NXQA',name='雲間計畫'){
 return (await db.query('select board_provision_c_consumer_v2($1,$2,$3,$4,$5,$6,$7,$8) result',[name,prefix,'c',null,null,null,'fixture-'+prefix,assignment])).rows[0].result;
}
async function identitySnapshot(db,id){
 const result={};
 for(const table of ['board_instances','board_workspaces','board_tasks','board_workflow_definitions','board_instance_workflow_state']){
  result[table]=(await db.query(`select * from ${table} where ${table==='board_instances'?'id':'board_instance_id'}=$1 order by ${table==='board_instance_workflow_state'?'board_instance_id':'id'}`,[id])).rows;
 }
 const versions=result.board_workflow_definitions.map(row=>row.id);
 result.steps=(await db.query('select * from board_workflow_steps where workflow_version_id=any($1) order by id',[versions])).rows;
 result.attachments=(await db.query('select * from retained_attachments where task_id in (select id from board_tasks where board_instance_id=$1) order by id',[id])).rows;
 result.release=(await db.query('select * from module_releases')).rows;
 return result;
}
module.exports={lifecycleDb,provision,identitySnapshot,migration,board,owner,other};
