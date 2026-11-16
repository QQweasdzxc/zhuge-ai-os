begin;
create or replace function public.learning_adventure_player_delete_state(p_family uuid,p_hero uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare h public.learning_adventure_heroes; l record; rows jsonb; all_rows jsonb:='{}'; counts jsonb:='{}'; worlds jsonb:='[]'; t text; n integer; pending integer; balance integer;
begin
 select * into h from learning_adventure_heroes where id=p_hero and adventure_family_id=p_family;
 if not found then raise exception 'player scope mismatch' using errcode='42501'; end if;
 all_rows:=jsonb_build_object('hero',to_jsonb(h));
 for l in select * from learning_adventure_hero_links where hero_id=p_hero order by world,source_learner_id loop
  if l.world not in ('chengyu','vocab') or not exists(select 1 from learning_adventure_family_bindings b where b.adventure_family_id=p_family and b.world=l.world and exists(select 1 from learning_adventure_hero_links hl where hl.hero_id=p_hero and hl.source_learner_id=l.source_learner_id)) then raise exception 'invalid player mapping'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(s) order by s.id),''[]'') from %I s where id=$1 and family_id in (select source_family_id from learning_adventure_family_bindings where world=$2 and adventure_family_id=$3)',l.world||'_family_learners') into rows using l.source_learner_id,l.world,p_family;
  if jsonb_array_length(rows)<>1 then raise exception 'invalid learner family mapping'; end if;
  worlds:=worlds||jsonb_build_array(jsonb_build_object('world',l.world,'id',l.source_learner_id,'name',rows->0->>'name'));
  all_rows:=all_rows||jsonb_build_object(l.world||':'||l.source_learner_id,rows);
  foreach t in array case when l.world='chengyu' then array['chengyu_family_attempts','chengyu_family_challenge_attempts'] else array['vocab_family_attempts'] end loop
   execute format('select coalesce(jsonb_agg(to_jsonb(s) order by s.id),''[]'') from %I s where learner_id=$1',t) into rows using l.source_learner_id;
   all_rows:=all_rows||jsonb_build_object(t||':'||l.source_learner_id,rows); counts:=counts||jsonb_build_object(t,coalesce((counts->>t)::integer,0)+jsonb_array_length(rows));
  end loop;
 end loop;
 foreach t in array array['learning_adventure_coin_ledger','learning_adventure_collections','learning_adventure_daily_plans','learning_adventure_daily_reviews','learning_adventure_hero_links','learning_adventure_parent_grants','learning_adventure_promotion_exams','learning_adventure_redemptions','learning_adventure_stage_exams','learning_adventure_village_exams','learning_adventure_wallets','learning_adventure_xp_ledger'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),''[]'') from %I s where hero_id=$1',t) into rows using p_hero;
 all_rows:=all_rows||jsonb_build_object(t,rows); counts:=counts||jsonb_build_object(t,jsonb_array_length(rows));
 end loop;
 select count(*) into pending from learning_adventure_redemptions where hero_id=p_hero and status='pending';
 select coalesce(w.balance,0) into balance from learning_adventure_wallets w where hero_id=p_hero;
 return jsonb_build_object('heroId',h.id,'name',h.display_name,'totalXP',h.total_xp,'balance',coalesce(balance,0),'pending',pending,'worlds',worlds,'counts',counts,'snapshot',md5(all_rows::text));
end $fn$;
create or replace function public.learning_adventure_parent_players(p_family uuid,p_parent_session text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
 if not learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'players',coalesce((select jsonb_agg(learning_adventure_player_delete_state(p_family,h.id) order by h.created_at,h.id) from learning_adventure_heroes h where adventure_family_id=p_family),'[]'));
