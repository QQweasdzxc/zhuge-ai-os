begin;
-- Read-only totals. Only the verified Edge family resolver may supply p_family.
create or replace function public.learning_adventure_leaderboard(p_family uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('name',h.display_name,'chengyuXP',coalesce(x.cy,0),'vocabXP',coalesce(x.vo,0),'earnedCoins',coalesce(c.earned,0)) order by h.created_at,h.id),'[]'::jsonb)
 from public.learning_adventure_heroes h
 left join lateral (
  select sum(amount) filter(where world='chengyu') as cy,sum(amount) filter(where world='vocab') as vo
  from public.learning_adventure_xp_ledger where hero_id=h.id
 ) x on true
 left join lateral (
  select sum(amount) as earned from public.learning_adventure_coin_ledger
  where hero_id=h.id and adventure_family_id=p_family
  and kind in ('daily_login','qualified_round','daily_task') and amount>0
 ) c on true
 where h.adventure_family_id=p_family;
$fn$;
revoke all on function public.learning_adventure_leaderboard(uuid) from public,anon,authenticated;
grant execute on function public.learning_adventure_leaderboard(uuid) to service_role;
comment on function public.learning_adventure_leaderboard(uuid) is 'Family-only cumulative island XP and earned coins. Refunds and redemption spending never change earned coins. Read only.';
commit;
