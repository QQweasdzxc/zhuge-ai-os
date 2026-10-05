-- Phase 1C: create the disposable C/MDTK template instance and its initial
-- empty board.  Existing WorkTodo and AI Board rows are not changed.
begin;

-- Keep the generic default-task contract valid for every registered prefix.
create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text default null,
  p_status text default 'not_started',
  p_usage_scenario text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_number integer;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  select * into v_instance from public.board_instances where id = p_board_instance_id for update;
  if not found or not v_instance.active then
    raise exception using errcode = 'P0002', message = 'Active board instance not found';
  end if;
  if p_workspace_id is not null then
    select * into v_workspace from public.board_workspaces
    where id = p_workspace_id and board_instance_id = p_board_instance_id and active = true;
  else
    select * into v_workspace from public.board_workspaces
    where board_instance_id = p_board_instance_id
      and workspace_key = lower(v_instance.task_code_prefix) || '-todo'
      and active = true
    order by sort_order limit 1;
  end if;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Board workspace is required';
  end if;
  update public.board_instances
  set next_task_number = next_task_number + 1, updated_at = now()
  where id = p_board_instance_id
  returning next_task_number into v_number;
  insert into public.board_tasks (
    board_instance_id, workspace_id, work_code, title, summary, status,
    usage_scenario, application_scope, owner_uuid, created_by
  ) values (
    p_board_instance_id, v_workspace.id,
    v_instance.task_code_prefix || '-' || lpad(v_number::text, 3, '0'),
    v_title, nullif(p_summary, ''), coalesce(nullif(p_status, ''), 'not_started'),
    nullif(p_usage_scenario, ''), null, v_user, v_user
  ) returning * into v_row;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.id::text, 'task_created', to_jsonb(v_row),
    'Board task created through the universal board contract',
    v_user, 'human', coalesce(v_user::text, 'authenticated'), 'system_activity'
  );
  return v_row;
end;
$$;

do $$
declare
  v_worktodo_owner uuid;
  v_instance_id uuid;
  v_instance_owner uuid;
  v_instance_count integer;
  v_workspace_count integer;
begin
  select owner_uuid
    into v_worktodo_owner
  from public.board_instances
  where legacy_application_scope = 'worktodo'
    and active = true
  order by created_at
  limit 1;

  if v_worktodo_owner is null then
    raise exception using errcode = 'P0002', message = 'C template seed requires an existing WorkTodo owner';
  end if;

  select id, owner_uuid
    into v_instance_id, v_instance_owner
  from public.board_instances
  where template_key = 'c'
    and is_template_instance = true
  limit 1;

  if v_instance_id is null then
    insert into public.board_instances (
      name, task_code_prefix, template_key, authorization_mode, owner_uuid,
      legacy_application_scope, is_template_instance, active, created_by
    ) values (
      'C 母版測試', 'MDTK', 'c', 'owner', v_worktodo_owner,
      null, true, true, v_worktodo_owner
    ) returning id, owner_uuid into v_instance_id, v_instance_owner;
  end if;

  insert into public.board_workspaces (
    board_instance_id, workspace_key, name, sort_order, active,
    application_scope, owner_uuid, created_by, updated_by
  )
  select v_instance_id, spec.workspace_key, spec.name, spec.sort_order, true,
         null, v_instance_owner, v_instance_owner, v_instance_owner
  from (values
    ('mdtk-todo'::text, 'MDTK｜待開始'::text, 10),
    ('mdtk-in-progress'::text, 'MDTK｜進行中'::text, 20),
    ('mdtk-vendor-reply'::text, 'MDTK｜等待廠商回覆'::text, 30),
    ('mdtk-qa'::text, 'MDTK｜等待驗收'::text, 40),
    ('mdtk-completed'::text, 'MDTK｜完成'::text, 50)
  ) as spec(workspace_key, name, sort_order)
  where not exists (
    select 1
    from public.board_workspaces existing
    where existing.board_instance_id = v_instance_id
      and existing.workspace_key = spec.workspace_key
  );

  select count(*) into v_instance_count
  from public.board_instances
  where template_key = 'c' and is_template_instance = true and active = true;
  select count(*) into v_workspace_count
  from public.board_workspaces
  where board_instance_id = v_instance_id and active = true;

  if v_instance_count <> 1 or v_workspace_count <> 5 then
    raise exception using errcode = 'P0001',
      message = format('C template seed validation failed: instances=%s workspaces=%s', v_instance_count, v_workspace_count);
  end if;
end $$;

commit;
