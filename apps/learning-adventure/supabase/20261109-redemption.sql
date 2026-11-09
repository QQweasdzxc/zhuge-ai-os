begin;
create table if not exists public.learning_adventure_redemptions (
 id uuid primary key default gen_random_uuid(), adventure_family_id uuid not null references public.learning_adventure_families(id),
 hero_id uuid not null references public.learning_adventure_wallets(hero_id), reward_id uuid not null references public.learning_adventure_rewards(id),
 client_request_id uuid not null, title text not null, price integer not null check(price>0),
 status text not null default 'pending' check(status in ('pending','fulfilled','rejected')),
 created_at timestamptz not null default now(), decided_at timestamptz,
 unique(hero_id,client_request_id)
);
alter table public.learning_adventure_redemptions enable row level security;
revoke all on public.learning_adventure_redemptions from public,anon,authenticated;
grant all on public.learning_adventure_redemptions to service_role;
create or replace function public.learning_adventure_redeem(p_family uuid,p_hero uuid,p_reward uuid,p_expected_price integer,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare w public.learning_adventure_wallets; r public.learning_adventure_rewards; old public.learning_adventure_redemptions; v_id uuid; v_day date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if not exists(select 1 from public.learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family/hero mismatch' using errcode='42501'; end if;
 select * into w from public.learning_adventure_wallets where hero_id=p_hero and adventure_family_id=p_family for update;
 if not found then return jsonb_build_object('ok',false,'error','請先開啟金幣帳本'); end if;
 select * into old from public.learning_adventure_redemptions where hero_id=p_hero and client_request_id=p_request;
 if found then
  if old.reward_id<>p_reward then return jsonb_build_object('ok',false,'error','兌換識別碼已被使用'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'redemption',to_jsonb(old));
 end if;
 if not exists(select 1 from public.learning_adventure_parent_credentials where adventure_family_id=p_family) then return jsonb_build_object('ok',false,'error','家長驗證尚未設定'); end if;
 select * into r from public.learning_adventure_rewards where id=p_reward and adventure_family_id=p_family for share;
 if not found or not r.available or r.proposed then return jsonb_build_object('ok',false,'error','這項獎勵暫時不能兌換'); end if;
 if p_expected_price is distinct from r.price then return jsonb_build_object('ok',false,'error','價格已調整，請重新確認'); end if;
 if w.balance<r.price then return jsonb_build_object('ok',false,'error','金幣還不夠'); end if;
 insert into public.learning_adventure_redemptions(adventure_family_id,hero_id,reward_id,client_request_id,title,price) values(p_family,p_hero,p_reward,p_request,r.title,r.price) returning id into v_id;
 insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,day) values(p_hero,p_family,'redeem:'||v_id,'redemption',-r.price,v_day);
 update public.learning_adventure_wallets set balance=balance-r.price,updated_at=statement_timestamp() where hero_id=p_hero;
 return jsonb_build_object('ok',true,'duplicate',false,'redemptionId',v_id);
end $fn$;

create or replace function public.learning_adventure_decide_redemption(p_family uuid,p_parent_session text,p_redemption uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_hero uuid; r public.learning_adventure_redemptions; v_day date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if not public.learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501'; end if;
 if p_decision not in ('fulfilled','rejected') or p_decision is null then return jsonb_build_object('ok',false,'error','兌換結果不正確'); end if;
 select hero_id into v_hero from public.learning_adventure_redemptions where id=p_redemption and adventure_family_id=p_family;
 if v_hero is null then raise exception 'redemption scope mismatch' using errcode='42501'; end if;
 perform 1 from public.learning_adventure_wallets where hero_id=v_hero and adventure_family_id=p_family for update;
 select * into r from public.learning_adventure_redemptions where id=p_redemption and adventure_family_id=p_family for update;
 if r.status<>'pending' then return jsonb_build_object('ok',true,'duplicate',true,'status',r.status); end if;
 if p_decision='rejected' then
  insert into public.learning_adventure_coin_ledger(hero_id,adventure_family_id,event_key,kind,amount,day) values(v_hero,p_family,'refund:'||r.id,'refund',r.price,v_day);
  update public.learning_adventure_wallets set balance=balance+r.price,updated_at=statement_timestamp() where hero_id=v_hero;
 end if;
 update public.learning_adventure_redemptions set status=p_decision,decided_at=statement_timestamp() where id=r.id;
 return jsonb_build_object('ok',true,'duplicate',false,'status',p_decision);
end $fn$;

revoke all on function public.learning_adventure_redeem(uuid,uuid,uuid,integer,uuid),public.learning_adventure_decide_redemption(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.learning_adventure_redeem(uuid,uuid,uuid,integer,uuid),public.learning_adventure_decide_redemption(uuid,text,uuid,text) to service_role;
commit;
