-- Read-only structural checks. Never select private names or prefs into operator output.
do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.office_member_roster'::regclass
    and attname = 'prefs' and not attisdropped) then raise exception 'prefs column missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.office_member_roster'::regclass
    and conname = 'office_member_roster_prefs_object') then raise exception 'prefs constraint missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='office_member_roster') <> 4
    then raise exception 'Unexpected roster policies'; end if;
  if has_table_privilege('anon','public.office_member_roster','SELECT')
    then raise exception 'Anonymous roster access granted'; end if;
end $$;
select column_name, data_type, column_default from information_schema.columns
where table_schema='public' and table_name='office_member_roster' and column_name='prefs';
