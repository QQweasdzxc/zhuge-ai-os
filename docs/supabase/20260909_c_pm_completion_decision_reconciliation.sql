-- Module C canonical PM Workspace Decision completion reconciliation.
--
-- A PM selecting 完成 is a completion decision, regardless of the source
-- workspace.  The C contract records the authenticated action context and
-- reconciles the task atomically.  Historical Co/GPT/Regression evidence is
-- preserved, but it is not re-used as a prerequisite for the PM decision.
-- Generic board_transition_task -> done remains closed.

begin;

create or replace function public.board_c_reconcile_workspace_decision(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_decision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_before_task public.board_tasks%rowtype;
  v_after_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_current_workspace public.board_workspaces%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_item public.engineering_checklist_items%rowtype;
  v_updated_item public.engineering_checklist_items%rowtype;
  v_scope text;
  v_target_key text;
  v_target_name text;
  v_target_kind text := 'ordinary';
  v_current_is_completed boolean := false;
  v_reopened boolean := false;
  v_next_status text;
  v_next_assignee text;
  v_action_note text;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using
      errcode = '42501',
      message = '工作區決定需要已登入的 PM／QJC 身分；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'authenticated_owner',
        'missing', jsonb_build_array('PM／QJC 登入身分')
      )::text;
  end if;

  if p_task_id is null or p_target_workspace_id is null then
    raise exception using
      errcode = '22023',
      message = '工作區決定缺少 TASK 或目標工作區；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'input',
        'missing', jsonb_build_array('TASK ID', '目標工作區 ID')
      )::text;
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '找不到指定 TASK；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'task_exists',
        'task_id', p_task_id
      )::text;
  end if;

  if not public.board_task_can_write(v_task.id) then
    raise exception using
      errcode = '42501',
      message = '目前登入身分沒有此 TASK 的正式管理權限；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'owner_scope',
        'task_id', p_task_id
      )::text;
  end if;

  if v_task.archived_at is not null then
    raise exception using
      errcode = '42501',
      message = '封存卡片不可重新移動；卡片未變更。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'archived_task',
        'task_id', p_task_id
      )::text;
  end if;

  if lower(coalesce(v_task.status, '')) in ('merged', 'cancelled', 'canceled') then
    raise exception using
      errcode = '42501',
      message = '已合併或已取消的終止 TASK 不可由工作區拖曳重新開啟；卡片未變更。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'governance_terminal',
        'status', v_task.status,
        'task_id', p_task_id
      )::text;
  end if;

  select *
    into v_instance
  from public.board_instances
  where id = v_task.board_instance_id
    and active = true
  for share;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK 的正式 Board Instance 不存在或未啟用；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'board_instance',
        'task_id', p_task_id
      )::text;
  end if;

  select *
    into v_target_workspace
  from public.board_workspaces
  where id = p_target_workspace_id
    and board_instance_id = v_task.board_instance_id
    and active = true
    and archived_at is null
  for share;
  if not found then
    raise exception using
      errcode = '22023',
      message = '目標工作區不存在、未啟用或已封存；卡片未移動。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'target_workspace',
        'target_workspace_id', p_target_workspace_id
      )::text;
  end if;

  v_scope := lower(coalesce(
    nullif(btrim(coalesce(v_task.application_scope, '')), ''),
    nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), ''),
    ''
  ));
  if v_scope in ('worktodo', 'investment')
     or lower(coalesce(v_instance.task_code_prefix, '')) = 'ivtk' then
    raise exception using
      errcode = '42501',
      message = '此 Consumer 的產品能力不允許 PM Workspace Reconciliation；卡片未變更。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v1',
        'action', 'pm-workspace-decision',
        'gate', 'consumer_capability',
        'consumer', coalesce(nullif(v_scope, ''), v_instance.task_code_prefix),
        'missing', jsonb_build_array('可用的 C Workspace Authority capability')
      )::text;
  end if;

  select *
    into v_current_workspace
  from public.board_workspaces
  where id = v_task.workspace_id;

  v_current_is_completed := lower(coalesce(v_task.status, '')) = 'done'
    or lower(coalesce(v_current_workspace.workspace_key, '')) = 'completed'
    or lower(coalesce(v_current_workspace.name, '')) in ('完成', '已完成');

  v_target_key := lower(btrim(coalesce(v_target_workspace.workspace_key, '')));
  v_target_name := lower(btrim(coalesce(v_target_workspace.name, '')));

  if v_target_key = 'todo'
     or v_target_key ~ '(^|-)todo$'
     or v_target_name in ('待辦', '待開始') then
    v_target_kind := 'todo';
  elsif v_target_key = 'co'
     or v_target_key ~ '(^|-)in-progress$'
     or v_target_key ~ '(^|-)inprogress$'
     or v_target_name in ('co', '進行中') then
    v_target_kind := 'co';
  elsif v_target_key = 'gpt' or v_target_name = 'gpt' then
    v_target_kind := 'gpt';
  elsif v_target_key = 'qjc'
     or v_target_key ~ '(^|-)qa$'
     or v_target_key ~ '(^|-)acceptance$'
     or v_target_name in ('qjc驗證', '待驗收') then
    v_target_kind := 'qjc';
  elsif v_target_key = 'completed'
     or v_target_key ~ '(^|-)completed$'
     or v_target_name in ('完成', '已完成') then
    v_target_kind := 'completed';
  end if;

  if v_task.workspace_id = v_target_workspace.id
     and (
       v_target_kind = 'ordinary'
       or (v_target_kind = 'todo' and v_task.status = 'ready' and v_task.assignee = 'Co')
       or (v_target_kind = 'co' and v_task.status = 'inprogress' and v_task.assignee = 'Co')
       or (v_target_kind = 'gpt' and v_task.status = 'qa' and v_task.assignee = 'GPT')
       or (v_target_kind = 'qjc' and v_task.status = 'qa' and v_task.assignee = 'QJC')
       or (v_target_kind = 'completed' and v_task.status = 'done' and v_task.assignee = 'QJC')
     ) then
    return jsonb_build_object(
      'success', true,
      'contract', 'module-c-lifecycle-acceptance-v1',
      'action', 'pm-workspace-decision',
      'decision', 'noop',
      'task_id', v_task.id,
      'workspace_id', v_task.workspace_id,
      'status', v_task.status,
      'assignee', v_task.assignee,
      'audit_preserved', true
    );
  end if;

  if v_target_kind = 'completed' then
    -- The PM-selected target is the Completion Decision.  Only the formal
    -- PM Acceptance record is required; historical engineering evidence is
    -- not re-run as a prerequisite and is left unchanged.
    if v_scope <> 'ai_board' then
      raise exception using
        errcode = '42501',
        message = '此 C Consumer 尚未啟用 PM Acceptance；卡片未移動。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v1',
          'action', 'pm-workspace-decision',
          'gate', 'pm_acceptance_capability',
          'consumer', coalesce(nullif(v_scope, ''), v_instance.task_code_prefix),
          'missing', jsonb_build_array('PM Acceptance capability')
        )::text;
    end if;

    select *
      into v_item
    from public.engineering_checklist_items
    where task_id = v_task.id
      and required = true
      and lower(coalesce(stage, '')) = 'qjc'
      and lower(coalesce(item_key, '')) = 'pm-acceptance'
    order by sort_order asc, created_at asc
    limit 1
    for update;
    if not found then
      raise exception using
        errcode = '42501',
        message = '尚未建立正式 PM Acceptance Record；卡片未移動。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v1',
          'action', 'pm-workspace-decision',
          'gate', 'pm_acceptance_record',
          'missing', jsonb_build_array('正式 PM Acceptance Record')
        )::text;
    end if;

    v_action_note := format(
      'PM Workspace Decision action context | contract=module-c-lifecycle-acceptance-v1 | action=pm-workspace-decision-to-completed | actor_id=%s | task_id=%s | source_workspace_id=%s | target_workspace_id=%s | requested_at=%s%s',
      auth.uid(),
      v_task.id,
      v_task.workspace_id,
      v_target_workspace.id,
      clock_timestamp(),
      case when nullif(btrim(coalesce(p_decision_note, '')), '') is null
        then ''
        else format(' | decision_note=%s', left(btrim(p_decision_note), 240))
      end
    );

    -- This is a controlled PM action-context record.  It does not claim that
    -- Co, GPT, or Regression performed any work and it never alters those
    -- historical checklist rows.
    update public.engineering_checklist_items
    set state = 'pass',
        checked_by = auth.uid(),
        checked_at = now(),
        evidence_note = v_action_note,
        evidence_ref = null,
        updated_at = now()
    where id = v_item.id
    returning * into v_updated_item;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'engineering_checklist_item', v_item.id::text, 'checklist_item_updated',
      to_jsonb(v_item), to_jsonb(v_updated_item), v_action_note,
      auth.uid(), 'human', 'QJC', 'system_activity'
    );

    v_before_task := v_task;
    update public.board_tasks
    set status = 'done',
        assignee = 'QJC',
        workspace_id = v_target_workspace.id,
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, auth.uid()),
        completion_at = coalesce(completion_at, now()),
        completion_by = coalesce(completion_by, auth.uid()),
        archive_due_at = coalesce(archive_due_at, now() + interval '48 hours'),
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = v_task.id
    returning * into v_after_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, 'task_completed_after_pm_workspace_decision',
      to_jsonb(v_before_task), to_jsonb(v_after_task), v_action_note,
      auth.uid(), 'human', 'QJC', 'system_activity'
    );

    return jsonb_build_object(
      'success', true,
      'contract', 'module-c-lifecycle-acceptance-v1',
      'action', 'pm-workspace-decision',
      'decision', 'completion',
      'lifecycle', 'pm_completion_decision',
      'task_id', v_after_task.id,
      'checklist_item_id', v_updated_item.id,
      'source_workspace_id', v_before_task.workspace_id,
      'target_workspace_id', v_after_task.workspace_id,
      'status', v_after_task.status,
      'assignee', v_after_task.assignee,
      'acceptance_context_recorded', true,
      'acceptance_audit_recorded', true,
      'historical_engineering_evidence_preserved', true,
      'failure_atomicity', true
    );
  end if;

  if v_target_kind = 'todo' then
    v_next_status := 'ready';
    v_next_assignee := 'Co';
  elsif v_target_kind = 'co' then
    v_next_status := 'inprogress';
    v_next_assignee := 'Co';
  elsif v_target_kind = 'gpt' then
    v_next_status := 'qa';
    v_next_assignee := 'GPT';
  elsif v_target_kind = 'qjc' then
    v_next_status := 'qa';
    v_next_assignee := 'QJC';
  elsif v_current_is_completed then
    -- A completed card moved to an ordinary workspace is a PM reopen
    -- decision.  Completion/acceptance history remains intact.
    v_next_status := 'ready';
    v_next_assignee := 'Co';
  end if;

  v_reopened := v_current_is_completed;
  v_before_task := v_task;
  update public.board_tasks
  set workspace_id = v_target_workspace.id,
      status = coalesce(v_next_status, status),
      assignee = coalesce(v_next_assignee, assignee),
      archive_due_at = case when v_reopened then null else archive_due_at end,
      updated_at = now()
  where id = v_task.id
  returning * into v_after_task;

  v_action_note := format(
    'PM Workspace Decision | contract=module-c-lifecycle-acceptance-v1 | action=%s | actor_id=%s | task_id=%s | source_workspace_id=%s | target_workspace_id=%s | requested_at=%s%s',
    case when v_reopened then 'reopen' else 'workspace-reconcile' end,
    auth.uid(),
    v_task.id,
    v_before_task.workspace_id,
    v_target_workspace.id,
    clock_timestamp(),
    case when nullif(btrim(coalesce(p_decision_note, '')), '') is null
      then ''
      else format(' | decision_note=%s', left(btrim(p_decision_note), 240))
    end
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text,
    case when v_reopened then 'task_reopened_by_pm_workspace_decision' else 'task_workspace_decision_reconciled' end,
    to_jsonb(v_before_task), to_jsonb(v_after_task), v_action_note,
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'contract', 'module-c-lifecycle-acceptance-v1',
    'action', 'pm-workspace-decision',
    'decision', case when v_reopened then 'reopen' else 'workspace' end,
    'task_id', v_after_task.id,
    'source_workspace_id', v_before_task.workspace_id,
    'target_workspace_id', v_after_task.workspace_id,
    'status', v_after_task.status,
    'assignee', v_after_task.assignee,
    'audit_preserved', true,
    'reopen_audit_recorded', v_reopened
  );
