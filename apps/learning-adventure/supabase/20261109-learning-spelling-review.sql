begin;
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
commit;
