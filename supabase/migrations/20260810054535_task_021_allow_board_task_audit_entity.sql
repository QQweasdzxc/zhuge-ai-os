-- TASK-021 minimal consistency fix: align the existing audit constraint with board_transition_task().
alter table public.engineering_activity_log
drop constraint if exists engineering_activity_log_entity_type_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'engineering_activity_log'
      and c.conname = 'engineering_activity_log_entity_type_check'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_entity_type_check
      check (entity_type = any (array['knowledge','feature','work_item','qa','member','board_task']::text[]));
  end if;
end
$$;