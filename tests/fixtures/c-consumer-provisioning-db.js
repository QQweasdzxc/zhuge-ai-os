const fs=require('node:fs');
const path=require('node:path');
const {fixture,board,owner}=require('./module-c-workspace-lifecycle-sql.js');
const migration='20261005060842_c_consumer_project_assignment_contract.sql';
async function provisioningDb(){
 const db=await fixture();
 await db.exec(`alter table board_instances add column created_at timestamptz default now();
 update board_instances set task_code_prefix='Q'||upper(substr(md5(id::text),1,10));
 alter table board_instances add unique(task_code_prefix);
 alter table board_instances add unique(legacy_application_scope);
 update board_workspaces set application_scope=null;
 alter table board_workspaces add constraint golden_workspace_scope check(application_scope is null or application_scope in ('ai_board','worktodo') or application_scope like 'worktodo-user-%');
 update board_instances set is_template_instance=true,task_code_prefix='MDTK',name='C 唯一看板母版' where id='${board}';
 insert into board_instances(name,task_code_prefix,owner_uuid,legacy_application_scope) values('Existing WorkLog','EXWL','${owner}','worklog'),('Existing Investment','EXIV','${owner}','investment');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8'));
 return db;
}
module.exports={provisioningDb,migration,board,owner};
