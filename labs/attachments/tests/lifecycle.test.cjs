const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fixtureModule=require('./fixture.cjs');
const {fixture,owner,other,card,boardCard,workflowCard,unboundCard,investmentCard,genericCompletedCard,workspace,id,boardId,workflowId,worktodoManualId,boardAutoId,workflowStep,ordinaryStep}=fixtureModule;
const q=async(db,sql,args=[])=>(await db.query(sql,args)).rows;

test('actual SQL: native completion, grace/reopen, fail-closed quota, cleanup tombstones, ACL and retention',async()=>{
 const db=await fixture();
 try{
  const access=async(module,attachment=id,intent='preview')=>q(db,'select attachment_access($1,$2,$3) value',[module,attachment,intent]);
  const status=async(module,attachment=id)=>q(db,'select attachment_status($1,$2) value',[module,attachment]);
  const tracked=await q(db,'select module,card_id,completed_at from attachment_lifecycle.cards order by module,card_id');
  assert.equal(tracked.length,5,'only exact WorkTodo and Board scopes plus the existing TaskFlow card are enrolled');
  assert.ok(tracked.some(row=>row.module==='worktodo'&&row.card_id===card&&row.completed_at),'WorkTodo completed is native completion');
  assert.ok(tracked.some(row=>row.module==='board'&&row.card_id===boardCard&&row.completed_at),'Board done is native completion');
  assert.ok(tracked.some(row=>row.module==='board'&&row.card_id===workflowCard&&row.completed_at),'current workflow completion step is authoritative');
  assert.ok(!tracked.some(row=>row.card_id===unboundCard||row.card_id===investmentCard),'unbound and Investment rows are excluded');
  assert.equal(tracked.find(row=>row.card_id===genericCompletedCard).completed_at,null,'generic Board completed text does not start a timer');
  const initialGenerations=new Map();
  for(const [module,cardId] of [['worktodo',card],['board',boardCard],['board',workflowCard]]) initialGenerations.set(`${module}:${cardId}`,(await q(db,'select generation from attachment_lifecycle.cards where module=$1 and card_id=$2',[module,cardId]))[0].generation);
  for(const [module,attachment] of [['worktodo',id],['board',boardId],['board',workflowId]]) assert.equal((await access(module,attachment))[0].value.enabled,true,'historical completed cards receive activation grace');

  await db.exec(`update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '24 hours' where (module='worktodo' and card_id='${card}') or (module='board' and card_id in ('${boardCard}','${workflowCard}'))`);
  for(const [module,attachment] of [['worktodo',id],['board',boardId],['board',workflowId]]){
   await assert.rejects(access(module,attachment,'preview'),/preview expired/);
   assert.ok((await access(module,attachment,'download'))[0].value.ttl>0,'downloads remain available in the 24–72 hour window');
   const value=(await status(module,attachment))[0].value;
   assert.equal(value.preview_available,false);assert.equal(value.download_available,true);
   assert.equal(Date.parse(value.delete_due_at)-Date.parse(value.completed_at),72*60*60*1000,'status reports the actual 72-hour deadline');
  }

  await db.exec(`update board_tasks set status='ready' where id='${card}'; update board_tasks set status='ready' where id='${boardCard}'; update board_tasks set current_workflow_step_id='${ordinaryStep}' where id='${workflowCard}'`);
  assert.equal((await q(db,"select completed_at from attachment_lifecycle.cards where module='worktodo' and card_id=$1",[card]))[0].completed_at,null);
  assert.equal((await q(db,"select completed_at from attachment_lifecycle.cards where module='board' and card_id=$1",[boardCard]))[0].completed_at,null);
  assert.equal((await q(db,"select completed_at from attachment_lifecycle.cards where module='board' and card_id=$1",[workflowCard]))[0].completed_at,null,'changing only the current workflow step reopens the timer');
  await db.exec(`update board_tasks set status='completed' where id='${genericCompletedCard}'`);
  assert.equal((await q(db,"select completed_at from attachment_lifecycle.cards where module='board' and card_id=$1",[genericCompletedCard]))[0].completed_at,null,'generic Board completed text is not completion');
  await db.exec(`update board_tasks set status='completed' where id='${card}'; update board_tasks set status='done' where id='${boardCard}'; update board_tasks set current_workflow_step_id='${workflowStep}' where id='${workflowCard}'`);
  for(const [module,cardId] of [['worktodo',card],['board',boardCard],['board',workflowCard]]){
   const row=(await q(db,'select completed_at,generation from attachment_lifecycle.cards where module=$1 and card_id=$2',[module,cardId]))[0];
   assert.ok(Date.now()-new Date(row.completed_at)<2000,'recompletion starts from the new transition time');
   assert.notEqual(row.generation,initialGenerations.get(`${module}:${cardId}`),'recompletion gets a fresh generation');
  }
  await assert.rejects(db.exec(`insert into board_task_attachments values(gen_random_uuid(),'${card}','board-task-attachments','blocked-worktodo','blocked.pdf',1,'uploading','active')`),/completed cards/);
  await assert.rejects(db.exec(`insert into board_task_attachments values(gen_random_uuid(),'${boardCard}','board-task-attachments','blocked-board','blocked.pdf',1,'uploading','active')`),/completed cards/);

  await db.exec(`set request.jwt.claim.sub='${other}'`);
  await assert.rejects(access('worktodo'),/unavailable/);
  await assert.rejects(q(db,'select attachment_capacity()'),/owner required/);
  await db.exec(`set request.jwt.claim.sub='${owner}'`);
  await assert.rejects(q(db,'select attachment_request_delete($1,$2,false)',['worktodo',worktodoManualId]),/confirmed owner/);
  for(const [module,attachment] of [['worktodo',worktodoManualId],['board',boardId]]){
   const claim=(await q(db,'select attachment_request_delete($1,$2,true) value',[module,attachment]))[0].value;
   assert.equal(claim.state,'deleting');
   await q(db,'select attachment_finish_delete($1,$2,$3)',[module,attachment,other]);
   assert.equal((await q(db,'select state from attachment_lifecycle.objects where module=$1 and attachment_id=$2',[module,attachment]))[0].state,'deleting','wrong delete token cannot finalize');
   await q(db,'select attachment_finish_delete($1,$2,$3)',[module,attachment,claim.delete_token]);
   const canonical=(await q(db,'select deletion_status,deleted_at from board_task_attachments where id=$1',[attachment]))[0];
   assert.equal(canonical.deletion_status,'deleted');assert.ok(canonical.deleted_at,'manual confirmed delete writes canonical tombstone after finalization');
   assert.equal((await q(db,'select count(*)::int n from board_task_attachments where id=$1',[attachment]))[0].n,1,'manual delete preserves user metadata row');
   assert.equal((await q(db,"select count(*)::int n from board_task_attachments where id=$1 and upload_status='ready' and deletion_status='active'",[attachment]))[0].n,0,'canonical reload no longer returns deleted attachment');
  }

  const finalizeAutomatic=async(module,targetCard,attachment,otherCards)=>{
   await db.exec(`update attachment_lifecycle.cards set completed_at=clock_timestamp()+interval '100 years' where module='${module}' and card_id in (${otherCards.map(value=>`'${value}'`).join(',')}); update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '72 hours' where module='${module}' and card_id='${targetCard}'`);
   const claim=(await q(db,'select attachment_claim_expired() value'))[0].value;
   assert.equal(claim.module,module);assert.equal(claim.attachment_id,attachment);assert.equal(claim.state,'deleting');
   await q(db,'select attachment_finish_delete($1,$2,$3)',[module,attachment,claim.delete_token]);
   const canonical=(await q(db,'select deletion_status,deleted_at from board_task_attachments where id=$1',[attachment]))[0];
   assert.equal(canonical.deletion_status,'deleted');assert.ok(canonical.deleted_at,'automatic verified delete writes canonical tombstone');
   assert.equal((await q(db,"select count(*)::int n from board_task_attachments where id=$1 and upload_status='ready' and deletion_status='active'",[attachment]))[0].n,0,'automatic cleanup disappears from canonical reload');
  };
  await finalizeAutomatic('worktodo',card,id,[boardCard,workflowCard]);
  await finalizeAutomatic('board',boardCard,boardAutoId,[workflowCard]);
  assert.equal((await q(db,'select count(*)::int n from board_task_attachments'))[0].n,6,'manual and automatic deletes retain all canonical records');

  // Unknown Storage metadata must stop both dashboard capacity and upload reservation.
  await db.exec(`update taskflow.issue set status='todo' where id='${card}'; insert into storage.objects values('unmanaged-unknown','unknown','{}')`);
  await assert.rejects(q(db,'select attachment_capacity()'),/storage size metadata unavailable/);
  await assert.rejects(q(db,'select attachment_reserve_taskflow($1,$2,$3,$4,$5,$6)',[id,card,workspace,`workspaces/${workspace}/${id}.pdf`,'unknown.pdf',12]),/storage size metadata unavailable/);
  await db.exec(`delete from storage.objects where bucket_id='unmanaged-unknown'; update attachment_lifecycle.config set capacity_bytes=1000; insert into storage.objects values('unmanaged','big','{"size":700}')`);
  assert.equal((await q(db,'select attachment_capacity() value'))[0].value.warning,70);
  await db.exec(`update storage.objects set metadata='{"size":900}' where bucket_id='unmanaged'`);
  assert.equal((await q(db,'select attachment_capacity() value'))[0].value.warning,90);
  await assert.rejects(q(db,'select attachment_reserve_taskflow($1,$2,$3,$4,$5,$6)',[id,card,workspace,`workspaces/${workspace}/${id}.pdf`,'large.pdf',100]),/capacity exhausted/);
  assert.equal((await q(db,'select count(*)::int n from storage.objects'))[0].n,1,'capacity rejection never deletes existing bytes');

  // TaskFlow uses its native status catalog and also starts a fresh window on re-completion.
  await db.exec(`update attachment_lifecycle.config set capacity_bytes=10000;update storage.objects set metadata='{"size":12}' where bucket_id='unmanaged';`);
  const key=`workspaces/${workspace}/${id}.pdf`;
  await q(db,'select attachment_reserve_taskflow($1,$2,$3,$4,$5,$6)',[id,card,workspace,key,'fixture.pdf',12]);
  await db.exec(`insert into taskflow.attachment values('${id}','${card}',null,'${workspace}','https://unit.supabase.co/storage/v1/object/authenticated/taskflow-attachments/${key}','fixture.pdf',12,'${owner}');insert into storage.objects values('taskflow-attachments','${key}','{"size":12}');update taskflow.issue set status='finished' where id='${card}'`);
  const taskflowCard=(await q(db,"select completed_at from attachment_lifecycle.cards where module='taskflow' and card_id=$1",[card]))[0];
  assert.ok(taskflowCard.completed_at);
  assert.ok((await q(db,'select attachment_access($1,$2,$3) value',['taskflow',id,'preview']))[0].value.ttl>0);
  await db.exec(`update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '24 hours' where module='taskflow' and card_id='${card}'`);
  await assert.rejects(q(db,'select attachment_access($1,$2,$3)',['taskflow',id,'preview']),/preview expired/);
  assert.ok((await q(db,'select attachment_access($1,$2,$3) value',['taskflow',id,'download']))[0].value.ttl>0);
  await db.exec(`update taskflow.issue set status='todo' where id='${card}'`);
  assert.equal((await q(db,"select completed_at from attachment_lifecycle.cards where module='taskflow' and card_id=$1",[card]))[0].completed_at,null);

  // Excluded shared-bucket consumers keep their existing bytes and policy path.
  await db.exec(`insert into board_tasks(id,application_scope,status,owner_uuid) values('${other}','investment','done','${owner}');insert into board_task_attachments values('${other}','${other}','board-task-attachments','investment/file','keep.pdf',5,'ready','active');`);
  assert.equal((await q(db,'select attachment_access($1,$2,$3) value',['board',other,'preview']))[0].value.enabled,false);
  assert.equal((await q(db,'select count(*)::int n from attachment_lifecycle.objects where attachment_id=$1',[other]))[0].n,0);
  await db.exec(`alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;create policy fixture_storage on storage.objects for all to authenticated using(true) with check(true);insert into storage.objects values('investment','investment/file','{"size":5}');`);
  await db.exec(fs.readFileSync('labs/attachments/sql/storage_policies_candidate.sql','utf8'));
  await db.exec('set role authenticated');
  assert.equal((await q(db,"select count(*)::int n from storage.objects where bucket_id='taskflow-attachments'"))[0].n,0,'direct signing/read bypass is closed');
  assert.equal((await q(db,"select count(*)::int n from storage.objects where name='investment/file'"))[0].n,1,'unrelated shared bytes remain accessible');
  await assert.rejects(db.exec("insert into storage.objects values('taskflow-attachments','arbitrary','{}')"),/row-level security/);
  await assert.rejects(q(db,'select attachment_claim_expired()'),/permission denied/);
  await assert.rejects(q(db,'select * from attachment_lifecycle.objects'),/permission denied/);
  await db.exec('reset role');
 }finally{await db.close()}
});
