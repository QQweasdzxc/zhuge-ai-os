-- Module C instance/workflow-scoped completion archive foundation (P2).
--
-- This migration adds a canonical resolver and an idempotent, scoped archive
-- reconciler. Existing Consumer writers and the global legacy reconciler are
-- intentionally not switched in P2.

begin;

create or replace function private.board_c_completion_archive_scope(
  p_board_instance_id uuid,
  p_workflow_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_completion_step public.board_workflow_steps%rowtype;
  v_completion_workspace public.board_workspaces%rowtype;
  v_policy private.module_c_completion_archive_policies%rowtype;
begin
  if p_board_instance_id is null then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 缺少 Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_REQUIRED'
      )::text;
  end if;

  if p_workflow_version_id is null then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 缺少 Published Workflow；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_REQUIRED',
        'board_instance_id', p_board_instance_id
      )::text;
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 找不到啟用中的 Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_UNAVAILABLE',
        'board_instance_id', p_board_instance_id
      )::text;
  end if;

  select *
    into v_state
    from public.board_instance_workflow_state
   where board_instance_id = p_board_instance_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = '此 Board Instance 尚未建立 Workflow Scope；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_STATE_REQUIRED',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id
      )::text;
  end if;

  select *
    into v_definition
    from public.board_workflow_definitions
   where id = p_workflow_version_id
     and board_instance_id = p_board_instance_id
     and status in ('published', 'retired')
     and published_at is not null;

  if not found then
    raise exception using
      errcode = '55000',
      message = '指定的 Workflow 不是此 Board Instance 的已發布流程版本；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_BINDING_INVALID',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id
      )::text;
  end if;

  -- A currently published version must be the Instance's published pointer.
  -- A retired version remains valid only as an immutable historical binding
  -- for cards that adopted it while it was published.
  if v_definition.status = 'published'
     and v_state.published_workflow_version_id is distinct from v_definition.id then
    raise exception using
      errcode = '55000',
      message = 'Published Workflow 與 Board Instance 的正式指標不一致；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_PUBLISHED_POINTER_MISMATCH',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id,
        'published_workflow_version_id', v_state.published_workflow_version_id
      )::text;
  end if;

  select *
    into v_completion_step
    from public.board_workflow_steps
   where workflow_version_id = v_definition.id
     and is_completion = true;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Published Workflow 沒有唯一的 Completion Step；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_COMPLETION_STEP_REQUIRED',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', v_definition.id
      )::text;
  end if;

  select *
    into v_completion_workspace
    from public.board_workspaces
   where id = v_completion_step.workspace_id
     and board_instance_id = p_board_instance_id
     and active = true
     and archived_at is null;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Completion Step 對應的 Workspace 無效或未啟用；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_COMPLETION_WORKSPACE_INVALID',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', v_definition.id,
        'completion_step_id', v_completion_step.id,
        'completion_workspace_id', v_completion_step.workspace_id
      )::text;
  end if;

  select *
    into v_policy
    from private.module_c_completion_archive_policies
   where policy_key = 'completion_archive'
     and status = 'published'
   order by policy_version desc
   limit 1;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Module C Completion Archive Policy 不可用；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_POLICY_UNAVAILABLE'
      )::text;
  end if;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'scope', 'board-instance+published-workflow-version',
    'board_instance_id', v_instance.id,
    'workflow_version_id', v_definition.id,
    'workflow_status', v_definition.status,
    'workflow_version_no', v_definition.version_no,
    'published_workflow_version_id', v_state.published_workflow_version_id,
    'completion_step_id', v_completion_step.id,
    'completion_step_name', v_completion_step.name,
    'completion_workspace_id', v_completion_workspace.id,
    'completion_workspace_name', v_completion_workspace.name,
    'policy_identity', v_policy.policy_identity,
    'policy_key', v_policy.policy_key,
    'policy_version', v_policy.policy_version,
    'archive_delay_seconds', v_policy.archive_delay_seconds,
    'policy_source', v_policy.policy_source,
    'existing_due_at_retroactive', false,
    'scope_verified', true
  );
end;
$function$;

revoke all on function private.board_c_completion_archive_scope(uuid, uuid) from public, anon, authenticated;

