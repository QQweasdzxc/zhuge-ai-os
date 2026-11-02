-- Account-private office roster. No seed data, no public roster, no audit payloads.
begin;
create table public.office_member_roster (
  owner uuid primary key references auth.users(id) on delete cascade,
  names text[] not null default '{}',
  updated_at timestamptz not null default clock_timestamp(),
  constraint office_member_roster_limit check (cardinality(names) <= 24),
  constraint office_member_roster_no_null check (array_position(names, null) is null),
  constraint office_member_roster_one_dimension check (cardinality(names) = 0 or array_ndims(names) = 1)
);
alter table public.office_member_roster enable row level security;
alter table public.office_member_roster force row level security;
revoke all on public.office_member_roster from public, anon, authenticated;
grant select, insert, update, delete on public.office_member_roster to authenticated;
create policy office_member_roster_select on public.office_member_roster
  for select to authenticated using ((select auth.uid()) = owner);
create policy office_member_roster_insert on public.office_member_roster
  for insert to authenticated with check ((select auth.uid()) = owner);
create policy office_member_roster_update on public.office_member_roster
  for update to authenticated using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);
create policy office_member_roster_delete on public.office_member_roster
  for delete to authenticated using ((select auth.uid()) = owner);
-- Server-managed timestamp is also the optimistic concurrency revision.
create function public.office_member_roster_touch() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.office_member_roster_touch() from public, anon, authenticated;
create trigger office_member_roster_touch before insert or update on public.office_member_roster
  for each row execute function public.office_member_roster_touch();
commit;
