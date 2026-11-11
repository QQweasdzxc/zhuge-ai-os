-- Collections (收藏): a child can bookmark an idiom or an English word; collected items join the shared
-- priority pool of the promotion exam. Additive only. No coin, star or pass-rule change.
begin;
create table if not exists public.learning_adventure_collections (
 hero_id uuid not null references public.learning_adventure_heroes(id),
 adventure_family_id uuid not null references public.learning_adventure_families(id),
 world text not null check (world in ('chengyu','vocab')),
 item_key text not null check (length(item_key) between 1 and 60),
 label text not null check (length(label) between 1 and 60),
 created_at timestamptz not null default now(),
 primary key (hero_id, world, item_key)
);
create index if not exists learning_adventure_collections_family on public.learning_adventure_collections(adventure_family_id,hero_id);
alter table public.learning_adventure_collections enable row level security;
revoke all on public.learning_adventure_collections from public,anon,authenticated;
grant all on public.learning_adventure_collections to service_role;

create or replace function public.learning_adventure_collect(p_family uuid,p_hero uuid,p_world text,p_key text,p_label text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare n integer; added boolean:=false;
begin
 if p_world not in ('chengyu','vocab') then return jsonb_build_object('ok',false,'error','世界不正確'); end if;
 if not exists(select 1 from public.learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family/hero mismatch' using errcode='42501'; end if;
 if p_key is null or length(btrim(p_key)) not between 1 and 60 or p_label is null or length(btrim(p_label)) not between 1 and 60 then return jsonb_build_object('ok',false,'error','收藏內容不正確'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hero::text||':'||p_world,0));
 if not exists(select 1 from public.learning_adventure_collections where hero_id=p_hero and world=p_world and item_key=btrim(p_key)) then
  select count(*) into n from public.learning_adventure_collections where hero_id=p_hero and world=p_world;
  if n>=200 then return jsonb_build_object('ok',false,'error','收藏已滿 200 個，請先移除幾個'); end if;
  insert into public.learning_adventure_collections(hero_id,adventure_family_id,world,item_key,label) values(p_hero,p_family,p_world,btrim(p_key),btrim(p_label));
  added:=true;
 end if;
 select count(*) into n from public.learning_adventure_collections where hero_id=p_hero and world=p_world;
 return jsonb_build_object('ok',true,'added',added,'count',n);
end $fn$;
revoke all on function public.learning_adventure_collect(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.learning_adventure_collect(uuid,uuid,text,text,text) to service_role;
commit;