end;
$function$;

revoke all on function public.board_c_reconcile_workspace_decision(uuid, uuid, text) from public, anon;
grant execute on function public.board_c_reconcile_workspace_decision(uuid, uuid, text) to authenticated;

comment on function public.board_c_reconcile_workspace_decision(uuid, uuid, text) is
  'Module C canonical PM Workspace Authority: any PM-selected workspace is reconciled atomically; selecting completed records controlled PM action context without requiring historical engineering-stage traversal, and reopening preserves prior acceptance audit.';

-- Older shared callers remain compatible, but there is only one completion
-- implementation: they validate the formal item and delegate to the C
-- workspace-decision contract instead of keeping a second acceptance flow.
create or replace function public.board_pm_acceptance_from_qjc_drop(
  p_task_id uuid,
  p_item_id uuid,
  p_evidence_note text default null,
  p_evidence_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_item public.engineering_checklist_items%rowtype;
  v_completed_workspace public.board_workspaces%rowtype;
  v_decision_note text;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using
      errcode = '42501',
      message = 'PM Acceptance 需要已登入的 QJC／PM 身分；卡片未移動。';
  end if;
  if p_task_id is null or p_item_id is null then
    raise exception using
      errcode = '22023',
      message = 'PM Acceptance 缺少 TASK 或驗收項目；卡片未移動。';
  end if;

  select * into v_task
  from public.board_tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到指定 TASK；卡片未移動。';
  end if;

  select * into v_item
  from public.engineering_checklist_items
  where id = p_item_id
    and task_id = v_task.id;
  if not found
     or lower(coalesce(v_item.stage, '')) <> 'qjc'
     or lower(coalesce(v_item.item_key, '')) <> 'pm-acceptance' then
    raise exception using
      errcode = '42501',
      message = '指定項目不是正式 PM Acceptance Record；卡片未移動。';
  end if;

  select * into v_completed_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and archived_at is null
    and (
      workspace_key = 'completed'
      or lower(name) in ('完成', '已完成')
    )
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '找不到此 Board 的完成工作區；卡片未移動。';
  end if;

  v_decision_note := coalesce(
    nullif(btrim(coalesce(p_evidence_note, '')), ''),
    nullif(btrim(coalesce(p_evidence_ref, '')), ''),
    null
  );
  return public.board_c_reconcile_workspace_decision(
    p_task_id,
    v_completed_workspace.id,
    v_decision_note
  );
end;
$function$;

revoke all on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) to authenticated;

comment on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) is
  'Compatibility entry for the Module C canonical PM Workspace Decision completion contract; delegates to the single PM completion/reopen implementation and never requires manual engineering evidence.';

commit;
