const assert=require('node:assert/strict');
const fs=require('node:fs');
exports.verifyMatrix=async ({db,as,q,scalar,id})=>{
 const states=[['NEW',null],['PENDING','application_submitted'],['APPROVED','application_approved'],['REJECTED','application_rejected'],['disabled','access_disabled'],['enabled','access_enabled']];
 const output=[];
 for(const old of [false,true]) for(let n=0;n<states.length;n++){
  const user=id(100+(old?10:0)+n);const [label,event]=states[n];
  await db.exec(`insert into auth.users(id,email) values('${user}','matrix${100+(old?10:0)+n}@example.invalid'); insert into private.app_access_members(user_id,email,display_name) values('${user}','test@example.invalid','TEST DATA ${old?'既有':'新進'} ${label}');`);
  if(old)await db.exec(`insert into private.app_access_grandfathers(user_id) values('${user}')`);
  if(event)await db.exec(`insert into private.app_access_application_events(applicant_user_id,event_type,email_snapshot,display_name,reason,reviewer_user_id,source,created_at) values('${user}','${event}','test@example.invalid','TEST DATA ${label}','Test reason','${id(1)}','creator_access_switch','${old?'2000':'2100'}-01-01')`);
 }
 for(const cutoff of [false,true])for(const pause of [false,true]){
  await db.exec("delete from private.app_access_settings where key='access_model_cutoff'");
  if(cutoff)await db.exec("insert into private.app_access_settings(key,value) values('access_model_cutoff','\"2050-01-01T00:00:00Z\"')");
  await db.exec(`update private.app_access_settings set value='${pause}' where key='review_paused'`);
  await as(1);const list=await scalar('select list_app_access_applications()');
  for(const old of [false,true])for(let n=0;n<states.length;n++){
   const user=id(100+(old?10:0)+n),[state]=states[n];
   await db.exec(`select set_config('request.uid','${user}',false)`);
   const expected=state==='disabled'?false:['APPROVED','enabled'].includes(state)||pause&&(!cutoff||old);
   const backend=await scalar('select is_app_access_approved()');const resolved=await scalar('select resolve_app_access()');const card=list.find(r=>r.applicant_user_id===user);
   assert.equal(backend,expected,`${cutoff}/${pause}/${old}/${state}`);
   assert.equal(resolved.effective_allowed,backend);assert.equal(card.effective_allowed,backend);assert.equal(card.enabled,backend);
   output.push({cutoff,pause,old,state,backend,card});
  }
 }
 // A newly backdated profile cannot enter the protected snapshot.
 await db.exec(`insert into auth.users(id,email) values('${id(200)}','new@example.invalid'); insert into user_profiles(user_uuid,created_at) values('${id(200)}','1900-01-01');`);
 await as(200);await scalar('select ensure_app_member()');const seen=await scalar(`select first_seen_at from private.app_access_members where user_id='${id(200)}'`);
 await scalar('select ensure_app_member()');assert.equal(String(await scalar(`select first_seen_at from private.app_access_members where user_id='${id(200)}'`)),String(seen));
 assert.equal(await scalar('select is_app_access_approved()'),false,'backdated profile cannot grandfather');
 assert.equal(await scalar(`select count(*)::int from private.app_access_grandfathers where user_id='${id(200)}'`),0);
 await db.exec('set role authenticated');await assert.rejects(db.exec(`insert into private.app_access_grandfathers(user_id) values('${id(200)}')`),/permission denied/);await db.exec('reset role');
 for(const [n,table,column] of [[201,'app_users','auth_user_id'],[202,'worklog_users','auth_user_id']]) {
  await db.exec(`insert into auth.users(id,email) values('${id(n)}','backdate${n}@example.invalid'); insert into ${table}(${column},created_at) values('${id(n)}','1900-01-01')`);
  await as(n);await scalar('select ensure_app_member()');assert.equal(await scalar('select is_app_access_approved()'),false,table+' backdate cannot grandfather');
 }
 await assert.rejects(scalar(`select ensure_app_member('${id(1)}')`),/does not exist/);
 assert.equal(await scalar("select has_function_privilege('authenticated','private.activate_app_access_model()','EXECUTE')"),false);
 // New application by an old grandfather must be explicitly decided again.
 await as(1);await scalar(`select set_app_access_user_enabled('${id(110)}',true,null,'matrix-enable')`);
 await db.exec(`insert into private.app_access_application_events(applicant_user_id,event_type,email_snapshot,display_name,reason,source,created_at) values('${id(111)}','application_submitted','old@example.invalid','TEST','New request','user_application','2100-01-01')`);
 await as(111);assert.equal(await scalar('select is_app_access_approved()'),false);
 await as(1);await scalar(`select review_app_access_application((select application_id from private.app_access_application_events where applicant_user_id='${id(111)}' order by event_no desc limit 1),'reject','Test rejection','post-cutoff-reject')`);
 // The server's current clock precedes the future fixture cutoff; simulate only
 // the local clock position of this new decision, without mutating an event.
 await db.exec("update private.app_access_settings set value='\"1901-01-01T00:00:00Z\"' where key='access_model_cutoff'");
 await as(111);assert.equal(await scalar('select is_app_access_approved()'),false,'new rejection cannot restore grandfather allowance');
 // Activation is owner-only, gap-blocked and does not auto-run with migration.
 await db.exec("delete from private.app_access_settings where key='access_model_cutoff'");
 await assert.rejects(scalar('select private.activate_app_access_model()'),/lack App evidence/);
 await as(8);await scalar('select ensure_app_member()');await as(1);
 const activation=await scalar('select private.activate_app_access_model()');assert.ok(activation.grandfather_count>0);
 await assert.rejects(scalar('select private.activate_app_access_model()'),/already activated/);
 await as(null);await assert.rejects(scalar('select ensure_app_member()'),/Authenticated/);
 // Persist non-PII local computed matrix for the UI test in the same CI job.
 fs.mkdirSync('/tmp/zg71-matrix',{recursive:true});fs.writeFileSync('/tmp/zg71-matrix/result.json',JSON.stringify(output));
 console.log('48 SQL combinations PASS; server timestamp/idempotency/backdating/activation gate PASS');
};
