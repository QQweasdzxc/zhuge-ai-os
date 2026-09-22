-- AI Board Human Progress Note canonical path.
--
-- Reuses engineering_activity_log as the single append-only activity stream.
-- Human notes are explicitly typed; they are not inferred from the generic
-- System Activity action or note fields.

begin;

alter table public.engineering_activity_log
  add column if not exists activity_type text;

update public.engineering_activity_log
set activity_type = 'system_activity'
where activity_type is null;

alter table public.engineering_activity_log
  alter column activity_type set default 'system_activity',
  alter column activity_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'engineering_activity_log_activity_type_check'
      and conrelid = 'public.engineering_activity_log'::regclass
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_activity_type_check
      check (activity_type in ('system_activity', 'human_progress_note'));
  end if;
end
$$;

comment on column public.engineering_activity_log.activity_type is
  'Canonical timeline semantic: system_activity or human_progress_note.';

-- The live project had an engineering_activity_insert policy that allowed
-- direct authenticated INSERT. Remove that drift and keep all writes behind
-- controlled functions.
drop policy if exists engineering_activity_insert on public.engineering_activity_log;
revoke all on public.engineering_activity_log from anon;
revoke insert, update, delete on public.engineering_activity_log from authenticated;
grant select on public.engineering_activity_log to authenticated;

create or replace function public.board_add_task_progress_note(
  p_task_id uuid,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  note_value text := btrim(coalesce(p_note, ''));
  result_row public.engineering_activity_log;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;

  if p_task_id is null then
    raise exception using errcode = '22023', message = 'Task id is required';
  end if;

  if length(note_value) = 0 then
    raise exception using errcode = '22023', message = 'Progress note is required';
  end if;

  if not exists (
    select 1
    from public.board_tasks
    where id = p_task_id
  ) then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type
  ) values (
    'board_task',
    p_task_id::text,
    'progress_note_created',
    note_value,
    auth.uid(),
    'human',
    'QJC',
    'human_progress_note'
  )
  returning * into result_row;

  return result_row;
end;
$function$;

revoke all on function public.board_add_task_progress_note(uuid, text) from public;
revoke execute on function public.board_add_task_progress_note(uuid, text) from anon;
grant execute on function public.board_add_task_progress_note(uuid, text) to authenticated;

-- The activity log is already a Realtime source; keep this migration
-- idempotent when applied to a project where the publication is present.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'engineering_activity_log'
  ) then
    alter publication supabase_realtime add table public.engineering_activity_log;
  end if;
end
$$;

commit;
