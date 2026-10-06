const test=require('node:test');const assert=require('node:assert/strict');
const {lifecycleDb,provision,identitySnapshot,migration,board,owner,other}=require('./fixtures/module-c-board-lifecycle-sql');
const Board=require('../shared/board/board-read-service');
const fs=require('node:fs');const path=require('node:path');
test('Canonical Board archive/restore retains identity/data, writes audit, denies unauthorized/duplicate/Mother actions',async t=>{
 const db=await lifecycleDb();t.after(()=>db.close());
 const created=await provision(db,'investment');const id=created.board_instance.id;
 assert.equal(created.board_instance.lifecycle_managed,true);
 const ws=created.workspaces[0].id;
 await db.query("insert into board_tasks(board_instance_id,workspace_id,title,work_code,status) values($1,$2,'保留工作一','NXQA-001','not_started'),($1,$2,'保留工作二','NXQA-002','not_started')",[id,ws]);
 await db.query("insert into retained_attachments(task_id,object_key) select id,'preserved-evidence' from board_tasks where board_instance_id=$1",[id]);
 const before=await identitySnapshot(db,id);
 await db.query("select set_config('request.uid',$1,false)",[other]);
 await assert.rejects(db.query('select board_instance_archive($1)',[id]),/denied/i);
 await db.query("select set_config('request.uid',$1,false)",[owner]);
 await assert.rejects(db.query('select board_instance_archive($1)',[board]),/denied/i);
 const attempts=await Promise.allSettled([db.query('select board_instance_archive($1) result',[id]),db.query('select board_instance_archive($1) result',[id])]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
 const archived=attempts.find(r=>r.status==='fulfilled').value.rows[0].result;
 assert.equal(archived.active,false);assert.ok(archived.archived_at);assert.equal(archived.archived_by,owner);
 await db.exec('set role authenticated');
 assert.equal((await db.query('select id from board_instances where id=$1',[id])).rows.length,1,'archived metadata readable through lifecycle RLS');
 assert.equal((await db.query('select board_instance_can_write($1) ok',[id])).rows[0].ok,false);
 assert.equal((await db.query('select board_instance_list_archived() rows')).rows[0].rows.length,1);
 assert.equal((await db.query("select action from engineering_activity_log where entity_id=$1 and action='board_instance_archived'",[id])).rows.length,1);
 await assert.rejects(db.query('update board_instances set active=true where id=$1',[id]),/permission denied/i);
 await db.exec('reset role');
 await db.query("select set_config('request.uid',$1,false)",[other]);
 await assert.rejects(db.query('select board_instance_restore($1)',[id]),/denied/i);
 assert.deepEqual((await db.query('select board_instance_list_archived() rows')).rows[0].rows,[]);
 await db.query("select set_config('request.uid',$1,false)",[owner]);
 const restores=await Promise.allSettled([db.query('select board_instance_restore($1) result',[id]),db.query('select board_instance_restore($1) result',[id])]);
 assert.equal(restores.filter(r=>r.status==='fulfilled').length,1);assert.equal(restores.filter(r=>r.status==='rejected').length,1);
 const after=await identitySnapshot(db,id);
 const strip=row=>{const copy={...row};for(const key of ['active','archived_at','archived_by','archive_origin','updated_at'])delete copy[key];return copy;};
 assert.deepEqual(strip(after.board_instances[0]),strip(before.board_instances[0]));
 for(const key of Object.keys(before).filter(key=>key!=='board_instances'))assert.deepEqual(after[key],before[key],key+' retained');
 assert.equal(after.board_instances[0].active,true);assert.equal(after.board_instances[0].archived_at,null);assert.equal(after.board_instances[0].archived_by,null);
 const audit=(await db.query("select * from engineering_activity_log where entity_id=$1 and action in ('board_instance_archived','board_instance_restored') order by created_at",[id])).rows;
 assert.equal(audit.length,2);assert.ok(audit.every(row=>row.actor_id===owner&&row.created_at&&row.before_data.id===id&&row.after_data.id===id));
 for(const rpc of ['board_instance_archive(uuid)','board_instance_restore(uuid)','board_instance_list_archived()']){
  assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',['anon',rpc,'EXECUTE'])).rows[0].ok,false);
  assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',['authenticated',rpc,'EXECUTE'])).rows[0].ok,true);
 }
 await db.query("select set_config('request.uid','',false)");await assert.rejects(db.query('select board_instance_archive($1)',[id]),/authentication/i);
 await db.exec('set role anon');await assert.rejects(db.query('select board_instance_restore($1)',[id]),/permission denied/i);await db.exec('reset role');
});

test('Lifecycle service projection, active/archived lists and runtime fail-closed share canonical data',async t=>{
 const db=await lifecycleDb();t.after(()=>db.close());const created=await provision(db,'worklog','ELQA');const id=created.board_instance.id;let taskReads=0;
 const gateway={select:async(table,query)=>{if(table!=='board_instances'){taskReads++;return [];}const params=new URLSearchParams(query);let rows=(await db.query('select * from board_instances where id=$1',[id])).rows;const active=params.get('active');if(active)rows=rows.filter(r=>r.active===(active==='eq.true'));return rows;},rpc:async(name,args)=>{const keys=Object.keys(args);return (await db.query(`select ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,keys.map(k=>args[k]))).rows[0].result;}};
 const previous=global.getSharedSessionSnapshot;global.getSharedSessionSnapshot=()=>({isAuthenticated:true});t.after(()=>{global.getSharedSessionSnapshot=previous;});
 const service=Board.createInstanceService({boardInstanceId:id,gateway,readOnly:true});
 assert.equal((await service.load()).boardInstanceId,id);assert.equal((await Board.listBoardInstances({gateway})).length,1);
 const archived=await Board.archiveBoardInstance(id,{gateway});assert.equal(archived.lifecycleState,'ARCHIVED');assert.equal(archived.archivedBy,owner);
 assert.equal((await Board.listModuleConsumers({gateway})).length,0);assert.equal((await Board.listBoardInstances({gateway})).length,0);
 assert.equal((await Board.listArchivedBoardInstances({gateway}))[0].boardInstanceId,id);
 const reads=taskReads;await assert.rejects(service.load(),e=>e.code==='BOARD_INSTANCE_ARCHIVED');assert.equal(taskReads,reads,'archived load never queries owned Runtime data');
 const restored=await Board.restoreBoardInstance(id,{gateway});assert.equal(restored.lifecycleState,'ACTIVE');assert.equal(restored.projectAssignment,'worklog');assert.equal((await Board.listBoardInstances({gateway})).length,1);assert.equal((await service.load()).boardInstanceId,id);
 assert.equal(Board.normalizeBoardInstance({active:false}).lifecycleManaged,false);
});

test('Migration locks the canonical row and preserves independent Workspace/Completion authorities',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations',migration),'utf8');
 assert.match(sql,/for update/i);assert.doesNotMatch(sql,/delete from|update public.board_tasks|update public.board_workspaces|create table/i);
 assert.match(sql,/legacy-inactive/);assert.match(sql,/notify pgrst, 'reload schema'/);
});


test('Migration safely backfills inactive legacy metadata, protects unverified consumers, and preserves active identities',async t=>{
 let before;
 const db=await lifecycleDb(async d=>{
  await d.query("insert into board_instances(name,task_code_prefix,owner_uuid,active) values('Historical dormant','OLDQA',$1,false)",[owner]);
  before=(await d.query('select * from board_instances order by id')).rows;
 });t.after(()=>db.close());
 const after=(await db.query('select * from board_instances order by id')).rows;
 assert.equal(after.length,before.length);
 for(let i=0;i<before.length;i++){
  for(const [key,value] of Object.entries(before[i]))assert.deepEqual(after[i][key],value,key+' unchanged');
  assert.equal(after[i].lifecycle_managed,false,'unverified legacy/system rows remain protected');
  assert.equal(after[i].archived_by,null);
  if(after[i].active)assert.equal(after[i].archived_at,null);
  else {assert.ok(after[i].archived_at);assert.equal(after[i].archive_origin,'legacy-inactive');}
 }
 const created=await provision(db,null,'ENQA');const id=created.board_instance.id;
 await db.query("update board_instances set authorization_mode='engineering' where id=$1",[id]);
 await db.query("select set_config('request.uid',$1,false)",[other]);
 await assert.rejects(db.query('select board_instance_archive($1)',[id]),/denied/i);
 await db.query("select set_config('request.uid',$1,false)",[owner]);
 await db.query('select board_instance_archive($1)',[id]);
 assert.equal((await db.query('select board_instance_can_manage_lifecycle($1) ok',[id])).rows[0].ok,true,'engineering owner permission survives inactive state');
 await db.query('select board_instance_restore($1)',[id]);
});
