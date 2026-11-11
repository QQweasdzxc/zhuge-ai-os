-- Both islands stage stars: post-release evidence only. No coins, XP, old clears or reward amounts changed.
begin;
create table if not exists public.learning_adventure_star_release(singleton boolean primary key default true check(singleton),starts_at timestamptz not null default clock_timestamp());
insert into public.learning_adventure_star_release(singleton) values(true) on conflict do nothing;
alter table public.learning_adventure_star_release enable row level security;
revoke all on public.learning_adventure_star_release from public,anon,authenticated;
grant select on public.learning_adventure_star_release to service_role;
alter table public.vocab_family_attempts add column if not exists village_stage smallint check(village_stage between 1 and 7);
create or replace function public.learning_adventure_stage_stars(p_family uuid,p_hero uuid,p_world text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare result jsonb; total int;
begin
 if p_world not in ('chengyu','vocab') then raise exception 'invalid world';end if;
 if not exists(select 1 from learning_adventure_heroes where id=p_hero and adventure_family_id=p_family) then raise exception 'family scope mismatch' using errcode='42501';end if;
 with runs as (
 select a.zone,a.created_at,a.result_status,a.question_count,a.correct_count,a.answers from chengyu_family_attempts a
 join learning_adventure_hero_links l on l.world='chengyu' and l.source_learner_id=a.learner_id and l.hero_id=p_hero
 join learning_adventure_family_bindings b on b.world='chengyu' and b.source_family_id=a.family_id and b.adventure_family_id=p_family
 where p_world='chengyu' and a.created_at >= (select starts_at from learning_adventure_star_release where singleton) and a.zone between 1 and 7
 union all
 select a.village_stage,a.created_at,a.result_status,a.question_count,a.correct_count,a.answers from vocab_family_attempts a
 join learning_adventure_hero_links l on l.world='vocab' and l.source_learner_id=a.learner_id and l.hero_id=p_hero
 join learning_adventure_family_bindings b on b.world='vocab' and b.source_family_id=a.family_id and b.adventure_family_id=p_family
 where p_world='vocab' and a.created_at >= (select starts_at from learning_adventure_star_release where singleton) and a.village_stage between 1 and 7
 ), pass as (
 select zone,count(distinct (created_at at time zone 'Asia/Taipei')::date) days
 from runs where result_status='completed' and question_count>=5 and correct_count::bigint*100>=question_count::bigint*80 group by zone
 ), angles as (
 select zone,answer->>'word' word,count(distinct answer->>'kind') kinds
 from runs cross join lateral jsonb_array_elements(answers) answer
 where answer->'correct'='true'::jsonb and length(btrim(answer->>'word'))>0
 and answer->>'kind' in ('meaning','context','reverse','sound','shape','radical','usage','spelling','sentence','zh2en','ipa')
 group by zone,answer->>'word'
 ), diversity as (select zone,count(*) words from angles where kinds>=2 group by zone), stages as (
 select z zone,coalesce(p.days,0)>0 first_star,coalesce(d.words,0)>=3 second_star,coalesce(p.days,0)>=2 another_day,
 case when coalesce(p.days,0)=0 then 0 when coalesce(d.words,0)<3 then 1 when coalesce(p.days,0)<2 then 2 else 3 end stars,
 coalesce(p.days,0) pass_days,least(coalesce(d.words,0),3) diverse_words
 from generate_series(1,7) z left join pass p on p.zone=z left join diversity d on d.zone=z
 ) select jsonb_agg(to_jsonb(stages) order by zone),sum(stars) into result,total from stages;
 return jsonb_build_object('ok',true,'world',p_world,'stages',result,'total',total,'maximum',21,'villageExamUnlocked',total=21,'startsAt',(select starts_at from learning_adventure_star_release where singleton));
end $fn$;
revoke all on function public.learning_adventure_stage_stars(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.learning_adventure_stage_stars(uuid,uuid,text) to service_role;
create table if not exists public.learning_adventure_village_exams(
 id uuid primary key default gen_random_uuid(),hero_id uuid not null references learning_adventure_heroes(id),world text not null check(world in ('chengyu','vocab')),
 questions jsonb not null,answers jsonb,correct_count int,passed boolean,started_at timestamptz not null default clock_timestamp(),completed_at timestamptz);
create unique index if not exists learning_adventure_village_active on learning_adventure_village_exams(hero_id,world) where completed_at is null;
alter table public.learning_adventure_village_exams enable row level security;
revoke all on public.learning_adventure_village_exams from public,anon,authenticated;
grant all on public.learning_adventure_village_exams to service_role;
alter table public.chengyu_family_attempts drop constraint if exists chengyu_family_attempts_zone_check;
alter table public.chengyu_family_attempts add constraint chengyu_family_attempts_zone_check check(zone between 1 and 8);
create table if not exists public.learning_adventure_stage_exams(
 id uuid primary key default gen_random_uuid(),hero_id uuid not null references learning_adventure_heroes(id),world text not null check(world in ('chengyu','vocab')),stage smallint not null check(stage between 1 and 7),
 unit_id uuid,questions jsonb not null,answers jsonb,correct_count int,passed boolean,started_at timestamptz not null default clock_timestamp(),completed_at timestamptz);
create unique index if not exists learning_adventure_stage_active on learning_adventure_stage_exams(hero_id,world,stage) where completed_at is null;
alter table public.learning_adventure_stage_exams enable row level security;
revoke all on public.learning_adventure_stage_exams from public,anon,authenticated;
grant all on public.learning_adventure_stage_exams to service_role;
commit;
