-- TASK-081 corrective migration: keep explicit unbound Create fail-closed and
-- avoid evaluating an unassigned PL/pgSQL record in a nullable INSERT branch.

create or replace function public.board_create_task(
  p_title text,
  p_summary text,
  p_usage_scenario text,
  p_priority text,
  p_actor_type text,
  p_actor_label text,
  p_workspace_id uuid,
  p_acceptance_criteria text,
  p_workflow_mode text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_actor_id uuid;
  v_target_workspace_id uuid;
  v_instance public.board_instances;
  v_created_task public.board_tasks;
  v_workflow record;
  v_workflow_configured boolean := false;
  v_workflow_version_id uuid;
  v_current_workflow_step_id uuid;
  v_status text := 'not_started';
  v_assignee text;
  v_workflow_mode text := lower(btrim(coalesce(p_workflow_mode, 'published')));
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if v_workflow_mode not in ('published', 'unbound') then
    raise exception using errcode = '22023', message = 'Workflow mode must be published or unbound';
  end if;
  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Task actor is not allowed';
  end if;
  if v_workflow_mode = 'unbound' and v_actor_type <> 'ai' then
    raise exception using errcode = '42501', message = 'Unbound AI Board create requires the GPT actor path';
  end if;

  select * into v_instance
    from public.board_instances
   where legacy_application_scope = 'ai_board'
     and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'AI Board registry is unavailable';
  end if;

  if p_workspace_id is null then
    select id into v_target_workspace_id
      from public.board_workspaces
     where board_instance_id = v_instance.id
       and workspace_key = 'todo'
       and active = true
       and archived_at is null;
  else
    select id into v_target_workspace_id
      from public.board_workspaces
     where id = p_workspace_id
       and board_instance_id = v_instance.id
       and active = true
       and archived_at is null;
  end if;
  if v_target_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active AI Board workspace is unavailable';
  end if;

  if v_workflow_mode = 'published' then
    select * into v_workflow
      from private.board_c_resolve_workflow_create_state(
        v_instance.id,
        v_target_workspace_id,
        null
      );
    if found then
      v_workflow_configured := true;
      v_status := v_workflow.workflow_status;
      v_assignee := v_workflow.workflow_assignee;
      v_workflow_version_id := v_workflow.workflow_version_id;
      v_current_workflow_step_id := v_workflow.current_workflow_step_id;
    end if;
  else
    perform set_config('zhuge.module_c_workflow_mode', 'unbound', true);
  end if;

  insert into public.board_tasks (
    board_instance_id, application_scope, owner_uuid, title, summary,
    usage_scenario, priority, acceptance_criteria, status, assignee,
    workspace_id, created_by, created_at, updated_at,
    workflow_version_id, current_workflow_step_id
  ) values (
    v_instance.id, 'ai_board', null, trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''),
    nullif(trim(coalesce(p_acceptance_criteria, '')), ''),
    v_status, v_assignee, v_target_workspace_id, v_actor_id, now(), now(),
    v_workflow_version_id, v_current_workflow_step_id
  ) returning * into v_created_task;

  if v_workflow_mode = 'unbound' then
    perform set_config('zhuge.module_c_workflow_mode', '', true);
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_created_task.id::text, 'task_created', to_jsonb(v_created_task),
    'Board task created', v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order, version
  ) values
    (v_created_task.id, 'task_acceptance', 'co', 'developer-qa',
      format('Co Developer QA：完成「%s」並附 Evidence', v_created_task.title), true, 10, 1),
    (v_created_task.id, 'task_acceptance', 'gpt', 'gpt-review',
      format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', v_created_task.title), true, 20, 1),
    (v_created_task.id, 'task_acceptance', 'qjc', 'pm-acceptance',
      format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', v_created_task.title), true, 30, 1);
  return v_created_task;
end;
$function$;

create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text,
  p_status text,
  p_usage_scenario text,
  p_workspace_id uuid,
  p_workflow_mode text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_workflow record;
  v_workflow_configured boolean := false;
  v_workflow_version_id uuid;
  v_current_workflow_step_id uuid;
  v_owner uuid;
  v_assignee text;
  v_status text := lower(btrim(coalesce(p_status, 'not_started')));
  v_default_key text;
  v_title text := btrim(coalesce(p_title, ''));
  v_workflow_mode text := lower(btrim(coalesce(p_workflow_mode, 'published')));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if v_workflow_mode not in ('published', 'unbound') then
    raise exception using errcode = '22023', message = 'Workflow mode must be published or unbound';
  end if;

  select * into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board instance not found';
  end if;

  v_default_key := lower(v_instance.task_code_prefix) || '-todo';
  if p_workspace_id is null then
    select * into v_workspace
      from public.board_workspaces
     where board_instance_id = p_board_instance_id
       and workspace_key = v_default_key
       and active = true
       and archived_at is null
     order by sort_order
     limit 1;
  else
    select * into v_workspace
      from public.board_workspaces
     where id = p_workspace_id
       and board_instance_id = p_board_instance_id
       and active = true
       and archived_at is null;
  end if;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board workspace is required';
  end if;

  if v_workflow_mode = 'published' then
    select * into v_workflow
      from private.board_c_resolve_workflow_create_state(
        p_board_instance_id,
        v_workspace.id,
        null
      );
    if found then
      v_workflow_configured := true;
      v_status := v_workflow.workflow_status;
      v_assignee := v_workflow.workflow_assignee;
      v_workflow_version_id := v_workflow.workflow_version_id;
      v_current_workflow_step_id := v_workflow.current_workflow_step_id;
    end if;
  else
    perform set_config('zhuge.module_c_workflow_mode', 'unbound', true);
  end if;

  v_owner := case when v_instance.authorization_mode = 'owner' then v_user else null end;
  insert into public.board_tasks (
    board_instance_id,
    workspace_id,
    title,
    summary,
    status,
    assignee,
    usage_scenario,
    application_scope,
    owner_uuid,
    created_by,
    workflow_version_id,
    current_workflow_step_id
  ) values (
    p_board_instance_id,
    v_workspace.id,
    v_title,
    nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(nullif(v_status, ''), 'not_started'),
    case when v_workflow_configured then v_assignee else null end,
    nullif(btrim(coalesce(p_usage_scenario, '')), ''),
    null,
    v_owner,
    v_user,
    v_workflow_version_id,
    v_current_workflow_step_id
  ) returning * into v_row;

  if v_workflow_mode = 'unbound' then
    perform set_config('zhuge.module_c_workflow_mode', '', true);
  end if;

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
$function$;

notify pgrst, 'reload schema';
