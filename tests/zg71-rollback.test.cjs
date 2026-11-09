const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');const phase=read('supabase/migrations/20260916025649_global_floating_hub_app_access_phase1.sql');
const defs=JSON.parse(read('tests/fixtures/zg71-live-function-definitions.json')).functions;
test('rollback restores all 7 live definitions, removes guard; unsafe post-decision rollback refuses atomically',async()=>{
const db=new PGlite();try{
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create table app_users(auth_user_id uuid,role text,display_name text,email text,created_at timestamptz default now());
 create table user_profiles(user_uuid uuid,display_name text,email text,created_at timestamptz default now());
 create table worklog_users(auth_user_id uuid,display_name text,email text,created_at timestamptz default now());
 create function resolve_creator_capability() returns jsonb language sql stable as $$select '{"is_creator":true}'::jsonb$$;`);
 await db.exec(phase.slice(phase.indexOf('create table if not exists private.app_access_application_events'),phase.indexOf('create or replace function public.is_app_access_approved()')));
 await db.exec(read('supabase/migrations/20261106093852_app_access_review_pause_baseline.sql'));
 for(const d of defs)await db.exec(d.definition+';');
 const before=await db.query("select proname,prosrc from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('is_app_access_approved','resolve_app_access','list_app_access_applications','review_app_access_application','submit_app_access_request','app_access_review_paused','set_app_access_review_paused') order by proname");
 await db.exec(read('supabase/migrations/20261108154522_reversible_app_access_switch.sql'));
 await db.exec(read('docs/zg71/rollback-legacy.sql'));
 const after=await db.query("select proname,prosrc from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('is_app_access_approved','resolve_app_access','list_app_access_applications','review_app_access_application','submit_app_access_request','app_access_review_paused','set_app_access_review_paused') order by proname");
 assert.deepEqual(after.rows,before.rows);assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='app_access_switch_guard'")).rows[0].n,0);
 // The private membership tables were deliberately retained; retry migration on
 // a fresh fixture for post-decision rollback refusal (no replay of deployed DDL).
 await db.exec(`drop table private.app_access_members,private.app_access_grandfathers;`);
 await db.exec(read('supabase/migrations/20261108154522_reversible_app_access_switch.sql'));
 await db.exec(`insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','test@example.invalid'); insert into private.app_access_application_events(applicant_user_id,event_type,email_snapshot,reviewer_user_id,source) values('00000000-0000-4000-8000-000000000001','access_disabled','test@example.invalid','00000000-0000-4000-8000-000000000001','creator_access_switch');`);
 await assert.rejects(db.exec(read('docs/zg71/rollback-legacy.sql')),/Unsafe legacy rollback/);await db.exec('rollback');
 assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='app_access_switch_guard'")).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int as n from private.app_access_application_events')).rows[0].n,1);
 await db.exec(read('docs/zg71/rollback-compatible.sql'));
 assert.equal((await db.query("select has_function_privilege('authenticated','public.set_app_access_user_enabled(uuid,boolean,text,text)','EXECUTE') as ok")).rows[0].ok,false);
 await db.exec("select set_config('request.uid','00000000-0000-4000-8000-000000000001',false)");
 await db.exec('select ensure_app_member()');
 assert.equal((await db.query("select has_function_privilege('authenticated','public.ensure_app_member()','EXECUTE') as ok")).rows[0].ok,true);
 assert.equal((await db.query('select is_app_access_approved() as ok')).rows[0].ok,false);
 }finally{await db.close();}
});
