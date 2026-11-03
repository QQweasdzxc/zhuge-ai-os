-- Read-only structural checks. Never select private names into operator output.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.office_member_roster'::regclass
    and relrowsecurity and relforcerowsecurity) then raise exception 'Roster RLS missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='office_member_roster') <> 4
    then raise exception 'Unexpected roster policies'; end if;
  if has_table_privilege('anon','public.office_member_roster','SELECT')
    or has_table_privilege('anon','public.office_member_roster','INSERT')
    or has_table_privilege('anon','public.office_member_roster','UPDATE')
    or has_table_privilege('anon','public.office_member_roster','DELETE')
    then raise exception 'Anonymous roster access granted'; end if;
  if not has_table_privilege('authenticated','public.office_member_roster','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Authenticated roster grants missing'; end if;
end $$;
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='office_member_roster' order by policyname;
