-- Custom Workspace Delete Contract.
--
-- Scope: delete only custom AI Board / WorkTodo workspace classification rows.
-- Tasks are preserved: when a custom workspace has tasks, the shared runtime
-- moves them to the canonical 待開始 workspace before finalizing deletion.
-- This migration does not add Archive / Restore, a recycle bin, or another
-- workspace lifecycle, and it does not modify attachment or Storage policy.

begin;

-- Workspace deletion is a first-class audit event. Existing task and
-- checklist audit vocabulary remains unchanged.
alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type = any (array[
    'knowledge', 'feature', 'work_item', 'qa', 'member', 'board_task',
    'engineering_checklist_item', 'engineering_governance_authorization',
    'engineering_artifact', 'board_workspace'
  ]));

create or replace function public.zhuge_workspace_delete_manifest(
  p_workspace_id uuid,
  p_application_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_task_ids uuid[] := '{}'::uuid[];
  v_task_count integer := 0;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or p_application_scope not in ('ai_board', 'worktodo') then
    raise exception using errcode = '22023', message = 'Workspace id and application scope are required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id
    and application_scope = p_application_scope
    and active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active workspace not found';
  end if;

  if p_application_scope = 'ai_board' and v_workspace.workspace_key is not null then
    raise exception using errcode = '42501', message = 'System/Canonical AI Board workspaces are not deletable';
  end if;
  if p_application_scope = 'worktodo'
     and (v_workspace.workspace_key is null or v_workspace.workspace_key not like 'worktodo-custom-%') then
    raise exception using errcode = '42501', message = 'System/Canonical WorkTodo workspaces are not deletable';
  end if;

  select coalesce(array_agg(task.id order by task.created_at), '{}'::uuid[]), count(*)::integer
  into v_task_ids, v_task_count
  from public.board_tasks task
  where task.workspace_id = v_workspace.id
    and task.application_scope = p_application_scope;

  return jsonb_build_object(
    'workspace_id', v_workspace.id,
    'application_scope', p_application_scope,
    'workspace', to_jsonb(v_workspace),
    'task_count', v_task_count,
    'task_ids', to_jsonb(v_task_ids),
    'target_workspace_key', case when p_application_scope = 'worktodo' then 'worktodo-todo' else 'todo' end,
    'tasks_preserved', true
  );
end;
$function$;

create or replace function public.zhuge_finalize_workspace_delete(
  p_workspace_id uuid,
  p_application_scope text,
  p_target_workspace_id uuid,
  p_task_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_target_workspace public.board_workspaces;
  v_task_ids uuid[] := coalesce(p_task_ids, '{}'::uuid[]);
  v_source_task_count integer := 0;
  v_supplied_task_count integer := 0;
  v_target_task_count integer := 0;
  v_deleted_workspace public.board_workspaces;
  v_target_key text := case when p_application_scope = 'worktodo' then 'worktodo-todo' else 'todo' end;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or p_application_scope not in ('ai_board', 'worktodo') then
    raise exception using errcode = '22023', message = 'Workspace id and application scope are required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id
    and application_scope = p_application_scope
    and active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active workspace not found';
  end if;

  if p_application_scope = 'ai_board' and v_workspace.workspace_key is not null then
    raise exception using errcode = '42501', message = 'System/Canonical AI Board workspaces are not deletable';
  end if;
  if p_application_scope = 'worktodo'
     and (v_workspace.workspace_key is null or v_workspace.workspace_key not like 'worktodo-custom-%') then
    raise exception using errcode = '42501', message = 'System/Canonical WorkTodo workspaces are not deletable';
  end if;

  select count(*)::integer into v_source_task_count
  from public.board_tasks task
  where task.workspace_id = v_workspace.id
    and task.application_scope = p_application_scope;

  select count(distinct supplied.id)::integer into v_supplied_task_count
  from unnest(v_task_ids) as supplied(id);
  if v_supplied_task_count <> coalesce(array_length(v_task_ids, 1), 0) then
    raise exception using errcode = '40001', message = 'Workspace task manifest contains duplicate ids';
  end if;

  if v_source_task_count > 0 and p_target_workspace_id is null then
    raise exception using errcode = '40001', message = 'Tasks must be moved to the canonical 待開始 workspace before deletion';
  end if;

  if p_target_workspace_id is not null then
    if p_target_workspace_id = v_workspace.id then
      raise exception using errcode = '22023', message = 'Workspace delete target must differ from the source workspace';
    end if;
    select * into v_target_workspace
    from public.board_workspaces
    where id = p_target_workspace_id
      and application_scope = p_application_scope
      and workspace_key = v_target_key
      and active = true
    for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Canonical 待開始 workspace not found';
    end if;
  end if;

  if v_source_task_count > 0 then
    raise exception using errcode = '40001', message = 'Workspace tasks must be moved before deleting the workspace';
  end if;

  if v_supplied_task_count > 0 then
    select count(*)::integer into v_target_task_count
    from public.board_tasks task
    where task.id = any(v_task_ids)
      and task.workspace_id = v_target_workspace.id
      and task.application_scope = p_application_scope;
    if v_target_task_count <> v_supplied_task_count then
      raise exception using errcode = '40001', message = 'Workspace tasks were not moved to the canonical 待開始 workspace';
    end if;
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workspace', v_workspace.id::text, 'workspace_deleted',
    jsonb_build_object(
      'workspace', to_jsonb(v_workspace),
      'task_ids', to_jsonb(v_task_ids),
      'task_count', v_supplied_task_count,
      'target_workspace', to_jsonb(v_target_workspace),
      'tasks_preserved', true
    ),
    jsonb_build_object(
      'deleted', true,
      'application_scope', p_application_scope,
      'moved_task_count', v_supplied_task_count,
      'tasks_preserved', true
    ),
    'Custom workspace classification deleted through the controlled Workspace Delete Contract; task data preserved in 待開始',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  -- The source workspace is empty at this point. Task, Checklist, Progress,
  -- Attachment, and Storage rows are intentionally untouched.
  if p_application_scope = 'worktodo' then
    perform set_config('zhuge.worktodo_workspace_write', '1', true);
  end if;
  delete from public.board_workspaces
  where id = v_workspace.id
    and application_scope = p_application_scope
    and active = true
  returning * into v_deleted_workspace;
  if not found then
    raise exception using errcode = '40001', message = 'Workspace changed; workspace was not deleted';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'workspace_id', v_deleted_workspace.id,
    'application_scope', p_application_scope,
    'moved_task_count', v_supplied_task_count,
    'tasks_preserved', true
  );
end;
$function$;

create or replace function public.enforce_worktodo_workspace_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1'
       or old.workspace_key is null
       or old.workspace_key not like 'worktodo-custom-%' then
      raise exception using errcode = '42501', message = 'WorkTodo system workspaces are not deletable';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1' then
      raise exception using errcode = '42501', message = 'WorkTodo system workspaces require the controlled WorkTodo workspace path';
    end if;
    if new.application_scope is distinct from old.application_scope
       or new.workspace_key is distinct from old.workspace_key
       or new.owner_uuid is distinct from old.owner_uuid
       or new.active is distinct from old.active
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'WorkTodo workspace identity is immutable';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$function$;

create or replace function public.board_request_delete_workspace(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_workspace_delete_manifest(p_workspace_id, 'ai_board');
$function$;

create or replace function public.worktodo_request_delete_workspace(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_workspace_delete_manifest(p_workspace_id, 'worktodo');
$function$;

create or replace function public.board_finalize_delete_workspace(
  p_workspace_id uuid,
  p_target_workspace_id uuid,
  p_task_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_finalize_workspace_delete(p_workspace_id, 'ai_board', p_target_workspace_id, p_task_ids);
$function$;

create or replace function public.worktodo_finalize_delete_workspace(
  p_workspace_id uuid,
  p_target_workspace_id uuid,
  p_task_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform set_config('zhuge.worktodo_workspace_write', '1', true);
  return public.zhuge_finalize_workspace_delete(p_workspace_id, 'worktodo', p_target_workspace_id, p_task_ids);
end;
$function$;

revoke all on function public.zhuge_workspace_delete_manifest(uuid, text) from public, anon, authenticated;
revoke all on function public.zhuge_finalize_workspace_delete(uuid, text, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.board_request_delete_workspace(uuid) from public, anon;
revoke all on function public.worktodo_request_delete_workspace(uuid) from public, anon;
revoke all on function public.board_finalize_delete_workspace(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.board_request_delete_workspace(uuid) to authenticated;
grant execute on function public.worktodo_request_delete_workspace(uuid) to authenticated;
grant execute on function public.board_finalize_delete_workspace(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[]) to authenticated;

comment on function public.board_request_delete_workspace(uuid) is
  'Returns the custom AI Board workspace deletion manifest; task data is preserved.';
comment on function public.worktodo_request_delete_workspace(uuid) is
  'Returns the custom WorkTodo workspace deletion manifest; task data is preserved.';
comment on function public.board_finalize_delete_workspace(uuid, uuid, uuid[]) is
  'Controlled AI Board custom Workspace classification delete; tasks are moved to 待開始 and preserved.';
comment on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[]) is
  'Controlled WorkTodo custom Workspace classification delete; tasks are moved to 待開始 and preserved.';

notify pgrst, 'reload schema';

commit;
