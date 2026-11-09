-- TQ-95 phase 1: additive wallet and approved +1 daily login only.
-- Authority: Slack user1794210913.245759 and user1794211161.321939,
-- interpreted with main1794208903.732259 and main1794211141.242429.
-- No historical awards, no XP/progress rewrites, no learning-policy assumptions.
begin;
create table if not exists public.learning_adventure_wallets (
 hero_id uuid primary key references public.learning_adventure_heroes(id),
 adventure_family_id uuid not null references public.learning_adventure_families(id),
 balance integer not null default 0 check (balance >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.learning_adventure_coin_ledger (
 id uuid primary key default gen_random_uuid(),
 hero_id uuid not null references public.learning_adventure_wallets(hero_id),
 adventure_family_id uuid not null references public.learning_adventure_families(id),
 event_key text not null,
 kind text not null check (kind in ('daily_login','qualified_round','daily_task','redemption','refund')),
 amount integer not null check (amount <> 0),
 world text check (world is null or world in ('chengyu','vocab')),
 day date not null,
 source_attempt_id uuid,
 created_at timestamptz not null default now(),
 unique(hero_id,event_key),
 check ((kind in ('daily_login','qualified_round','daily_task','refund') and amount>0) or (kind='redemption' and amount<0))
);
create index if not exists learning_adventure_coin_history on public.learning_adventure_coin_ledger(hero_id,created_at desc);
alter table public.learning_adventure_wallets enable row level security;
alter table public.learning_adventure_coin_ledger enable row level security;
revoke all on public.learning_adventure_wallets,public.learning_adventure_coin_ledger from public,anon,authenticated;
grant all on public.learning_adventure_wallets,public.learning_adventure_coin_ledger to service_role;

create or replace function public.learning_adventure_wallet(p_family uuid,p_hero uuid,p_claim_login boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
 v_balance integer; v_day date := (statement_timestamp() at time zone 'Asia/Taipei')::date;
 v_awarded boolean := false; v_inserted uuid; v_history jsonb;
begin
 -- Both IDs originate in verified Edge family/hero resolution; recheck membership here.
 if not exists(select 1 from public.learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then
  raise exception 'family/hero mismatch' using errcode='42501';
 end if;
 insert into public.learning_adventure_wallets(hero_id,adventure_family_id) values(p_hero,p_family) on conflict(hero_id) do nothing;
 -- Serialize *all* writes to this wallet. A future debit must use this same row lock.
 select balance into v_balance from public.learning_adventure_wallets where hero_id=p_hero and adventure_family_id=p_family for update;
 if not found then raise exception 'wallet scope mismatch' using errcode='42501'; end if;
 if p_claim_login then
  insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,day)
  values(p_hero,p_family,'login:'||v_day::text,'daily_login',1,v_day)
  on conflict(hero_id,event_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
   update public.learning_adventure_wallets set balance=balance+1,updated_at=statement_timestamp() where hero_id=p_hero returning balance into v_balance;
   v_awarded:=true;
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into v_history
 from (select id,kind,amount,world,day,created_at from public.learning_adventure_coin_ledger where hero_id=p_hero and adventure_family_id=p_family order by created_at desc,id desc limit 50) x;
 return jsonb_build_object('balance',v_balance,'day',v_day,'timezone','Asia/Taipei','loginAwarded',v_awarded,'loginAmount',case when v_awarded then 1 else 0 end,'history',v_history);
end $fn$;
revoke all on function public.learning_adventure_wallet(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.learning_adventure_wallet(uuid,uuid,boolean) to service_role;
commit;
