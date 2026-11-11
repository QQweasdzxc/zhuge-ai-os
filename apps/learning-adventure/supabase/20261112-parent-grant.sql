-- Parent-granted coins with required reason (2026-11-12).
-- Feature: a verified parent chooses a child, types the amount and a required reason; issuer is recorded only as "家長".
-- Additive only: no historical backfill, no change to existing earning rules, balances or caps.
-- Amounts are always typed by the parent; nothing here chooses or grants coins by itself.
begin;
do $m$
declare c record;
begin
 for c in select conname from pg_constraint where conrelid='public.learning_adventure_coin_ledger'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%kind%' loop
  execute format('alter table public.learning_adventure_coin_ledger drop constraint %I',c.conname);
 end loop;
end $m$;
alter table public.learning_adventure_coin_ledger add constraint learning_adventure_coin_ledger_kind_ck check (kind in ('daily_login','qualified_round','daily_task','redemption','refund','parent_grant'));
alter table public.learning_adventure_coin_ledger add constraint learning_adventure_coin_ledger_sign_ck check ((kind in ('daily_login','qualified_round','daily_task','refund','parent_grant') and amount>0) or (kind='redemption' and amount<0));

create table if not exists public.learning_adventure_parent_grants (
 id uuid primary key default gen_random_uuid(),
 adventure_family_id uuid not null references public.learning_adventure_families(id),
 hero_id uuid not null references public.learning_adventure_wallets(hero_id),
 client_request_id uuid not null,
 amount integer not null check (amount between 1 and 100000),
 reason text not null check (length(btrim(reason)) between 1 and 200),
 issuer text not null default '家長' check (issuer='家長'),
 day date not null,
 created_at timestamptz not null default now(),
 unique(adventure_family_id,client_request_id)
);
create index if not exists learning_adventure_parent_grants_hero on public.learning_adventure_parent_grants(hero_id,created_at desc);
alter table public.learning_adventure_parent_grants enable row level security;
revoke all on public.learning_adventure_parent_grants from public,anon,authenticated;
grant all on public.learning_adventure_parent_grants to service_role;

create or replace function public.learning_adventure_parent_grant(p_family uuid,p_parent_session text,p_hero uuid,p_amount integer,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
 v_day date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
 v_reason text:=btrim(coalesce(p_reason,''));
 old public.learning_adventure_parent_grants; v_id uuid; v_balance integer;
begin
 if not public.learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501'; end if;
 if not exists(select 1 from public.learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family/hero mismatch' using errcode='42501'; end if;
 if p_request is null then return jsonb_build_object('ok',false,'error','缺少送出識別碼'); end if;
 if p_amount is null or p_amount not between 1 and 100000 then return jsonb_build_object('ok',false,'error','請輸入 1 到 100000 的金幣數量'); end if;
 if length(v_reason) not between 1 and 200 then return jsonb_build_object('ok',false,'error','請寫下原因（1 到 200 字）'); end if;
 insert into public.learning_adventure_wallets(hero_id,adventure_family_id) values(p_hero,p_family) on conflict(hero_id) do nothing;
 select balance into v_balance from public.learning_adventure_wallets where hero_id=p_hero and adventure_family_id=p_family for update;
 if not found then raise exception 'wallet scope mismatch' using errcode='42501'; end if;
 select * into old from public.learning_adventure_parent_grants where adventure_family_id=p_family and client_request_id=p_request;
 if found then
  if old.hero_id<>p_hero or old.amount<>p_amount or old.reason<>v_reason then return jsonb_build_object('ok',false,'error','這個送出識別碼已被使用'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'grantId',old.id,'balance',v_balance);
 end if;
 insert into public.learning_adventure_parent_grants(adventure_family_id,hero_id,client_request_id,amount,reason,day) values(p_family,p_hero,p_request,p_amount,v_reason,v_day) returning id into v_id;
 insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,day) values(p_hero,p_family,'parent_grant:'||v_id,'parent_grant',p_amount,v_day);
 update public.learning_adventure_wallets set balance=balance+p_amount,updated_at=statement_timestamp() where hero_id=p_hero returning balance into v_balance;
 return jsonb_build_object('ok',true,'duplicate',false,'grantId',v_id,'balance',v_balance);
end $fn$;

create or replace function public.learning_adventure_list_parent_grants(p_family uuid,p_parent_session text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $fn$
begin
 if not public.learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'grants',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
  select g.id,g.hero_id,h.display_name as hero_name,g.amount,g.reason,g.issuer,g.day,g.created_at
  from public.learning_adventure_parent_grants g join public.learning_adventure_heroes h on h.id=g.hero_id
  where g.adventure_family_id=p_family order by g.created_at desc,g.id desc limit 100) x),'[]'::jsonb));
end $fn$;
revoke all on function public.learning_adventure_parent_grant(uuid,text,uuid,integer,text,uuid),public.learning_adventure_list_parent_grants(uuid,text) from public,anon,authenticated;
grant execute on function public.learning_adventure_parent_grant(uuid,text,uuid,integer,text,uuid),public.learning_adventure_list_parent_grants(uuid,text) to service_role;
commit;