create or replace function private.board_c_completion_archive_context(
  p_task_id uuid,
  p_board_instance_id uuid default null,
  p_workflow_version_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_current_workspace public.board_workspaces%rowtype;
  v_scope jsonb;
begin
  if p_task_id is null then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 缺少卡片識別資訊；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_TASK_REQUIRED'
      )::text;
  end if;

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '找不到指定卡片的 Cloud 資料；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_TASK_NOT_FOUND',
        'task_id', p_task_id
      )::text;
  end if;

  if p_board_instance_id is not null
     and v_task.board_instance_id is distinct from p_board_instance_id then
    raise exception using
      errcode = '55000',
      message = '卡片與指定 Board Instance 不一致；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_MISMATCH',
        'task_id', p_task_id,
        'task_board_instance_id', v_task.board_instance_id,
        'requested_board_instance_id', p_board_instance_id
      )::text;
  end if;

  if v_task.board_instance_id is null or v_task.workflow_version_id is null then
    raise exception using
      errcode = '55000',
      message = '卡片尚未具備正式 Board Instance／Workflow binding；Runtime 不會猜測。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', case when v_task.board_instance_id is null then 'C_ARCHIVE_INSTANCE_REQUIRED' else 'C_ARCHIVE_WORKFLOW_REQUIRED' end,
        'task_id', p_task_id,
        'board_instance_id', v_task.board_instance_id,
        'workflow_version_id', v_task.workflow_version_id
      )::text;
  end if;

  if p_workflow_version_id is not null
     and v_task.workflow_version_id is distinct from p_workflow_version_id then
    raise exception using
      errcode = '55000',
      message = '卡片與指定 Published Workflow 不一致；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_MISMATCH',
        'task_id', p_task_id,
        'task_workflow_version_id', v_task.workflow_version_id,
        'requested_workflow_version_id', p_workflow_version_id
      )::text;
  end if;

  v_scope := private.board_c_completion_archive_scope(v_task.board_instance_id, v_task.workflow_version_id);

  select *
    into v_current_step
    from public.board_workflow_steps
   where id = v_task.current_workflow_step_id
     and workflow_version_id = v_task.workflow_version_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = '卡片目前階段不屬於其 Published Workflow；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_CURRENT_STEP_INVALID',
        'task_id', p_task_id,
        'workflow_version_id', v_task.workflow_version_id,
        'current_workflow_step_id', v_task.current_workflow_step_id
      )::text;
  end if;

  select *
    into v_current_workspace
    from public.board_workspaces
   where id = v_current_step.workspace_id
     and board_instance_id = v_task.board_instance_id
     and active = true
     and archived_at is null;

  if not found or v_current_step.workspace_id is distinct from v_task.workspace_id then
    raise exception using
      errcode = '55000',
      message = '卡片 Workspace 與 Published Workflow Step 不一致；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_CURRENT_WORKSPACE_MISMATCH',
        'task_id', p_task_id,
        'task_workspace_id', v_task.workspace_id,
        'step_workspace_id', v_current_step.workspace_id
      )::text;
  end if;

  return v_scope || jsonb_build_object(
    'task_id', v_task.id,
    'current_step_id', v_current_step.id,
    'current_step_name', v_current_step.name,
    'current_workspace_id', v_current_workspace.id,
    'current_workspace_name', v_current_workspace.name,
    'completion_at', v_task.completion_at,
    'archive_due_at', v_task.archive_due_at,
    'archived_at', v_task.archived_at,
    'card_identity_preserved', true
  );
end;
$function$;

