const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const read = p => fs.readFileSync(p, 'utf8');
const base = read('supabase/migrations/20260916025649_global_floating_hub_app_access_phase1.sql');
const migration = read('supabase/migrations/20261108154522_reversible_app_access_switch.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fn = name => { const start = base.indexOf(`create or replace function public.${name}(`); const end = base.indexOf('$function$;', start)+12; return base.slice(start,end); };
test('ZG-71 real SQL: transition, reversible access, legacy writers, permissions, membership and idempotency', async () => {
 const db = new PGlite();
 const q = async sql => (await db.query(sql)).rows;
 const scalar = async sql => Object.values((await q(sql))[0])[0];
 const as = async n => db.exec(`select set_config('request.uid','${n ? id(n) : ''}',false)`);
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema private;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create table app_users(auth_user_id uuid,display_name text,email text,role text,created_at timestamptz default now());
 create table user_profiles(user_uuid uuid,display_name text,email text,created_at timestamptz default now());
 create table worklog_users(auth_user_id uuid,display_name text,email text,created_at timestamptz default now());
 create function resolve_creator_capability() returns jsonb language sql stable security definer as $$select jsonb_build_object('user_id',auth.uid(),'is_creator',exists(select 1 from app_users where auth_user_id=auth.uid() and role in ('creator','owner')))$$;
 create table private.app_access_settings(key text primary key,value jsonb,updated_at timestamptz default now());
 insert into private.app_access_settings values('review_paused','true');
 create function app_access_review_paused() returns boolean language sql stable security definer as $$select (value #>> '{}')::boolean from private.app_access_settings where key='review_paused'$$;`);
 await db.exec(base.slice(base.indexOf('create table if not exists private.app_access_application_events'),base.indexOf('create or replace function public.is_app_access_approved()')));
 await db.exec(read('tests/fixtures/app-access-deployed-baseline.sql'));
 // Historical baseline is safe to replay at either current flag value.
 for (const pause of [false,true]) {
   await db.exec(`update private.app_access_settings set value='${pause}'`);
   await db.exec(read('supabase/migrations/20261106093852_app_access_review_pause_baseline.sql'));
   assert.equal(await scalar('select app_access_review_paused()'),pause,'baseline preserves flag');
 }
 await db.exec(fn('submit_app_access_request'));
 await db.exec(fn('review_app_access_application'));
 for(let n=1;n<=8;n++) await db.exec(`insert into auth.users values('${id(n)}','test${n}@example.invalid')`);
 await db.exec(`insert into app_users(auth_user_id,display_name,email,role) values('${id(1)}','Creator','test1@example.invalid','creator'),('${id(2)}','Owner','test2@example.invalid','owner'),('${id(7)}','App member','test7@example.invalid','member');
 insert into user_profiles(user_uuid,display_name,email) values('${id(6)}','Profile member','test6@example.invalid');
 insert into worklog_users(auth_user_id,display_name,email) values('${id(5)}','Worklog member','test5@example.invalid');`);
 for(const [n,type] of [[1,'approved_bootstrap'],[2,'approved_bootstrap'],[3,'application_rejected'],[4,'application_submitted']]) {
 await db.exec(`insert into private.app_access_application_events(applicant_user_id,event_type,email_snapshot,display_name,reason,reviewer_user_id) values('${id(n)}','${type}','test${n}@example.invalid','TEST DATA ${n}','既有原因','${id(1)}')`);
 }
 const before = [];
 for(const pause of [true,false]) { await db.exec(`update private.app_access_settings set value='${pause}'`); for(let n=1;n<=8;n++){await as(n);before.push(await scalar('select resolve_app_access()'));} }
 const snapshot = await scalar('select jsonb_agg(to_jsonb(e) order by event_no) from private.app_access_application_events e');
 await db.exec(migration);
 let i=0;
 for(const pause of [true,false]) { await db.exec(`update private.app_access_settings set value='${pause}'`); for(let n=1;n<=8;n++){await as(n);const after=await scalar('select resolve_app_access()'); const old=before[i++]; for(const key of Object.keys(old)) assert.deepEqual(after[key],old[key],`migration preserves ${key}, pause=${pause}, user=${n}`);assert.equal(await scalar('select is_app_access_approved()'),after.status==='APPROVED');} }
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(e) order by event_no) from private.app_access_application_events e'),snapshot,'no event changes');
 await db.exec("update private.app_access_settings set value='true'"); await as(3);
 assert.equal(await scalar('select is_app_access_approved()'),true,'REJECTED+pause still allowed');
 await as(1);
 const set = (n,on,key,note='test note') => scalar(`select set_app_access_user_enabled('${id(n)}',${on},'${note}','${key}')`);
 const app = await scalar(`select application_id from private.app_access_application_events where applicant_user_id='${id(3)}'`);
 const off = await set(3,false,'off1');
 assert.equal((await set(3,false,'off1')).idempotent,true);
 await assert.rejects(set(3,true,'off1'),/Idempotency/);
 await as(3); assert.equal(await scalar('select is_app_access_approved()'),false,'Off+pause denied');
 let access=await scalar('select resolve_app_access()');assert.equal(access.status,'REJECTED');assert.equal(access.access_disabled,true);assert.equal(access.review_note,'test note');
 await assert.rejects(scalar("select submit_app_access_request('New','Try again','bypass')"),/administrator/);
 await as(1); await set(3,true,'on1'); await as(3); assert.equal(await scalar('select is_app_access_approved()'),true);
 assert.equal(await scalar(`select count(distinct application_id)::int from private.app_access_application_events where applicant_user_id='${id(3)}'`),1,'application preserved');
 await as(1); await set(4,true,'approve-pending');
 assert.equal(await scalar(`select event_type from private.app_access_application_events where applicant_user_id='${id(4)}' order by event_no desc limit 1`),'application_approved');
 await assert.rejects(set(1,false,'self'),/Cannot disable/);await assert.rejects(set(2,false,'creator'),/Cannot disable/);
 await assert.rejects(set(8,false,'unrelated'),/member not found/);
 await set(7,false,'no-app');await as(7);assert.equal(await scalar('select is_app_access_approved()'),false);
 await as(1); const list=await scalar('select list_app_access_applications()');
 assert.equal(list.length,7);assert.equal(new Set(list.map(x=>x.applicant_user_id)).size,7);assert.ok(!list.some(x=>x.applicant_user_id===id(8)));
 assert.equal(list.find(x=>x.applicant_user_id===id(1)).submitted_at,null,'bootstrap not fake application');
 await db.exec("update private.app_access_settings set value='false'");await as(6); access=await scalar('select resolve_app_access()');assert.equal(access.status,'NEW');assert.equal(access.enabled,false);
 await as(5); await scalar("select submit_app_access_request('TEST','Reason','pending-new')"); assert.equal((await scalar('select resolve_app_access()')).status,'PENDING');
 await assert.rejects(set(3,false,'noncreator'),/Creator/);await assert.rejects(scalar('select list_app_access_applications()'),/Creator/);
 await as(null);await assert.rejects(set(3,false,'anon'),/Creator/);
 await as(1);await assert.rejects(set(3,false,'long','x'.repeat(2001)),/Invalid/);
 await assert.rejects(db.exec("update private.app_access_application_events set review_note='tamper'"),/append-only/);
 await db.exec('set role authenticated');await assert.rejects(db.exec('select * from private.app_access_application_events'),/permission denied/);await db.exec('reset role');
 assert.equal(await scalar("select has_function_privilege('anon','public.set_app_access_user_enabled(uuid,boolean,text,text)','EXECUTE')"),false);
 assert.equal(await scalar("select has_function_privilege('authenticated','public.set_app_access_user_enabled(uuid,boolean,text,text)','EXECUTE')"),true);
 await db.exec(read('tests/fixtures/zg71-access-contract.sql'));
 console.log('TEST DATA SQL PASS: unchanged transition; REJECTED+paused allowed; Off+paused denied; creator protected; reversible; app identities scoped.');
 } finally { await db.close(); }
});