end $fn$;
create or replace function public.learning_adventure_delete_player(p_family uuid,p_parent_session text,p_active_hero uuid,p_hero uuid,p_name text,p_snapshot text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare state jsonb; l record;
begin
 if not learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501'; end if;
 if not exists(select 1 from learning_adventure_heroes where id=p_active_hero and adventure_family_id=p_family) then raise exception 'active player scope mismatch' using errcode='42501'; end if;
 if p_hero=p_active_hero then return jsonb_build_object('ok',false,'error','不能刪除目前使用的玩家，請先切換另一位玩家。'); end if;
 lock table public.chengyu_family_attempts,public.chengyu_family_challenge_attempts,public.chengyu_family_learners,public.learning_adventure_coin_ledger,public.learning_adventure_collections,public.learning_adventure_daily_plans,public.learning_adventure_daily_reviews,public.learning_adventure_family_bindings,public.learning_adventure_hero_links,public.learning_adventure_heroes,public.learning_adventure_parent_grants,public.learning_adventure_promotion_exams,public.learning_adventure_redemptions,public.learning_adventure_stage_exams,public.learning_adventure_village_exams,public.learning_adventure_wallets,public.learning_adventure_xp_ledger,public.vocab_family_attempts,public.vocab_family_learners in share row exclusive mode nowait;
 if (select count(*) from learning_adventure_heroes where adventure_family_id=p_family)<=1 then return jsonb_build_object('ok',false,'error','請保留至少一位玩家，避免失去家長管理入口。'); end if;
 state:=learning_adventure_player_delete_state(p_family,p_hero);
 if p_name is distinct from state->>'name' then return jsonb_build_object('ok',false,'error','玩家姓名不符，尚未刪除。'); end if;
 if p_snapshot is distinct from state->>'snapshot' then return jsonb_build_object('ok',false,'error','這位玩家的紀錄已改變，請重新讀取並確認。'); end if;
 if (state->>'pending')::integer>0 then return jsonb_build_object('ok',false,'error','還有待確認兌換，請先完成或取消兌換再刪除。'); end if;
 for l in select * from learning_adventure_hero_links where hero_id=p_hero loop
  if l.world='chengyu' then
   delete from chengyu_family_attempts where learner_id=l.source_learner_id;
   delete from chengyu_family_challenge_attempts where learner_id=l.source_learner_id;
   delete from chengyu_family_learners where id=l.source_learner_id;
  elsif l.world='vocab' then
   delete from vocab_family_attempts where learner_id=l.source_learner_id;
   delete from vocab_family_learners where id=l.source_learner_id;
  end if;
 end loop;
 delete from learning_adventure_redemptions where hero_id=p_hero;
 delete from learning_adventure_parent_grants where hero_id=p_hero;
 delete from learning_adventure_coin_ledger where hero_id=p_hero;
 delete from learning_adventure_collections where hero_id=p_hero;
 delete from learning_adventure_daily_plans where hero_id=p_hero;
 delete from learning_adventure_daily_reviews where hero_id=p_hero;
 delete from learning_adventure_hero_links where hero_id=p_hero;
 delete from learning_adventure_promotion_exams where hero_id=p_hero;
 delete from learning_adventure_stage_exams where hero_id=p_hero;
 delete from learning_adventure_village_exams where hero_id=p_hero;
 delete from learning_adventure_xp_ledger where hero_id=p_hero;
 delete from learning_adventure_wallets where hero_id=p_hero;
 delete from learning_adventure_heroes where id=p_hero and adventure_family_id=p_family;
 return jsonb_build_object('ok',true,'deletedHeroId',p_hero,'deletedName',state->>'name');
exception when lock_not_available then return jsonb_build_object('ok',false,'error','目前有學習紀錄正在儲存，尚未刪除，請稍後重新確認。');
end $fn$;
revoke all on function learning_adventure_player_delete_state(uuid,uuid),learning_adventure_parent_players(uuid,text),learning_adventure_delete_player(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function learning_adventure_player_delete_state(uuid,uuid),learning_adventure_parent_players(uuid,text),learning_adventure_delete_player(uuid,text,uuid,uuid,text,text) to service_role;
commit;
