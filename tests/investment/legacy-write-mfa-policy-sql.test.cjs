'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
// Isolated PGlite verification for 20261118101000_investment_legacy_write_mfa_policy.sql.
// Aligns the legacy Investment write RPC gates (record transaction, pending-action
// confirm, broker position snapshot) with the saved sensitive-write switch, matching
// the reviewed receivable split: aal2 always passes; aal1 passes only with the
// server-saved boolean investment_sensitive_write_mfa_required === false. The entry
// switch never implies a write bypass; unknown aal or missing/malformed preference
// stays fail-closed. Synthetic data only; no real trading or business records.
test('isolated SQL gates legacy write RPCs on the saved sensitive-write switch, never the entry switch',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',oa='33333333-3333-4333-8333-333333333333',ob='44444444-4444-4444-8444-444444444444',pid='55555555-5555-4555-8555-555555555555';
 try{
 await db.exec(`create schema auth;create schema extensions;create schema private;create role anon;create role authenticated;create role service_role;create table auth.users(id uuid primary key);create table public.app_users(id uuid primary key,auth_user_id uuid,role text);create table public.user_settings(user_id uuid,setting_key text,setting_value jsonb,unique(user_id,setting_key));create table public.portfolios(id uuid primary key,user_id uuid);create table public.opening_positions(id uuid primary key,user_id uuid,portfolio_id uuid,market text,symbol text,bootstrap_at timestamptz);create table public.transactions(id uuid primary key default gen_random_uuid(),user_id uuid,portfolio_id uuid,trade_date date,trade_type text,symbol text,name text,market text,quantity numeric,price numeric,gross_amount numeric,fee numeric,tax numeric,net_amount numeric,currency text,account text,source text,note text);create view public.investment_current_positions_view as select null::uuid as user_id,null::uuid as portfolio_id,''::text as market,''::text as symbol,''::text as position_status,0::numeric as quantity,null::uuid as source_id,null::timestamptz as effective_at where false;create table public.investment_ivtk_card_links(source_kind text,card_kind text);create table public.board_instances(id uuid primary key,active boolean,template_key text,task_code_prefix text,is_template_instance boolean,created_by uuid,owner_uuid uuid);create table public.board_workspaces(workspace_key text,name text,sort_order integer,active boolean,created_by uuid,updated_by uuid,application_scope text,owner_uuid uuid,board_instance_id uuid,unique(board_instance_id,workspace_key));create table public.watchlists(user_id uuid);create table public.strategies(user_id uuid);create table public.onboarding_state(user_id uuid);create table public.decision_logs(user_id uuid);create table public.board_tasks(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;create function extensions.gen_random_uuid() returns uuid language sql volatile as $$select gen_random_uuid()$$;grant usage on schema auth,extensions,private to authenticated;grant select on public.app_users to authenticated;insert into auth.users values('${a}'),('${b}');insert into public.app_users values('${oa}','${a}','creator'),('${ob}','${b}','user');`);
 const root=path.resolve(__dirname,'../../supabase/migrations');
 for(const f of['20260902010211_20260902_broker_position_snapshot_model.sql','20260902052330_investment_mfa_pause_read_policy.sql','20260902131808_20260902173901_investment_two_layer_mfa_contract.sql','20260915142028_investment_transaction_lifecycle_v1.sql','20260917093117_investment_pending_action_confirmation_v1.sql']) await db.exec(fs.readFileSync(path.join(root,f),'utf8'));
 const migration=fs.readFileSync(path.join(root,'20261118101000_investment_legacy_write_mfa_policy.sql'),'utf8');await db.exec(migration);await db.exec(migration);
 const auth=async(who,aal)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${who}',false),set_config('request.jwt.claim.aal','${aal}',false);`);
 const prefs=async(entry,write)=>{const rows=[];if(entry!==null)rows.push(`('${oa}','investment_entry_mfa_required','${JSON.stringify(entry)}')`);if(write!==null)rows.push(`('${oa}','investment_sensitive_write_mfa_required','${JSON.stringify(write)}')`);await db.exec(`reset role;delete from public.user_settings;${rows.length?`insert into public.user_settings values${rows.join(',')};`:''}`);};
 const np='66666666-6666-4666-8666-666666666666';
 const record=key=>`select * from public.investment_record_transaction('${np}','2026-11-18','買進','2330','Synthetic','TW',1,100,0,0,'TWD',null,null,'synthetic-write-policy-${key}')`;
 const confirm=`select * from public.investment_confirm_pending_action('${np}')`;
 const snapshot=key=>`select * from public.create_broker_position_snapshot('${np}','SyntheticBroker','2026-11-18T10:00:00+08','pm_confirmed','synthetic','synthetic-write-policy-${key}','[]'::jsonb)`;
 // Gate-pass markers: the next owner/scope validation after the AAL gate.
 const passRecord=/INVESTMENT_PORTFOLIO_SCOPE_REQUIRED/,passConfirm=/INVESTMENT_PENDING_ACTION_NOT_FOUND/,passSnapshot=/BROKER_SNAPSHOT_PORTFOLIO_SCOPE_REQUIRED/;
 const blockRecord=/INVESTMENT_TRANSACTION_AAL2_REQUIRED/,blockConfirm=/INVESTMENT_PENDING_AAL2_REQUIRED/,blockSnapshot=/BROKER_SNAPSHOT_AAL2_REQUIRED/;
 // Write switch off + entry on: aal1 passes all three write gates (writes never follow entry).
 await prefs(true,false);await auth(a,'aal1');
 await assert.rejects(db.query(record('01')),passRecord);await assert.rejects(db.query(confirm),passConfirm);await assert.rejects(db.query(snapshot('01')),passSnapshot);
 // Write switch on + entry off: aal1 blocked on all three (entry=false never implies write=false).
 await prefs(false,true);await auth(a,'aal1');
 await assert.rejects(db.query(record('02')),blockRecord);await assert.rejects(db.query(confirm),blockConfirm);await assert.rejects(db.query(snapshot('02')),blockSnapshot);
 // Write switch on: aal2 always passes.
 await auth(a,'aal2');
 await assert.rejects(db.query(record('03')),passRecord);await assert.rejects(db.query(confirm),passConfirm);await assert.rejects(db.query(snapshot('03')),passSnapshot);
 // Full happy path under aal1 + write off: a real insert still succeeds unchanged.
 await prefs(false,false);await auth(a,'aal1');await db.exec(`reset role;insert into public.portfolios values('${pid}','${oa}');`);
 const ok=(await db.query(`select public.investment_record_transaction('${pid}','2026-11-18','買進','2330','Synthetic','TW',1,100,0,0,'TWD',null,null,'synthetic-write-policy-ok') as result`)).rows[0].result;assert(ok.transaction_id);assert.equal((await db.query(`select count(*)::int c from public.transactions where idempotency_key='synthetic-write-policy-ok'`)).rows[0].c,1);
 // Missing write preference fails closed at aal1.
 await prefs(false,null);await auth(a,'aal1');await assert.rejects(db.query(record('04')),blockRecord);
 // Malformed (string) write preference fails closed.
 await prefs(false,'false');await auth(a,'aal1');await assert.rejects(db.query(record('05')),blockRecord);
 // Unknown / empty aal fails closed even with the write switch off.
 await prefs(false,false);for(const aal of['unknown','']){await auth(a,aal);await assert.rejects(db.query(record('06')),blockRecord);await assert.rejects(db.query(confirm),blockConfirm);}
 // Non-owner mapped role never bypasses, even with its own saved write=false.
 await db.exec(`reset role;insert into public.user_settings values('${ob}','investment_sensitive_write_mfa_required','false');`);await auth(b,'aal1');
 assert.equal((await db.query(`select private.investment_write_mfa_bypassed() as bypass`)).rows[0].bypass,false);await assert.rejects(db.query(record('07')),blockRecord);
 // anon has no access to the gated RPCs.
 await db.exec(`reset role;set role anon;`);await assert.rejects(db.query(record('08')));
 }finally{await db.close();}
});
