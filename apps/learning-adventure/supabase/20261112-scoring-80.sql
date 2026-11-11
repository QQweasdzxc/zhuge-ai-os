begin;
-- Approved 2026-11-12: only new rounds with >=80% receive existing round coins.
-- Additive cutoff. Existing balance/ledger, amount 5, cap 3/island/day and daily review unchanged.
create table if not exists public.learning_adventure_scoring_release(singleton boolean primary key default true check(singleton),starts_at timestamptz not null default clock_timestamp());
insert into public.learning_adventure_scoring_release(singleton) values(true) on conflict do nothing;
alter table public.learning_adventure_scoring_release enable row level security;
revoke all on public.learning_adventure_scoring_release from public,anon,authenticated;
grant select on public.learning_adventure_scoring_release to service_role;
CREATE OR REPLACE FUNCTION public.learning_adventure_award_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_world text:=case when tg_table_name='chengyu_family_attempts' then 'chengyu' else 'vocab' end;v_hero uuid;v_family uuid;v_day date:=(new.created_at at time zone 'Asia/Taipei')::date;v_id uuid;begin
 if v_world='vocab' and new.client_run_id is null then return new;end if;
 if new.created_at >= (select starts_at from public.learning_adventure_scoring_release where singleton) and (coalesce(new.question_count,0)<=0 or coalesce(new.correct_count,0)::bigint*100 < new.question_count::bigint*80) then return new;end if;
 if new.result_status<>'completed' or new.created_at<(select starts_at from public.learning_adventure_learning_release where singleton) then return new;end if;
 select h.id,h.adventure_family_id into v_hero,v_family from public.learning_adventure_hero_links l join public.learning_adventure_heroes h on h.id=l.hero_id join public.learning_adventure_family_bindings b on b.adventure_family_id=h.adventure_family_id and b.world=l.world and b.source_family_id=new.family_id where l.world=v_world and l.source_learner_id=new.learner_id limit 1;
 if v_hero is null then return new;end if;
 perform public.learning_adventure_wallet(v_family,v_hero,false);
 if(select count(*) from public.learning_adventure_coin_ledger where hero_id=v_hero and world=v_world and day=v_day and kind='qualified_round')>=3 then return new;end if;
 insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,world,day,source_attempt_id) values(v_hero,v_family,'round:'||v_world||':'||new.id,'qualified_round',5,v_world,v_day,new.id) on conflict(hero_id,event_key) do nothing returning id into v_id;
 if v_id is not null then update public.learning_adventure_wallets set balance=balance+5,updated_at=clock_timestamp() where hero_id=v_hero;end if;return new;
end $function$
  ;
commit;