revoke all on function private.board_c_completion_archive_context(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.board_c_resolve_completion_archive_context(
  p_task_id uuid,
  p_board_instance_id uuid default null,
  p_workflow_version_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.uid() is null or not public.board_task_can_read(p_task_id) then
    raise exception using
      errcode = '42501',
      message = '沒有讀取此卡片 Completion Archive Context 的權限；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_READ_FORBIDDEN',
        'task_id', p_task_id
      )::text;
  end if;

  return private.board_c_completion_archive_context(
    p_task_id,
    p_board_instance_id,
    p_workflow_version_id
  );
end;
$function$;

revoke all on function public.board_c_resolve_completion_archive_context(uuid, uuid, uuid) from public, anon;
grant execute on function public.board_c_resolve_completion_archive_context(uuid, uuid, uuid) to authenticated;

create or replace function public.board_c_reconcile_completion_archive_lifecycle_v2(
  p_board_instance_id uuid,
  p_workflow_version_id uuid default null,
  p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_state public.board_instance_workflow_state%rowtype;
  v_workflow_version_id uuid;
  v_scope jsonb;
  v_candidate public.board_tasks%rowtype;
  v_archived public.board_tasks%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_archived_ids uuid[] := array[]::uuid[];
  v_archived_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_completion_step_id uuid;
begin
  if auth.uid() is null
     or p_board_instance_id is null
     or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using
      errcode = '42501',
      message = '沒有執行此 Board Instance Archive Reconciliation 的權限；資料未變更。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_RECONCILE_FORBIDDEN',
        'board_instance_id', p_board_instance_id
      )::text;
  end if;

  if p_workflow_version_id is null then
    select *
      into v_state
      from public.board_instance_workflow_state
     where board_instance_id = p_board_instance_id;
    if not found or v_state.published_workflow_version_id is null then
      raise exception using
        errcode = '55000',
        message = '此 Board Instance 沒有 Published Workflow；資料未變更。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'capability', 'completion-archive-lifecycle',
          'error_code', 'C_ARCHIVE_WORKFLOW_REQUIRED',
          'board_instance_id', p_board_instance_id
        )::text;
    end if;
    v_workflow_version_id := v_state.published_workflow_version_id;
  else
    v_workflow_version_id := p_workflow_version_id;
  end if;

  v_scope := private.board_c_completion_archive_scope(
    p_board_instance_id,
    v_workflow_version_id
  );
  v_completion_step_id := (v_scope->>'completion_step_id')::uuid;

  if p_task_id is not null then
    -- Validate the explicit card binding before allowing the targeted path.
    perform private.board_c_completion_archive_context(
      p_task_id,
      p_board_instance_id,
      v_workflow_version_id
    );
  end if;

  for v_candidate in
    select task.*
      from public.board_tasks task
     where task.board_instance_id = p_board_instance_id
       and task.workflow_version_id = v_workflow_version_id
       and task.current_workflow_step_id = v_completion_step_id
       and task.completion_at is not null
       and task.archive_due_at is not null
       and task.archive_due_at <= v_now
       and task.archived_at is null
       and (p_task_id is null or task.id = p_task_id)
     order by task.id
     for update skip locked
  loop
    v_before := to_jsonb(v_candidate);
    update public.board_tasks
       set archived_at = v_now,
           archived_by = null,
           updated_at = v_now
     where id = v_candidate.id
       and archived_at is null
       and archive_due_at is not null
       and archive_due_at <= v_now
    returning * into v_archived;

    if found then
      v_archived_count := v_archived_count + 1;
      v_archived_ids := array_append(v_archived_ids, v_archived.id);
      v_after := to_jsonb(v_archived) || jsonb_build_object('archive_context', v_scope);
      insert into public.engineering_activity_log (
        entity_type,
        entity_id,
        action,
        before_data,
        after_data,
        note,
        actor_id,
        actor_type,
        actor_label,
        activity_type
      ) values (
        'board_task',
        v_archived.id::text,
        'task_auto_archived',
        v_before,
        v_after,
        'Module C instance-scoped completion archive reconciliation',
        null,
        'system',
        'Module C',
        'system_activity'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'action', 'reconcile-completion-archive',
    'state', 'reconciled',
    'board_instance_id', p_board_instance_id,
    'workflow_version_id', v_workflow_version_id,
    'completion_step_id', v_completion_step_id,
    'completion_workspace_id', v_scope->>'completion_workspace_id',
    'policy_identity', v_scope->>'policy_identity',
    'policy_version', (v_scope->>'policy_version')::integer,
    'archive_delay_seconds', (v_scope->>'archive_delay_seconds')::bigint,
    'archived_count', v_archived_count,
    'task_ids', to_jsonb(v_archived_ids),
    'idempotent', true,
    'atomic', true,
    'scope_verified', true,
    'existing_due_at_retroactive', false
  );
end;
$function$;

revoke all on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) from public, anon;
grant execute on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) to authenticated;

comment on function public.board_c_resolve_completion_archive_context(uuid, uuid, uuid) is
  'Authenticated Module C resolver for Board Instance and immutable Published Workflow completion/archive context.';
comment on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) is
  'Authenticated instance/workflow-scoped and idempotent Module C completion archive reconciliation; not a Consumer-specific lifecycle.';

notify pgrst, 'reload schema';

commit;
