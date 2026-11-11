begin;
create table if not exists public.learning_adventure_daily_plans(hero_id uuid not null references public.learning_adventure_heroes(id),world text not null check(world in ('chengyu','vocab')),day date not null,task text not null,preview_completed_at timestamptz,primary key(hero_id,world,day));
alter table public.learning_adventure_daily_plans enable row level security;
revoke all on public.learning_adventure_daily_plans from public,anon,authenticated;
grant all on public.learning_adventure_daily_plans to service_role;
create or replace function public.learning_adventure_daily_plan(p_family uuid,p_hero uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare d date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;h record;w text;keys text[];k text;v bigint;ch text;cp int;i int;off int;prev text;rank int:=0;seed int;begin
 if not exists(select 1 from learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family scope mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_family::text||':'||d::text,0));
 foreach w in array array['chengyu','vocab'] loop
 keys:=case w when 'vocab' then array['match','spell','fill','preview'] else array['mixed','meaning','context','reverse'] end;
 rank:=0;seed:=('x'||substr(md5(p_family::text||w||d::text),1,7))::bit(28)::int;
 for h in select hs.id,coalesce(case w when 'vocab' then v.name else c.name end,hs.display_name) display_name from learning_adventure_heroes hs left join learning_adventure_hero_links l on l.hero_id=hs.id and l.world=w left join vocab_family_learners v on w='vocab' and v.id=l.source_learner_id left join chengyu_family_learners c on w='chengyu' and c.id=l.source_learner_id where hs.adventure_family_id=p_family order by hs.created_at,hs.id loop
 if d<='2026-11-11' then
 prev:='';for off in reverse 14..0 loop
 v:=5381;for i in 1..length(w||'|'||h.display_name||'|'||(d-off)::text) loop ch:=substr(w||'|'||h.display_name||'|'||(d-off)::text,i,1);cp:=ascii(ch);if cp>65535 then v:=(v*33+55296+((cp-65536)/1024))%4294967296;v:=(v*33+56320+((cp-65536)%1024))%4294967296;else v:=(v*33+cp)%4294967296;end if;end loop;
 k:=keys[(v%4)::int+1];if k=prev then k:=keys[((v+1)%4)::int+1];end if;prev:=k;
 end loop;
 else k:=keys[((seed+rank)%4)+1];end if;
 insert into learning_adventure_daily_plans(hero_id,world,day,task) values(h.id,w,d,k) on conflict do nothing;
 rank:=rank+1;
 end loop;
 end loop;
 return (select jsonb_build_object('day',d,'tasks',jsonb_agg(jsonb_build_object('world',world,'task',task,'previewDone',preview_completed_at is not null))) from learning_adventure_daily_plans where hero_id=p_hero and day=d);
end $fn$;
revoke all on function public.learning_adventure_daily_plan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learning_adventure_daily_plan(uuid,uuid) to service_role;
commit;
