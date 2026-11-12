import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA taskflow;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.sub',true)::uuid$$;CREATE TABLE taskflow.member(user_id uuid,workspace_id uuid,role text);CREATE TABLE taskflow.workspace(id uuid,slug text);CREATE TABLE taskflow.issue(id uuid PRIMARY KEY,workspace_id uuid,title text,start_date date,due_date date);CREATE TABLE public.user_ecp_tasks(id uuid DEFAULT gen_random_uuid(),user_uuid uuid,name text,is_active boolean,sort_order int);CREATE TABLE public.user_work_profiles(user_uuid uuid,default_task text);CREATE TABLE public.work_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid REFERENCES auth.users(id),work_date date,started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,hours numeric,title text,note text,event_type text,status text,source text,ecp_task_name_snapshot text,ecp_task_id uuid,legacy_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),deleted_at timestamptz,google_delete_requested_at timestamptz,CONSTRAINT work_entries_time_check CHECK(started_at<ended_at));CREATE FUNCTION public.stamp() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;CREATE TRIGGER stamp BEFORE UPDATE ON public.work_entries FOR EACH ROW EXECUTE FUNCTION public.stamp();`);
await db.exec("CREATE FUNCTION public.is_app_access_approved() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.app_approved',true),'true')='true'$$;");
// Match production ownership and membership without granting general writes.
await db.exec(`CREATE ROLE worklog_deployer NOSUPERUSER NOBYPASSRLS NOINHERIT;CREATE ROLE taskflow_migrator;CREATE ROLE taskflow_runtime;CREATE ROLE service_role;

ALTER TABLE public.work_entries OWNER TO worklog_deployer;
GRANT CREATE,USAGE ON SCHEMA public TO worklog_deployer;
GRANT USAGE ON SCHEMA auth TO worklog_deployer;
GRANT REFERENCES ON auth.users TO worklog_deployer;
GRANT SELECT ON public.user_ecp_tasks,public.user_work_profiles TO worklog_deployer;
ALTER SCHEMA taskflow OWNER TO taskflow_migrator;
ALTER TABLE taskflow.issue OWNER TO taskflow_migrator;
ALTER TABLE taskflow.member OWNER TO taskflow_migrator;
ALTER TABLE taskflow.workspace OWNER TO taskflow_migrator;
GRANT USAGE ON SCHEMA public TO taskflow_migrator;
REVOKE ALL ON FUNCTION public.is_app_access_approved() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_access_approved() TO worklog_deployer;
GRANT USAGE ON SCHEMA taskflow TO worklog_deployer;
GRANT SELECT ON ALL TABLES IN SCHEMA taskflow TO worklog_deployer;
GRANT USAGE ON SCHEMA public TO taskflow_migrator;
`);
const stage1=await readFile('../../../../modules/worklog/native/server/date-hours.sql','utf8');
const stage2=(await readFile('../../../../modules/worklog/native/server/date-hours-taskflow.sql','utf8')).replaceAll('TO postgres;', 'TO worklog_deployer;');
const stage3=await readFile('../../../../modules/worklog/native/server/date-hours-finalize.sql','utf8');
await db.exec('SET ROLE worklog_deployer;'+stage1+'RESET ROLE;');
await db.exec('SET ROLE taskflow_migrator;'+stage2+'RESET ROLE;');
await db.exec('SET ROLE worklog_deployer;'+stage3+'RESET ROLE;');

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',workspace='33333333-3333-4333-8333-333333333333',issue='44444444-4444-4444-8444-444444444444';
await db.exec(`INSERT INTO auth.users VALUES('${owner}'),('${other}');INSERT INTO taskflow.workspace VALUES('${workspace}','real-workspace');INSERT INTO taskflow.member VALUES('${owner}','${workspace}','owner');INSERT INTO public.user_ecp_tasks(user_uuid,name,is_active,sort_order) VALUES('${owner}','原ECP',true,0);INSERT INTO public.user_work_profiles VALUES('${owner}','本人預設');INSERT INTO taskflow.issue VALUES('${issue}','${workspace}','原任務','2026-10-01','2026-10-01');`);
const rows=async()=> (await db.query(`SELECT * FROM public.work_entries WHERE status<>'deleted' ORDER BY work_date`)).rows;
assert.equal((await rows()).length,0);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);await assert.rejects(db.exec(`SELECT public.worklog_enable_task_dates('${workspace}')`),/owner workspace/);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${owner}',false);SELECT set_config('test.app_approved','false',false)`);await assert.rejects(db.exec(`SELECT public.worklog_enable_task_dates('${workspace}')`),/owner workspace/);await db.exec(`SELECT set_config('test.app_approved','true',false);SELECT public.worklog_enable_task_dates('${workspace}');`);assert.equal((await rows()).length,0,'enrollment never backfills');
await db.exec(`UPDATE taskflow.issue SET title='舊任務只改名' WHERE id='${issue}';`);assert.equal((await rows()).length,0,'title edits do not import old dates');
await db.exec(`UPDATE taskflow.issue SET due_date='2026-11-13' WHERE id='${issue}';`);let live=await rows();assert.equal(live.length,2);assert.deepEqual(live.map(r=>Number(r.hours)),[1,1]);assert.ok(live.every(r=>r.started_at===null&&r.ended_at===null));assert.equal(live[0].ecp_task_name_snapshot,'本人預設');
const first=live[0].id;await db.exec(`UPDATE public.work_entries SET hours=1.5,taskflow_hours_adjusted=true WHERE id='${first}';UPDATE taskflow.issue SET start_date='2026-11-12' WHERE id='${issue}';`);live=await rows();assert.equal(live[0].id,first);assert.equal(Number(live[0].hours),1.5);
await db.exec(`UPDATE taskflow.issue SET start_date='2026-11-13',due_date='2026-11-14' WHERE id='${issue}';`);live=await rows();assert.equal(live[0].id,first);assert.equal(Number(live[0].hours),1.5);assert.equal(live[0].taskflow_issue_ref.kind,'start');assert.equal(live.length,2);
await db.exec(`UPDATE taskflow.issue SET start_date='2026-11-14',due_date='2026-11-13' WHERE id='${issue}';`);live=await rows();assert.equal(live.find(r=>r.taskflow_issue_ref.kind==='start').id,first);assert.equal(Number(live.find(r=>r.taskflow_issue_ref.kind==='start').hours),1.5);
await db.exec(`UPDATE taskflow.issue SET start_date='2026-11-12',due_date='2026-11-13' WHERE id='${issue}';`);
await db.exec(`UPDATE taskflow.issue SET title='新標題' WHERE id='${issue}';`);live=await rows();assert.equal(live.length,2);assert.ok(live.every(r=>r.title==='新標題'));assert.equal(Number(live[0].hours),1.5);
await db.exec(`UPDATE taskflow.issue SET due_date='2026-11-12' WHERE id='${issue}';`);live=await rows();assert.equal(live.length,1,'same-day endpoint once');assert.equal(live[0].taskflow_issue_ref.kind,'both');assert.equal(Number(live[0].hours),1.5);
await db.exec(`UPDATE taskflow.issue SET due_date='2026-11-14' WHERE id='${issue}';`);live=await rows();assert.equal(live.length,2);assert.equal(Number(live[0].hours),1.5);assert.equal(Number(live[1].hours),1);
await db.exec(`UPDATE taskflow.issue SET start_date=NULL WHERE id='${issue}';`);live=await rows();assert.equal(live.length,1);assert.equal(new Date(live[0].work_date).toISOString().slice(0,10),'2026-11-14');
await db.exec(`UPDATE taskflow.issue SET due_date=NULL WHERE id='${issue}';`);assert.equal((await rows()).length,0);assert.ok((await db.query(`SELECT * FROM public.work_entries WHERE status='deleted'`)).rows.every(r=>r.google_delete_requested_at));
await db.exec(`UPDATE taskflow.issue SET due_date='2026-11-15' WHERE id='${issue}';`);live=await rows();const rpcId=live[0].id,rpcVersion=live[0].updated_at;assert.notEqual(rpcId,first,'cleared source is a new registration, never revive deleted Google binding');const rpcResult=await db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-16','單次修改',1.5,'原備註','原ECP')`,[rpcId,rpcVersion]);assert.equal(Number(rpcResult.rows[0].hours),1.5);assert.equal((await db.query(`SELECT due_date::text FROM taskflow.issue WHERE id='${issue}'`)).rows[0].due_date,'2026-11-16');assert.equal(rpcResult.rows[0].started_at,null);await assert.rejects(db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-17','過時修改',2,'','')`,[rpcId,rpcVersion]),/changed/);await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);await assert.rejects(db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-17','越權',2,'','')`,[rpcId,rpcResult.rows[0].updated_at]),/owner workspace/);await db.exec(`SELECT set_config('request.jwt.claim.sub','${owner}',false);DELETE FROM taskflow.issue WHERE id='${issue}';`);assert.equal((await rows()).length,0);
await assert.rejects(db.exec(`INSERT INTO public.work_entries(user_uuid,work_date,started_at,ended_at,hours,title) VALUES('${owner}','2026-11-13',NULL,NULL,1,'普通工時不能沒時間')`),/work_entries_time_check/);
assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.work_entries WHERE user_uuid='${other}'`)).rows[0].n,0);
// Both production roles are non-superuser here. The worklog definer has no
// general issue writes, and ordinary roles cannot call its narrow helpers.
const privilege=async(role,table,action)=>(await db.query('SELECT has_table_privilege($1,$2,$3) AS ok',[role,table,action])).rows[0].ok;
assert.equal(await privilege('worklog_deployer','taskflow.issue','UPDATE'),false);
assert.equal(await privilege('worklog_deployer','taskflow.issue','TRIGGER'),false);
assert.equal(await privilege('taskflow_migrator','public.work_entries','UPDATE'),false);
const helperSig='taskflow.worklog_move_date_endpoint(uuid,uuid,uuid,text,date,date)';
for(const role of ['anon','authenticated','taskflow_runtime','service_role']){
 assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,helperSig])).rows[0].ok,false);
}
await db.exec(`INSERT INTO taskflow.issue VALUES('${issue}','${workspace}','保留其他欄位',NULL,'2026-11-18');`);
let guarded=(await rows())[0];assert.ok(guarded);
await db.exec(`SET ROLE worklog_deployer;`);
await assert.rejects(db.exec(`UPDATE taskflow.issue SET title='不可改' WHERE id='${issue}'`),/permission denied/);
await assert.rejects(db.exec(`SELECT taskflow.worklog_move_date_endpoint('${issue}','${workspace}','${owner}','title','2026-11-18','2026-11-19')`),/endpoint required/);
await assert.rejects(db.exec(`SELECT taskflow.worklog_move_date_endpoint('${issue}','${workspace}','${owner}','due','2026-11-17','2026-11-19')`),/dates changed/);
await assert.rejects(db.exec(`SELECT * FROM taskflow.worklog_lock_date_issue('${issue}','${workspace}','${other}')`),/owner workspace/);
await assert.rejects(db.exec(`SELECT * FROM taskflow.worklog_lock_date_issue('${issue}','55555555-5555-4555-8555-555555555555','${owner}')`),/owner workspace/);
await db.exec('RESET ROLE;');
await db.exec('BEGIN;');
await db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-19','rollback-title',2,'','')`,[guarded.id,guarded.updated_at]);
assert.equal((await rows())[0].title,'rollback-title');
await assert.rejects(db.exec('SELECT 1/0;'),/division by zero/);
await db.exec('ROLLBACK;');
let afterRollback=(await rows())[0];assert.equal(afterRollback.title,guarded.title);assert.equal(afterRollback.work_date.toISOString(),guarded.work_date.toISOString());
assert.equal((await db.query(`SELECT title,due_date::text FROM taskflow.issue WHERE id='${issue}'`)).rows[0].title,'保留其他欄位');
const moved=await db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-19','only-hours-title',1.5,'','')`,[guarded.id,guarded.updated_at]);
assert.equal((await db.query(`SELECT title,due_date::text FROM taskflow.issue WHERE id='${issue}'`)).rows[0].title,'保留其他欄位');
await assert.rejects(db.query(`SELECT * FROM public.worklog_update_date_hours($1,$2,'2026-11-20','replay',2,'','')`,[guarded.id,guarded.updated_at]),/changed/);
// Exercise real SQL roles, not just caller-side guards.
await db.exec(`GRANT USAGE ON SCHEMA public,auth,taskflow TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON public.work_entries TO authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);SET ROLE authenticated;`);
await assert.rejects(db.exec(`INSERT INTO public.work_entries(user_uuid,work_date,hours,title,date_only,taskflow_issue_ref) VALUES('${owner}','2026-11-20',1,'偽造',true,'{}')`),/owner-scoped transaction/);
await assert.rejects(db.exec(`UPDATE public.work_entries SET hours=3 WHERE date_only`),/owner-scoped transaction/);
await assert.rejects(db.exec(`DELETE FROM public.work_entries WHERE date_only`),/owner-scoped transaction/);
await assert.rejects(db.exec(`SELECT public.worklog_task_dates_changed()`),/permission denied/);
await db.exec('RESET ROLE;');
console.log(JSON.stringify({separateNonSuperuserOwners:true,noInheritedIssueWrites:true,narrowHelpersOnly:true,crossTenantDenied:true,otherColumnsUnchanged:true,replayDenied:true,transactionRollbackVerified:true,sqlDateHours:true,noHistoryBackfill:true,ownerWorkspace:true,datesCountAsHours:true,noFakeClock:true,manualHoursPreserved:true,repeatedTitleNoDuplicate:true,sameDayOnce:true,splitAndMove:true,clearAndDeleteTombstone:true,legacyTimedConstraint:true}));await db.close();
