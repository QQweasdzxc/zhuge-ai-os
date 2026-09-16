-- Keep the PM-authorized GPT TASK route as a governance adapter, while
-- making its workflow state resolution identical to the C shared Create
-- contract.  No product rows are rewritten by this migration.

begin;

create or replace function public.board_create_task(
  p_title text,
  p_summary text,
  p_usage_scenario text,
  p_priority text,
  p_actor_type text,
  p_actor_label text,
  p_workspace_id uuid,
  p_acceptance_criteria text
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
  v_status text := 'not_started';
  v_assignee text;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
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
       and application_scope = 'ai_board'
       and active = true
       and archived_at is null;
  end if;
  if v_target_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active AI Board workspace is unavailable';
  end if;

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
    case when v_workflow_configured then v_workflow.workflow_version_id else null end,
    case when v_workflow_configured then v_workflow.current_workflow_step_id else null end
  ) returning * into v_created_task;

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

comment on function public.board_create_task(text, text, text, text, text, text, uuid, text) is
  'Governed AI Board create adapter; lifecycle state is resolved by Module C shared Create authority.';

create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_usage_scenario text default null,
  p_priority text default null,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
begin
  return public.board_create_task(
    p_title => p_title,
    p_summary => p_summary,
    p_usage_scenario => p_usage_scenario,
    p_priority => p_priority,
    p_actor_type => p_actor_type,
    p_actor_label => p_actor_label,
    p_workspace_id => p_workspace_id,
    p_acceptance_criteria => null
  );
end;
$function$;

comment on function public.board_create_task(text, text, text, text, text, text, uuid) is
  'AI Board create compatibility wrapper; shared C workflow resolution remains in the governed create adapter.';

revoke all on function public.board_create_task(text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid, text) to authenticated, service_role;
revoke all on function public.board_create_task(text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid) to authenticated, service_role;

commit;
