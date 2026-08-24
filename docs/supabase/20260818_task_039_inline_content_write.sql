-- TASK-039 / General TASK content inline edit.
--
-- This is a product-content write path, not a Governance approval path.
-- Only the authenticated engineering owner may change the two explicitly
-- allowlisted human-readable fields.  Direct board_tasks UPDATE remains
-- revoked; the existing Canonical board_tasks row and activity audit stream
-- remain the sources of truth.

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

revoke insert, update, delete on public.board_tasks from authenticated;
revoke insert, update, delete on public.engineering_activity_log from authenticated;
grant select on public.board_tasks to authenticated;
grant select on public.engineering_activity_log to authenticated;

create or replace function public.board_update_task_content(
  p_task_id uuid,
  p_summary text default null,
  p_usage_scenario text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_task public.board_tasks;
  saved_task public.board_tasks;
  summary_value text := nullif(btrim(coalesce(p_summary, '')), '');
  usage_scenario_value text := nullif(btrim(coalesce(p_usage_scenario, '')), '');
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  if p_task_id is null then
    raise exception using errcode = '22023', message = 'Task id is required';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  update public.board_tasks
  set summary = summary_value,
      usage_scenario = usage_scenario_value,
      updated_at = now()
  where id = p_task_id
  returning * into saved_task;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type
  ) values (
    'board_task',
    p_task_id::text,
    'task_content_updated',
    jsonb_build_object(
      'summary', current_task.summary,
      'usage_scenario', current_task.usage_scenario
    ),
    jsonb_build_object(
      'summary', saved_task.summary,
      'usage_scenario', saved_task.usage_scenario
    ),
    'General TASK content updated through the authenticated controlled path',
    auth.uid(),
    'human',
    'QJC',
    'system_activity'
  );

  return saved_task;
end;
$function$;

revoke all on function public.board_update_task_content(uuid, text, text) from public;
revoke execute on function public.board_update_task_content(uuid, text, text) from anon;
grant execute on function public.board_update_task_content(uuid, text, text) to authenticated;

comment on function public.board_update_task_content(uuid, text, text) is
  'Authenticated owner-only update for general TASK content fields; direct DML and PM Governance approval are not used.';

notify pgrst, 'reload schema';

commit;
