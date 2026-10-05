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
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$$;