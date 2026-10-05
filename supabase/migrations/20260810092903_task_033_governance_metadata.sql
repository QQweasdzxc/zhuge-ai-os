-- TASK-033: minimum governance metadata and controlled QJC governance action.
--
-- This migration deliberately reuses the existing board_tasks table and
-- engineering_activity_log audit stream.  Co/GPT may detect and recommend;
-- only an authenticated engineering owner (QJC) can commit a governance
-- decision through board_governance_action().  No browser DML or service-role
-- secret is introduced.

alter table public.board_tasks
  add column if not exists resolution_action text,
  add column if not exists merged_into uuid,
  add column if not exists linked_to uuid,
  add column if not exists resolution_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_resolution_action_check'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_resolution_action_check
      check (resolution_action is null or resolution_action in ('merged', 'cancelled', 'linked', 'ignored'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_merged_into_fkey'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_merged_into_fkey
      foreign key (merged_into) references public.board_tasks(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_linked_to_fkey'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_linked_to_fkey
      foreign key (linked_to) references public.board_tasks(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_resolution_target_check'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_resolution_target_check
      check (
        (resolution_action is null and merged_into is null and linked_to is null)
        or (resolution_action = 'merged' and merged_into is not null and linked_to is null)
        or (resolution_action = 'linked' and linked_to is not null and merged_into is null)
        or (resolution_action in ('cancelled', 'ignored') and merged_into is null and linked_to is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_resolution_reason_check'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_resolution_reason_check
      check (resolution_action is null or length(btrim(coalesce(resolution_reason, ''))) >= 3);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'board_tasks_resolved_by_fkey'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_resolved_by_fkey
      foreign key (resolved_by) references auth.users(id) on delete restrict;
  end if;
end;
$$;

create index if not exists board_tasks_resolution_action_idx
  on public.board_tasks (resolution_action);
create index if not exists board_tasks_merged_into_idx
  on public.board_tasks (merged_into);
create index if not exists board_tasks_linked_to_idx
  on public.board_tasks (linked_to);

create or replace function public.board_governance_action(
  p_task_id uuid,
  p_action text,
  p_target_task_id uuid default null,
  p_reason text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public
as $function$
declare
  current_row public.board_tasks%rowtype;
  target_row public.board_tasks%rowtype;
  action_value text := lower(trim(coalesce(p_action, '')));
  reason_value text := btrim(coalesce(p_reason, ''));
  next_status text;
  result_row public.board_tasks%rowtype;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;

  if action_value not in ('merged', 'cancelled', 'linked', 'ignored') then
    raise exception using errcode = '22023', message = 'Unsupported governance action';
  end if;
  if length(reason_value) < 3 then
    raise exception using errcode = '22023', message = 'Governance reason is required';
  end if;
  if p_task_id is null then
    raise exception using errcode = '22023', message = 'Task id is required';
  end if;

  select * into current_row
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if current_row.resolution_action is not null
     or current_row.status in ('merged', 'cancelled') then
    raise exception using errcode = '42501', message = 'This task already has a terminal governance decision';
  end if;

  if action_value in ('merged', 'linked') then
    if p_target_task_id is null or p_target_task_id = p_task_id then
      raise exception using errcode = '22023', message = 'A different target task is required';
    end if;
    select * into target_row
    from public.board_tasks
    where id = p_target_task_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'Target task not found';
    end if;
  elsif p_target_task_id is not null then
    raise exception using errcode = '22023', message = 'This governance action does not accept a target task';
  end if;

  next_status := case
    when action_value = 'merged' then 'merged'
    when action_value = 'cancelled' then 'cancelled'
    else current_row.status
  end;

  update public.board_tasks
  set resolution_action = action_value,
      merged_into = case when action_value = 'merged' then p_target_task_id else null end,
      linked_to = case when action_value = 'linked' then p_target_task_id else null end,
      resolution_reason = reason_value,
      resolved_at = now(),
      resolved_by = auth.uid(),
      status = next_status,
      updated_at = now()
  where id = p_task_id
  returning * into result_row;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'board_task', p_task_id::text, 'governance_action',
    jsonb_build_object(
      'status', current_row.status,
      'assignee', current_row.assignee,
      'resolution_action', current_row.resolution_action,
      'merged_into', current_row.merged_into,
      'linked_to', current_row.linked_to,
      'resolution_reason', current_row.resolution_reason,
      'resolved_at', current_row.resolved_at,
      'resolved_by', current_row.resolved_by
    ),
    jsonb_build_object(
      'status', result_row.status,
      'assignee', result_row.assignee,
      'resolution_action', result_row.resolution_action,
      'merged_into', result_row.merged_into,
      'linked_to', result_row.linked_to,
      'resolution_reason', result_row.resolution_reason,
      'resolved_at', result_row.resolved_at,
      'resolved_by', result_row.resolved_by
    ),
    'QJC governance decision: ' || action_value || ' — ' || reason_value,
    auth.uid(), 'human', 'QJC'
  );

  return result_row;
end;
$function$;

revoke all on function public.board_governance_action(uuid, text, uuid, text) from public;
revoke execute on function public.board_governance_action(uuid, text, uuid, text) from anon;
grant execute on function public.board_governance_action(uuid, text, uuid, text) to authenticated;

comment on column public.board_tasks.resolution_action is 'TASK governance action: merged, cancelled, linked, or ignored.';
comment on column public.board_tasks.merged_into is 'Target TASK for a merged governance decision.';
comment on column public.board_tasks.linked_to is 'Target TASK for a linked governance decision.';
comment on column public.board_tasks.resolution_reason is 'Human-readable QJC governance decision reason.';
comment on column public.board_tasks.resolved_at is 'Timestamp of the governance decision.';
comment on column public.board_tasks.resolved_by is 'Authenticated human decision maker; actor details also remain in engineering_activity_log.';
