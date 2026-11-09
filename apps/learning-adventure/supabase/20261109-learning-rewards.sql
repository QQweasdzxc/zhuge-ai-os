begin;
alter table public.vocab_family_attempts add column if not exists client_run_id uuid;
create unique index if not exists vocab_attempt_client_run_unique on public.vocab_family_attempts(client_run_id) where client_run_id is not null;
create table if not exists public.learning_adventure_learning_release(singleton boolean primary key default true check(singleton),starts_at timestamptz not null default clock_timestamp());
insert into public.learning_adventure_learning_release(singleton) values(true) on conflict do nothing;
create table if not exists public.learning_adventure_daily_reviews(
 id uuid primary key default gen_random_uuid(),adventure_family_id uuid not null references public.learning_adventure_families(id),hero_id uuid not null references public.learning_adventure_heroes(id),world text not null check(world in('chengyu','vocab')),day date not null,source_attempt_id uuid not null,questions jsonb not null,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),unique(hero_id,world,day)
);
alter table public.learning_adventure_daily_reviews enable row level security;
alter table public.learning_adventure_learning_release enable row level security;
revoke all on public.learning_adventure_daily_reviews,public.learning_adventure_learning_release from public,anon,authenticated;
grant all on public.learning_adventure_daily_reviews,public.learning_adventure_learning_release to service_role;
create or replace function public.learning_adventure_award_round() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_world text:=case when tg_table_name='chengyu_family_attempts' then 'chengyu' else 'vocab' end;v_hero uuid;v_family uuid;v_day date:=(new.created_at at time zone 'Asia/Taipei')::date;v_id uuid;begin
 if v_world='vocab' and new.client_run_id is null then return new;end if;
 if new.result_status<>'completed' or new.created_at<(select starts_at from public.learning_adventure_learning_release where singleton) then return new;end if;
 select h.id,h.adventure_family_id into v_hero,v_family from public.learning_adventure_hero_links l join public.learning_adventure_heroes h on h.id=l.hero_id join public.learning_adventure_family_bindings b on b.adventure_family_id=h.adventure_family_id and b.world=l.world and b.source_family_id=new.family_id where l.world=v_world and l.source_learner_id=new.learner_id limit 1;
 if v_hero is null then return new;end if;
 perform public.learning_adventure_wallet(v_family,v_hero,false);
 if(select count(*) from public.learning_adventure_coin_ledger where hero_id=v_hero and world=v_world and day=v_day and kind='qualified_round')>=3 then return new;end if;
 insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,world,day,source_attempt_id) values(v_hero,v_family,'round:'||v_world||':'||new.id,'qualified_round',5,v_world,v_day,new.id) on conflict(hero_id,event_key) do nothing returning id into v_id;
 if v_id is not null then update public.learning_adventure_wallets set balance=balance+5,updated_at=clock_timestamp() where hero_id=v_hero;end if;return new;
end $fn$;
create trigger learning_adventure_chengyu_round_coin after insert on public.chengyu_family_attempts for each row execute function public.learning_adventure_award_round();
create trigger learning_adventure_vocab_round_coin after insert on public.vocab_family_attempts for each row execute function public.learning_adventure_award_round();
create or replace function public.learning_adventure_complete_daily_review(p_family uuid,p_hero uuid,p_review uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare r public.learning_adventure_daily_reviews;v_id uuid;v_wrong jsonb;v_day date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;begin
 if not exists(select 1 from public.learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family scope mismatch' using errcode='42501';end if;
 perform public.learning_adventure_wallet(p_family,p_hero,false);
 select * into r from public.learning_adventure_daily_reviews where id=p_review and hero_id=p_hero and adventure_family_id=p_family for update;
 if not found or r.day<>v_day then return jsonb_build_object('ok',false,'error','複習已過期，請重新開啟今日任務');end if;
 if r.completed_at is not null then return jsonb_build_object('ok',true,'duplicate',true,'awarded',false);end if;
 if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>jsonb_array_length(r.questions) then return jsonb_build_object('ok',false,'error','請完成全部複習題目');end if;
 select coalesce(jsonb_agg(i-1),'[]'::jsonb) into v_wrong from jsonb_array_elements(r.questions) with ordinality as q(item,i) where case when item->>'kind'='vocab-spelling' then not exists(select 1 from jsonb_array_elements_text(coalesce(item->'acceptedTexts',jsonb_build_array(item->>'answerText'))) a(v) where a.v=lower(regexp_replace(btrim(p_answers->>(i::int-1)),'\s+',' ','g'))) else p_answers->(i::int-1) is distinct from item->'answerIndex' end;
 if jsonb_array_length(v_wrong)>0 then return jsonb_build_object('ok',true,'completed',false,'incorrect',v_wrong);end if;
 insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,world,day,source_attempt_id) values(p_hero,p_family,'daily:'||r.world||':'||v_day,'daily_task',3,r.world,v_day,r.source_attempt_id) on conflict(hero_id,event_key) do nothing returning id into v_id;
 if v_id is not null then update public.learning_adventure_wallets set balance=balance+3,updated_at=clock_timestamp() where hero_id=p_hero;end if;
 update public.learning_adventure_daily_reviews set completed_at=clock_timestamp() where id=p_review;
 return jsonb_build_object('ok',true,'completed',true,'awarded',v_id is not null,'amount',case when v_id is null then 0 else 3 end);
end $fn$;
revoke all on function public.learning_adventure_award_round(),public.learning_adventure_complete_daily_review(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.learning_adventure_complete_daily_review(uuid,uuid,uuid,jsonb) to service_role;
commit;
