-- Module C Workflow v2 — controlled adoption for existing unbound cards
--
-- Existing cards created before the canonical C Workflow binding trigger may
-- have no workflow version/current step.  This contract binds one card at a
-- time only when its current Workspace UUID maps to exactly one step in the
-- Board Instance's currently Published Workflow.  It never infers from a
-- TASK id, title, status, assignee, Workspace name, or ordering, and it never
-- moves a card or changes its business data.

begin;

create or replace function public.board_c_workflow_adopt_unbound_card_v2(
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_instance public.board_instances%rowtype;
  v_workspace public.board_workspaces%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_workflow_state public.board_instance_workflow_state%rowtype;
  v_step public.board_workflow_steps%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_hash text;
  v_step_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = '既有卡片套用流程需要已登入的管理身分；卡片未變更。';
  end if;

  select * into v_task
  from public.board_tasks
  where id = p_task_id
  for update;

  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using
      errcode = '42501',
      message = '目前登入身分沒有此卡片的管理權限；卡片未變更。';
  end if;

  select * into v_instance
  from public.board_instances
  where id = v_task.board_instance_id
    and active = true
  for share;

  if not found or lower(coalesce(v_instance.template_key, '')) <> 'c' then
    raise exception using
      errcode = '22023',
      message = '這張卡片不屬於可使用 Module C Workflow 的子板；卡片未變更。';
  end if;

  if v_task.archived_at is not null
     or v_task.status in ('cancelled', 'merged') then
    raise exception using
      errcode = '55000',
      message = '已封存或已取消的卡片不進行既有流程套用；卡片未變更。';
  end if;

  if (v_task.workflow_version_id is null) <> (v_task.current_workflow_step_id is null) then
    raise exception using
      errcode = '55000',
      message = '此卡片已有不完整的流程綁定，不能自動判定；請由 PM 進行正式分類，卡片未變更。',
      detail = jsonb_build_object(
        'state', 'needs_pm_classification',
        'reason', 'partial_workflow_binding'
      )::text;
  end if;

  select * into v_workflow_state
  from public.board_instance_workflow_state
  where board_instance_id = v_task.board_instance_id
  for share;

  if not found or v_workflow_state.published_workflow_version_id is null then
    raise exception using
      errcode = '55000',
      message = '這張子板目前沒有已發布的正式流程，卡片未變更。';
  end if;

  select * into v_definition
  from public.board_workflow_definitions
  where id = v_workflow_state.published_workflow_version_id
    and board_instance_id = v_task.board_instance_id
    and status = 'published'
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = '這張子板的 Published Workflow 無法驗證，卡片未變更。';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = v_task.workspace_id
    and board_instance_id = v_task.board_instance_id
    and active = true
    and archived_at is null
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = '卡片目前工作區不是可安全對應的有效工作區；請由 PM 進行正式分類，卡片未變更。',
      detail = jsonb_build_object(
        'state', 'needs_pm_classification',
        'reason', 'current_workspace_unavailable',
        'workspace_id', v_task.workspace_id
      )::text;
  end if;

  select count(*) into v_step_count
  from public.board_workflow_steps
  where workflow_version_id = v_definition.id
    and workspace_id = v_workspace.id;

  if v_step_count <> 1 then
    raise exception using
      errcode = '55000',
      message = '卡片目前工作區無法唯一對應這張子板的 Published Workflow；請由 PM 進行正式分類，卡片未變更。',
      detail = jsonb_build_object(
        'state', 'needs_pm_classification',
        'reason', 'workspace_step_mapping_not_unique',
        'workspace_id', v_workspace.id,
        'matching_step_count', v_step_count,
        'workflow_version_id', v_definition.id
      )::text;
  end if;

  select * into v_step
  from public.board_workflow_steps
  where workflow_version_id = v_definition.id
    and workspace_id = v_workspace.id;

  v_hash := md5(concat_ws('|', p_task_id::text, v_task.board_instance_id::text, v_definition.id::text, v_step.id::text));

  if v_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = v_idempotency_key;

    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using
          errcode = '40001',
          message = '既有卡片流程套用的 Idempotency Key 已用於不同內容；卡片未變更。';
      end if;
      return v_existing.response;
    end if;
  end if;

  if v_task.workflow_version_id is not null
     or v_task.current_workflow_step_id is not null then
    if v_task.workflow_version_id = v_definition.id
       and v_task.current_workflow_step_id = v_step.id then
      v_response := jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'action', 'adopt-unbound-card',
        'state', 'already_bound',
        'task_id', v_task.id,
        'board_instance_id', v_task.board_instance_id,
        'workflow_version_id', v_definition.id,
        'current_workflow_step_id', v_step.id,
        'current_workspace_id', v_task.workspace_id,
        'workspace_status_assignee_preserved', true,
        'card_identity_preserved', true,
        'card_data_moved', false,
        'audit_recorded', false,
        'reconciliation_source', 'published_workflow+current_workspace_identity'
      );
      if v_idempotency_key is not null then
        insert into private.board_workflow_action_idempotency (
          idempotency_key, action_type, board_instance_id, task_id,
          request_hash, response, status
        ) values (
          v_idempotency_key, 'adopt_unbound_card', v_task.board_instance_id,
          v_task.id, v_hash, v_response, 'completed'
        );
      end if;
      return v_response;
    end if;

    raise exception using
      errcode = '55000',
      message = '此卡片已綁定其他流程版本或階段，不能覆寫；請由 PM 進行正式流程採用，卡片未變更。',
      detail = jsonb_build_object(
        'state', 'needs_pm_classification',
        'reason', 'existing_workflow_binding_conflict',
        'workflow_version_id', v_task.workflow_version_id,
        'current_workflow_step_id', v_task.current_workflow_step_id
      )::text;
  end if;

  v_before := to_jsonb(v_task);

  update public.board_tasks
  set workflow_version_id = v_definition.id,
      current_workflow_step_id = v_step.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_task;

  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'adopt-unbound-card',
    'state', 'adopted',
    'task_id', v_task.id,
    'board_instance_id', v_task.board_instance_id,
    'workflow_version_id', v_definition.id,
    'current_workflow_step_id', v_step.id,
    'current_workspace_id', v_task.workspace_id,
    'workspace_status_assignee_preserved', true,
    'card_identity_preserved', true,
    'card_data_moved', false,
    'audit_recorded', true,
    'reconciliation_source', 'published_workflow+current_workspace_identity',
    'before', v_before,
    'after', to_jsonb(v_task),
    'audit_context', jsonb_build_object(
      'actor_id', auth.uid(),
      'occurred_at', v_now,
      'action', 'adopt-existing-card-to-published-workflow',
      'source_workspace_id', v_task.workspace_id,
      'workflow_version_id', v_definition.id,
      'current_workflow_step_id', v_step.id
    )
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'workflow_unbound_card_adopted',
    v_before, v_response,
    '依 Published Workflow 與目前 Workspace UUID 的唯一對應，受控綁定既有卡片；未移動工作區或修改卡片資料。',
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if v_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      v_idempotency_key, 'adopt_unbound_card', v_task.board_instance_id,
      v_task.id, v_hash, v_response, 'completed'
    );
  end if;

  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_adopt_unbound_card_v2(uuid, text) from public, anon;
grant execute on function public.board_c_workflow_adopt_unbound_card_v2(uuid, text) to authenticated;

comment on function public.board_c_workflow_adopt_unbound_card_v2(uuid, text) is
  'Module C canonical one-card adoption for an existing unbound card; exact Published Workflow workspace mapping only, no fallback or data move.';

commit;
