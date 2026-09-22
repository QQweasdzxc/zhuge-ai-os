-- Module C Workflow v2 — explicit legacy-card reconciliation and retirement
--
-- This is an additive, authenticated, one-card-at-a-time bridge from the
-- pre-v2 unbound AI Board history to the Board-Instance-owned published
-- workflow.  It deliberately does not infer a step from a TASK id, title,
-- status, assignee, or workspace name.  The caller must provide the exact
-- published workflow version and completion step, plus the PM-approved
-- classification.  Cancelled cards remain cancelled and are archived in
-- place; they are never converted into completed work.

begin;

create or replace function public.board_c_workflow_reconcile_legacy_card_v2(
  p_task_id uuid,
  p_classification text,
  p_workflow_version_id uuid default null,
  p_completion_step_id uuid default null,
  p_reverification_evidence jsonb default null,
  p_note text default null,
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
  v_after jsonb;
  v_response jsonb;
  v_instance public.board_instances%rowtype;
  v_legacy_workspace public.board_workspaces%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_target_step public.board_workflow_steps%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_workflow_state public.board_instance_workflow_state%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_classification text := lower(btrim(coalesce(p_classification, '')));
  v_hash text := md5(concat_ws('|',
    p_task_id::text,
    lower(btrim(coalesce(p_classification, ''))),
    coalesce(p_workflow_version_id::text, ''),
    coalesce(p_completion_step_id::text, ''),
    coalesce(p_reverification_evidence::text, ''),
    coalesce(p_note, '')
  ));
  v_now timestamptz := clock_timestamp();
  v_action text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = '歷史卡片整理需要已登入的 PM 身分；卡片未變更。';
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
    and active
  for share;

  if not found
     or lower(coalesce(v_instance.template_key, '')) <> 'c'
     or lower(coalesce(v_instance.legacy_application_scope, '')) <> 'ai_board' then
    raise exception using
      errcode = '22023',
      message = '這張卡片不屬於可執行 AI Board Legacy Reconciliation 的 C 子板。';
  end if;

  select * into v_legacy_workspace
  from public.board_workspaces
  where id = v_task.workspace_id
    and board_instance_id = v_task.board_instance_id
    and workspace_key = 'done'
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = '這張卡片不在受控的 Legacy 工作區，未執行歷史整理。';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key
      and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using
          errcode = '40001',
          message = 'Legacy Reconciliation Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;

  if v_task.workflow_version_id is not null
     or v_task.current_workflow_step_id is not null then
    raise exception using
      errcode = '55000',
      message = '這張歷史卡片已存在流程綁定，不能重複套用 Legacy Reconciliation。';
  end if;

  if v_classification not in (
    'historical_completion_confirmed',
    'verified_complete',
    'cancelled'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Legacy Reconciliation 分類不受支援；卡片未變更。',
      detail = jsonb_build_object(
        'allowed', jsonb_build_array('historical_completion_confirmed', 'verified_complete', 'cancelled'),
        'received', v_classification
      )::text;
  end if;

  if v_classification = 'cancelled' then
    if v_task.status <> 'cancelled' then
      raise exception using
        errcode = '55000',
        message = '只有已正式標示為取消的卡片才能保留取消歷史；卡片未變更。';
    end if;

    v_before := to_jsonb(v_task);
    update public.board_tasks
    set archived_at = coalesce(archived_at, v_now),
        archived_by = coalesce(archived_by, auth.uid()),
        updated_at = v_now
    where id = v_task.id
    returning * into v_task;

    v_action := 'workflow_legacy_cancellation_reconciled';
    v_after := to_jsonb(v_task);
    v_response := jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'action', 'legacy-card-reconciliation',
      'classification', 'cancelled',
      'task_id', v_task.id,
      'board_instance_id', v_task.board_instance_id,
      'legacy_workspace_id', v_legacy_workspace.id,
      'state', 'cancelled_preserved',
      'card_mutation', 'archive_in_place_only',
      'before', v_before,
      'after', v_after,
      'audit_context', jsonb_build_object(
        'actor_id', auth.uid(),
        'occurred_at', v_now,
        'source_workspace_id', v_legacy_workspace.id,
        'action', 'preserve-cancelled-history'
      )
    );

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, v_action, v_before, v_after,
      coalesce(nullif(btrim(p_note), ''), '保留取消歷史並在原 Legacy 工作區封存；未轉為完成。'),
      auth.uid(), 'human', 'PM', 'system_activity'
    );

    if p_idempotency_key is not null then
      insert into private.board_workflow_action_idempotency (
        idempotency_key, action_type, board_instance_id, task_id,
        request_hash, response, status
      ) values (
        p_idempotency_key, 'legacy_card_reconciliation', v_task.board_instance_id,
        v_task.id, v_hash, v_response, 'completed'
      );
    end if;

    return v_response;
  end if;

  if v_task.status not in ('done', 'merged') then
    raise exception using
      errcode = '55000',
      message = '完成類歷史卡片尚未具備終止狀態，不能由本 Contract 猜測完成；卡片未變更。';
  end if;

  if p_workflow_version_id is null or p_completion_step_id is null then
    raise exception using
      errcode = '22023',
      message = '完成類 Legacy Reconciliation 必須指定已發布的流程版本與完成階段；卡片未變更。';
  end if;

  if v_classification = 'verified_complete' then
    if jsonb_typeof(p_reverification_evidence) <> 'object'
       or lower(coalesce(p_reverification_evidence->>'record_type', p_reverification_evidence->>'type', '')) <> 'reverification' then
      raise exception using
        errcode = '22023',
        message = '重新驗證完成的卡片必須附上明確標示為 Reverification 的現況證據；卡片未變更。';
    end if;
  end if;

  select * into v_definition
  from public.board_workflow_definitions
  where id = p_workflow_version_id
    and board_instance_id = v_task.board_instance_id
    and status = 'published'
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = '指定的流程版本不是此 AI Board 目前已發布的流程；卡片未變更。';
  end if;

  select * into v_workflow_state
  from public.board_instance_workflow_state
  where board_instance_id = v_task.board_instance_id
  for share;

  if not found or v_workflow_state.published_workflow_version_id <> v_definition.id then
    raise exception using
      errcode = '55000',
      message = '指定的流程版本不是此 AI Board 的正式 Published Workflow；卡片未變更。';
  end if;

  select * into v_target_step
  from public.board_workflow_steps
  where id = p_completion_step_id
    and workflow_version_id = v_definition.id
    and is_completion
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = '指定的完成階段不是該子板 Published Workflow 的 Completion Step；卡片未變更。';
  end if;

  select * into v_target_workspace
  from public.board_workspaces
  where id = v_target_step.workspace_id
    and board_instance_id = v_task.board_instance_id
    and active
  for share;

  if not found or v_target_workspace.id = v_legacy_workspace.id then
    raise exception using
      errcode = '55000',
      message = 'Published Workflow 的完成工作區無效或仍指向 Legacy 工作區；卡片未變更。';
  end if;

  v_before := to_jsonb(v_task);
  update public.board_tasks
  set workspace_id = v_target_workspace.id,
      workflow_version_id = v_definition.id,
      current_workflow_step_id = v_target_step.id,
      status = v_target_step.status_key,
      assignee = private.board_workflow_role_label(v_target_step.role_key),
      accepted_at = coalesce(accepted_at, v_now),
      accepted_by = coalesce(accepted_by, auth.uid()),
      completion_at = coalesce(completion_at, v_now),
      completion_by = coalesce(completion_by, auth.uid()),
      archive_due_at = coalesce(archive_due_at, v_now + interval '48 hours'),
      updated_at = v_now
  where id = v_task.id
  returning * into v_task;

  v_action := 'workflow_legacy_card_reconciled';
  v_after := to_jsonb(v_task);
  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'legacy-card-reconciliation',
    'classification', v_classification,
    'task_id', v_task.id,
    'board_instance_id', v_task.board_instance_id,
    'workflow_version_id', v_definition.id,
    'current_workflow_step_id', v_target_step.id,
    'source_workspace_id', v_legacy_workspace.id,
    'target_workspace_id', v_target_workspace.id,
    'status', v_task.status,
    'assignee', v_task.assignee,
    'preserved_terminal_metadata', jsonb_build_object(
      'resolution_action', v_task.resolution_action,
      'merged_into', v_task.merged_into,
      'accepted_at_before_reconciliation', v_before->'accepted_at',
      'completion_at_before_reconciliation', v_before->'completion_at',
      'archived_at', v_task.archived_at
    ),
    'reverification_evidence', case when v_classification = 'verified_complete' then p_reverification_evidence else null end,
    'audit_context', jsonb_build_object(
      'actor_id', auth.uid(),
      'occurred_at', v_now,
      'workflow_version_id', v_definition.id,
      'source_workspace_id', v_legacy_workspace.id,
      'target_workspace_id', v_target_workspace.id,
      'action', 'reconcile-legacy-card-to-published-completion',
      'evidence_record_type', case when v_classification = 'verified_complete' then 'reverification' else 'historical_completion' end
    ),
    'before', v_before,
    'after', v_after
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, v_action, v_before, v_response,
    coalesce(nullif(btrim(p_note), ''), '依 PM 核准分類逐卡整理至此子板 Published Workflow 的正式完成階段。'),
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key, 'legacy_card_reconciliation', v_task.board_instance_id,
      v_task.id, v_hash, v_response, 'completed'
    );
  end if;

  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_retire_legacy_workspace_v2(
  p_workspace_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_workspace public.board_workspaces%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_instance public.board_instances%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_hash text := md5(p_workspace_id::text);
  v_now timestamptz := clock_timestamp();
  v_active_nonterminal_count integer;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Legacy 工作區退休需要已登入的 PM 身分；工作區未變更。';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = '找不到指定工作區；工作區未變更。';
  end if;

  if not public.board_instance_can_write(v_workspace.board_instance_id) then
    raise exception using
      errcode = '42501',
      message = '目前登入身分沒有此工作區的管理權限；工作區未變更。';
  end if;

  select * into v_instance
  from public.board_instances
  where id = v_workspace.board_instance_id
    and active
  for share;

  if not found
     or lower(coalesce(v_instance.template_key, '')) <> 'c'
     or lower(coalesce(v_instance.legacy_application_scope, '')) <> 'ai_board'
     or v_workspace.workspace_key <> 'done' then
    raise exception using
      errcode = '22023',
      message = '只有 AI Board 的受控 Legacy 工作區可由此 Contract 退休。';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key
      and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using
          errcode = '40001',
          message = 'Legacy Workspace Retirement Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;

  if exists (
    select 1
    from public.board_workflow_steps s
    join public.board_workflow_definitions d on d.id = s.workflow_version_id
    where d.board_instance_id = v_workspace.board_instance_id
      and d.status = 'published'
      and s.workspace_id = v_workspace.id
  ) then
    raise exception using
      errcode = '55000',
      message = '此工作區目前仍在 Published Workflow 中使用，請先至流程設定調整流程；工作區未變更。';
  end if;

  select count(*) into v_active_nonterminal_count
  from public.board_tasks
  where workspace_id = v_workspace.id
    and archived_at is null
    and status not in ('done', 'cancelled', 'merged');

  if v_active_nonterminal_count > 0 then
    raise exception using
      errcode = '55000',
      message = format('此工作區仍有 %s 張未完成工作卡片，不能自動搬到待辦；請先完成正式 Reconciliation。', v_active_nonterminal_count),
      detail = jsonb_build_object(
        'active_nonterminal_cards', v_active_nonterminal_count,
        'fallback_move_to_todo', false
      )::text;
  end if;

  if not v_workspace.active then
    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'action', 'legacy-workspace-retirement',
      'workspace_id', v_workspace.id,
      'state', 'already_retired',
      'card_mutation', 0
    );
  end if;

  v_before := to_jsonb(v_workspace);
  update public.board_workspaces
  set active = false,
      archived_at = coalesce(archived_at, v_now),
      updated_by = auth.uid(),
      updated_at = v_now
  where id = v_workspace.id
  returning * into v_workspace;

  v_after := to_jsonb(v_workspace);
  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'legacy-workspace-retirement',
    'workspace_id', v_workspace.id,
    'board_instance_id', v_workspace.board_instance_id,
    'workspace_key', v_workspace.workspace_key,
    'state', 'retired',
    'card_mutation', 0,
    'guard_checks', jsonb_build_object(
      'published_workflow_references', 0,
      'active_nonterminal_cards', v_active_nonterminal_count,
      'fallback_move_to_todo', false
    ),
    'before', v_before,
    'after', v_after,
    'audit_context', jsonb_build_object(
      'actor_id', auth.uid(),
      'occurred_at', v_now,
      'action', 'retire-legacy-workspace-softly'
    )
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workspace', v_workspace.id::text, 'workflow_legacy_workspace_retired',
    v_before, v_response,
    'Legacy 工作區已安全退休；未搬移、刪除或重建任何工作卡片。',
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key, 'legacy_workspace_retirement', v_workspace.board_instance_id,
      null, v_hash, v_response, 'completed'
    );
  end if;

  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_reconcile_legacy_card_v2(uuid, text, uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.board_c_workflow_retire_legacy_workspace_v2(uuid, text) from public, anon;
grant execute on function public.board_c_workflow_reconcile_legacy_card_v2(uuid, text, uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.board_c_workflow_retire_legacy_workspace_v2(uuid, text) to authenticated;

comment on function public.board_c_workflow_reconcile_legacy_card_v2(uuid, text, uuid, uuid, jsonb, text, text)
  is 'Module C canonical, authenticated, one-card-at-a-time reconciliation for explicitly classified pre-v2 AI Board history; never infers or batch-migrates cards.';
comment on function public.board_c_workflow_retire_legacy_workspace_v2(uuid, text)
  is 'Module C canonical soft retirement for an unused AI Board legacy workspace; never moves populated cards to todo.';

commit;
