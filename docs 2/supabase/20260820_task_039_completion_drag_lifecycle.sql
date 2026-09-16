-- TASK-039 Final Closing: completion is a controlled workspace action.
--
-- This migration keeps the existing board_tasks completion timestamps and
-- engineering_activity_log audit model.  It removes the old PM Acceptance
-- gate from workspace movement only: moving a card into the canonical
-- 已完成 workspace records the completion window; moving it out cancels the
-- active archive_due_at.  No browser timer, second status model, or direct
-- table write is introduced.

begin;

create or replace function public.board_reconcile_completion_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  completion_workspace_id uuid;
  current_task public.board_tasks%rowtype;
  archived_task public.board_tasks%rowtype;
  archived_count integer := 0;
  archived_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select workspace.id
  into completion_workspace_id
  from public.board_workspaces workspace
  where workspace.active = true
    and (workspace.workspace_key = 'completed' or workspace.name = '已完成')
  order by (workspace.workspace_key = 'completed') desc, workspace.sort_order asc, workspace.created_at asc
  limit 1;

  if completion_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Canonical 已完成 workspace is missing';
  end if;

  for current_task in
    select task.*
    from public.board_tasks task
    where task.workspace_id = completion_workspace_id
      and task.completion_at is not null
      and task.archive_due_at is not null
      and task.archive_due_at <= now()
      and task.archived_at is null
    for update
  loop
    update public.board_tasks
    set archived_at = now(),
        archived_by = null,
        updated_at = now()
    where id = current_task.id
    returning * into archived_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', current_task.id::text, 'task_auto_archived',
      jsonb_build_object(
        'status', current_task.status,
        'workspace_id', current_task.workspace_id,
        'completion_at', current_task.completion_at,
        'archive_due_at', current_task.archive_due_at,
        'archived_at', current_task.archived_at
      ),
      jsonb_build_object(
        'status', archived_task.status,
        'workspace_id', archived_task.workspace_id,
        'completion_at', archived_task.completion_at,
        'archive_due_at', archived_task.archive_due_at,
        'archived_at', archived_task.archived_at,
        'lifecycle', 'completion_48h'
      ),
      'TASK automatically archived after the canonical 48-hour completion window',
      null, 'system', 'System', 'system_activity'
    );

    archived_count := archived_count + 1;
    archived_ids := array_append(archived_ids, current_task.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'archived_count', archived_count,
    'archived_task_ids', to_jsonb(archived_ids)
  );
end;
$function$;

revoke all on function public.board_reconcile_completion_lifecycle() from public;
revoke execute on function public.board_reconcile_completion_lifecycle() from anon;
grant execute on function public.board_reconcile_completion_lifecycle() to authenticated;

create or replace function public.board_move_task_workspace(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_note text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_task public.board_tasks;
  target_workspace public.board_workspaces;
  current_workspace public.board_workspaces;
  moved_task public.board_tasks;
  completion_workspace_id uuid;
  target_is_completion boolean := false;
  current_is_completion boolean := false;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_task_id is null or p_target_workspace_id is null then
    raise exception using errcode = '22023', message = 'Task id and target workspace are required';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if current_task.status in ('merged', 'cancelled') then
    raise exception using errcode = '42501', message = 'Terminal governance task cannot move workspace';
  end if;
  if current_task.archived_at is not null then
    raise exception using errcode = '42501', message = 'Archived TASK is read-only';
  end if;

  select * into target_workspace
  from public.board_workspaces
  where id = p_target_workspace_id and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active target workspace not found';
  end if;

  if current_task.workspace_id = target_workspace.id then
    return current_task;
  end if;

  select workspace.id
  into completion_workspace_id
  from public.board_workspaces workspace
  where workspace.active = true
    and (workspace.workspace_key = 'completed' or workspace.name = '已完成')
  order by (workspace.workspace_key = 'completed') desc, workspace.sort_order asc, workspace.created_at asc
  limit 1;

  if completion_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Canonical 已完成 workspace is missing';
  end if;

  target_is_completion := target_workspace.id = completion_workspace_id
    or target_workspace.workspace_key = 'completed'
    or target_workspace.name = '已完成';
  current_is_completion := current_task.workspace_id = completion_workspace_id;

  select * into current_workspace
  from public.board_workspaces
  where id = current_task.workspace_id;

  if target_is_completion then
    -- The PM action is the drag itself.  Store the same authenticated actor
    -- as the acceptance/completion actor and start a real Cloud 48-hour window.
    update public.board_tasks
    set workspace_id = target_workspace.id,
        accepted_at = now(),
        accepted_by = auth.uid(),
        completion_at = now(),
        completion_by = auth.uid(),
        archive_due_at = now() + interval '48 hours',
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = p_task_id
    returning * into moved_task;
  else
    -- Keep the last completion/acceptance timestamps as immutable row-level
    -- evidence, but remove the active due time.  Re-entering 已完成 writes a
    -- fresh completion timestamp and a fresh 48-hour window.
    update public.board_tasks
    set workspace_id = target_workspace.id,
        archive_due_at = null,
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = p_task_id
    returning * into moved_task;
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'workspace_moved',
    jsonb_build_object(
      'workspace_id', current_task.workspace_id,
      'workspace_name', current_workspace.name,
      'status', current_task.status,
      'assignee', current_task.assignee,
      'accepted_at', current_task.accepted_at,
      'completion_at', current_task.completion_at,
      'archive_due_at', current_task.archive_due_at,
      'archived_at', current_task.archived_at
    ),
    jsonb_build_object(
      'workspace_id', moved_task.workspace_id,
      'workspace_name', target_workspace.name,
      'status', moved_task.status,
      'assignee', moved_task.assignee,
      'accepted_at', moved_task.accepted_at,
      'completion_at', moved_task.completion_at,
      'archive_due_at', moved_task.archive_due_at,
      'archived_at', moved_task.archived_at,
      'completion_lifecycle', case
        when target_is_completion then 'started_48h_window'
        when current_is_completion then 'cancelled_48h_window'
        else 'none'
      end
    ),
    coalesce(note_value, case
      when target_is_completion then 'PM moved TASK to 已完成; canonical 48-hour completion lifecycle started'
      when current_is_completion then 'PM moved TASK out of 已完成; canonical 48-hour completion lifecycle cancelled'
      else 'AI Board workspace moved'
    end),
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return moved_task;
end;
$function$;

revoke all on function public.board_move_task_workspace(uuid, uuid, text) from public;
revoke execute on function public.board_move_task_workspace(uuid, uuid, text) from anon;
grant execute on function public.board_move_task_workspace(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
