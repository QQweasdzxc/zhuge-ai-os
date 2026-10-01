-- Workspace Delete Contract: every active main-board workspace except 完成.
--
-- Product decision:
--   * 完成 is the lifecycle/completion workspace and is protected.
--   * Other active AI Board / WorkTodo workspaces may be deleted through the
--     existing controlled request -> move -> finalize path.
--   * Tasks and all child evidence remain intact. A populated source workspace
--     must be emptied by the controlled move path before deletion.
--
-- This is an append-only replacement for the custom-only guards in
-- 20260826_custom_workspace_delete.sql. It does not change task, checklist,
-- progress, attachment, Storage, Identity, or OAuth data.

begin;

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

  if lower(coalesce(v_workspace.workspace_key, '')) in ('completed', 'done', 'worktodo-completed', 'mdtk-completed')
     or lower(coalesce(v_workspace.workspace_key, '')) like '%-completed'
     or coalesce(v_workspace.name, '') in ('完成', '已完成') then
    raise exception using errcode = '42501', message = 'Completion workspace is not deletable';
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

  if lower(coalesce(v_workspace.workspace_key, '')) in ('completed', 'done', 'worktodo-completed', 'mdtk-completed')
     or lower(coalesce(v_workspace.workspace_key, '')) like '%-completed'
     or coalesce(v_workspace.name, '') in ('完成', '已完成') then
    raise exception using errcode = '42501', message = 'Completion workspace is not deletable';
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
    raise exception using errcode = '40001', message = 'Tasks must be moved to another active non-completion workspace before deletion';
  end if;

  if p_target_workspace_id is not null then
    if p_target_workspace_id = v_workspace.id then
      raise exception using errcode = '22023', message = 'Workspace delete target must differ from the source workspace';
    end if;
    select * into v_target_workspace
    from public.board_workspaces
    where id = p_target_workspace_id
      and application_scope = p_application_scope
      and active = true
      and not (
        lower(coalesce(workspace_key, '')) in ('completed', 'done', 'worktodo-completed', 'mdtk-completed')
        or lower(coalesce(workspace_key, '')) like '%-completed'
        or coalesce(name, '') in ('完成', '已完成')
      )
    for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Active non-completion target workspace not found';
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
      raise exception using errcode = '40001', message = 'Workspace tasks were not moved to the selected target workspace';
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
    'Non-completion workspace deleted through the controlled Workspace Delete Contract; task data preserved in the selected target workspace',
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
       or lower(coalesce(old.workspace_key, '')) in ('completed', 'done', 'worktodo-completed', 'mdtk-completed')
       or lower(coalesce(old.workspace_key, '')) like '%-completed'
       or coalesce(old.name, '') in ('完成', '已完成') then
      raise exception using errcode = '42501', message = 'WorkTodo completion workspace or uncontrolled delete is not allowed';
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
  'Returns a non-completion AI Board workspace deletion manifest; task data is preserved.';
comment on function public.worktodo_request_delete_workspace(uuid) is
  'Returns a non-completion WorkTodo workspace deletion manifest; task data is preserved.';
comment on function public.board_finalize_delete_workspace(uuid, uuid, uuid[]) is
  'Controlled AI Board non-completion workspace delete; tasks are moved to the selected active target and preserved.';
comment on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[]) is
  'Controlled WorkTodo non-completion workspace delete; tasks are moved to the selected active target and preserved.';

notify pgrst, 'reload schema';

commit;
