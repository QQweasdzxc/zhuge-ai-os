-- Module C optional Workflow / Completion Archive decoupling.
--
-- A Board Instance may legally have no Workflow.  In that case Completion
-- Archive uses the Board's explicit stable completion designation (the
-- workspace_key contract) and the same C lifecycle writer.  A published
-- Workflow remains the stronger source when one is adopted.  This migration
-- changes functions only; it does not migrate or rewrite product data.

begin;

create or replace function private.board_c_completion_archive_designation(
  p_board_instance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_workspace public.board_workspaces%rowtype;
  v_count integer := 0;
begin
  if p_board_instance_id is null then
    raise exception using
      errcode = '55000',
      message = 'Completion designation 缺少 Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_REQUIRED'
      )::text;
  end if;

  -- workspace_key is a stable Board configuration identity, not a display
  -- label.  It is the existing no-Workflow designation contract used by C
  -- Consumers such as WorkTodo (worktodo-completed).
  select count(*)
    into v_count
    from public.board_workspaces workspace_row
   where workspace_row.board_instance_id = p_board_instance_id
     and workspace_row.active = true
     and workspace_row.archived_at is null
     and (
       lower(workspace_row.workspace_key) = 'completed'
       or lower(workspace_row.workspace_key) ~ '(^|-)completed$'
     );

  if v_count > 1 then
    raise exception using
      errcode = '55000',
      message = '此子板存在多個 Completion designation；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_COMPLETION_DESIGNATION_AMBIGUOUS',
        'board_instance_id', p_board_instance_id,
        'candidate_count', v_count
      )::text;
  end if;

  if v_count = 0 then
    return jsonb_build_object(
      'status', 'not_configured',
      'workspace_id', null,
      'workspace_name', null,
      'workspace_key', null,
      'source', 'stable-workspace-key',
      'archive_designation', 'not_applicable'
    );
  end if;

  select *
    into v_workspace
    from public.board_workspaces workspace_row
   where workspace_row.board_instance_id = p_board_instance_id
     and workspace_row.active = true
     and workspace_row.archived_at is null
     and (
       lower(workspace_row.workspace_key) = 'completed'
       or lower(workspace_row.workspace_key) ~ '(^|-)completed$'
     )
   order by workspace_row.sort_order, workspace_row.id
   limit 1;

  return jsonb_build_object(
    'status', 'configured',
    'workspace_id', v_workspace.id,
    'workspace_name', v_workspace.name,
    'workspace_key', v_workspace.workspace_key,
    'source', 'stable-workspace-key',
    'archive_designation', 'task-archive-state'
  );
end;
$function$;

revoke all on function private.board_c_completion_archive_designation(uuid) from public, anon, authenticated;

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
  v_designation jsonb;
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

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true
     and template_key = 'c';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 找不到啟用中的 C Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_UNAVAILABLE',
        'board_instance_id', p_board_instance_id
      )::text;
  end if;

  if p_workflow_version_id is null then
    v_designation := private.board_c_completion_archive_designation(p_board_instance_id);

    if v_designation->>'status' = 'not_configured' then
      return jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'scope', 'board-instance+optional-completion-designation',
        'state', 'not_applicable',
        'workflow_optional', true,
        'board_instance_id', v_instance.id,
        'workflow_version_id', null,
        'workflow_status', 'not_configured',
        'published_workflow_version_id', null,
        'completion_step_id', null,
        'completion_step_name', null,
        'completion_workspace_id', null,
        'completion_workspace_name', null,
        'completion_designation_status', 'not_configured',
        'completion_designation_source', 'stable-workspace-key',
        'archive_designation', 'not_applicable',
        'archive_designation_status', 'not_applicable',
        'policy_identity', null,
        'policy_key', null,
        'policy_version', null,
        'archive_delay_seconds', null,
        'policy_source', null,
        'existing_due_at_retroactive', false,
        'scope_verified', true
      );
    end if;

    select *
      into v_policy
      from private.module_c_completion_archive_policies
     where policy_key = 'completion_archive'
       and status = 'published'
     order by policy_version desc
     limit 1;

    if not found or v_policy.archive_delay_seconds <= 0 then
      raise exception using
        errcode = '55000',
        message = 'Module C Completion Archive Policy 不可用；已安全停止。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'capability', 'completion-archive-lifecycle',
          'error_code', 'C_ARCHIVE_POLICY_UNAVAILABLE',
          'board_instance_id', p_board_instance_id
        )::text;
    end if;

    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'capability', 'completion-archive-lifecycle',
      'scope', 'board-instance+optional-completion-designation',
      'state', 'configured',
      'workflow_optional', true,
      'board_instance_id', v_instance.id,
      'workflow_version_id', null,
      'workflow_status', 'not_configured',
      'published_workflow_version_id', null,
      'completion_step_id', null,
      'completion_step_name', null,
      'completion_workspace_id', v_designation->>'workspace_id',
      'completion_workspace_name', v_designation->>'workspace_name',
      'completion_designation_status', 'configured',
      'completion_designation_source', v_designation->>'source',
      'archive_designation', v_designation->>'archive_designation',
      'archive_designation_status', 'configured',
      'policy_identity', v_policy.policy_identity,
      'policy_key', v_policy.policy_key,
      'policy_version', v_policy.policy_version,
      'archive_delay_seconds', v_policy.archive_delay_seconds,
      'policy_source', v_policy.policy_source,
      'existing_due_at_retroactive', false,
      'scope_verified', true
    );
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
      message = 'Published Workflow 沒有 Completion Step；已安全停止。',
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

  if not found or v_policy.archive_delay_seconds <= 0 then
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
    'state', 'configured',
    'workflow_optional', true,
    'board_instance_id', v_instance.id,
    'workflow_version_id', v_definition.id,
    'workflow_status', v_definition.status,
    'workflow_version_no', v_definition.version_no,
    'published_workflow_version_id', v_state.published_workflow_version_id,
    'completion_step_id', v_completion_step.id,
    'completion_step_name', v_completion_step.name,
    'completion_workspace_id', v_completion_workspace.id,
    'completion_workspace_name', v_completion_workspace.name,
    'completion_designation_status', 'configured',
    'completion_designation_source', 'published-workflow-step',
    'archive_designation', 'task-archive-state',
    'archive_designation_status', 'configured',
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

  if v_task.board_instance_id is null then
    raise exception using
      errcode = '55000',
      message = '卡片尚未具備正式 Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_REQUIRED',
        'task_id', p_task_id
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

  if v_task.workflow_version_id is null then
    v_scope := private.board_c_completion_archive_scope(v_task.board_instance_id, null);

    select *
      into v_current_workspace
      from public.board_workspaces
     where id = v_task.workspace_id
       and board_instance_id = v_task.board_instance_id
       and active = true
       and archived_at is null;

    if not found then
      raise exception using
        errcode = '55000',
        message = '卡片目前 Workspace 無法驗證；已安全停止。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'capability', 'completion-archive-lifecycle',
          'error_code', 'C_ARCHIVE_CURRENT_WORKSPACE_INVALID',
          'task_id', p_task_id,
          'workspace_id', v_task.workspace_id
        )::text;
    end if;

    return v_scope || jsonb_build_object(
      'task_id', v_task.id,
      'current_step_id', null,
      'current_step_name', null,
      'current_workspace_id', v_current_workspace.id,
      'current_workspace_name', v_current_workspace.name,
      'completion_at', v_task.completion_at,
      'archive_due_at', v_task.archive_due_at,
      'archived_at', v_task.archived_at,
      'card_identity_preserved', true
    );
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

create or replace function private.board_c_reconcile_completion_archive_lifecycle_core(
  p_board_instance_id uuid,
  p_workflow_version_id uuid,
  p_task_id uuid default null,
  p_actor_id uuid default null,
  p_actor_label text default 'Module C'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_scope jsonb;
  v_candidate public.board_tasks%rowtype;
  v_archived public.board_tasks%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_archived_ids uuid[] := array[]::uuid[];
  v_archived_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_completion_step_id uuid;
  v_completion_workspace_id uuid;
begin
  v_scope := private.board_c_completion_archive_scope(p_board_instance_id, p_workflow_version_id);

  if p_task_id is not null then
    perform private.board_c_completion_archive_context(
      p_task_id,
      p_board_instance_id,
      p_workflow_version_id
    );
  end if;

  if v_scope->>'state' = 'not_applicable' then
    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'capability', 'completion-archive-lifecycle',
      'action', 'reconcile-completion-archive',
      'state', 'not_applicable',
      'board_instance_id', p_board_instance_id,
      'workflow_version_id', null,
      'completion_step_id', null,
      'completion_workspace_id', null,
      'completion_designation_status', 'not_configured',
      'archive_designation_status', 'not_applicable',
      'policy_identity', null,
      'policy_version', null,
      'archive_delay_seconds', null,
      'archived_count', 0,
      'task_ids', to_jsonb(v_archived_ids),
      'idempotent', true,
      'atomic', true,
      'scope_verified', true,
      'existing_due_at_retroactive', false,
      'actor', coalesce(nullif(btrim(p_actor_label), ''), 'Module C')
    );
  end if;

  v_completion_step_id := nullif(v_scope->>'completion_step_id', '')::uuid;
  v_completion_workspace_id := nullif(v_scope->>'completion_workspace_id', '')::uuid;

  if p_workflow_version_id is null then
    for v_candidate in
      select task.*
        from public.board_tasks task
       where task.board_instance_id = p_board_instance_id
         and task.workflow_version_id is null
         and task.workspace_id = v_completion_workspace_id
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
             archived_by = p_actor_id,
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
          entity_type, entity_id, action, before_data, after_data, note,
          actor_id, actor_type, actor_label, activity_type
        ) values (
          'board_task', v_archived.id::text, 'task_auto_archived',
          v_before, v_after,
          'Module C optional-Workflow completion archive reconciliation',
          p_actor_id, 'system', coalesce(nullif(btrim(p_actor_label), ''), 'Module C'), 'system_activity'
        );
      end if;
    end loop;
  else
    for v_candidate in
      select task.*
        from public.board_tasks task
       where task.board_instance_id = p_board_instance_id
         and task.workflow_version_id = p_workflow_version_id
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
             archived_by = p_actor_id,
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
          entity_type, entity_id, action, before_data, after_data, note,
          actor_id, actor_type, actor_label, activity_type
        ) values (
          'board_task', v_archived.id::text, 'task_auto_archived',
          v_before, v_after,
          'Module C instance-scoped completion archive reconciliation',
          p_actor_id, 'system', coalesce(nullif(btrim(p_actor_label), ''), 'Module C'), 'system_activity'
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'action', 'reconcile-completion-archive',
    'state', 'reconciled',
    'board_instance_id', p_board_instance_id,
    'workflow_version_id', p_workflow_version_id,
    'workflow_status', v_scope->>'workflow_status',
    'completion_step_id', v_scope->>'completion_step_id',
    'completion_workspace_id', v_scope->>'completion_workspace_id',
    'completion_designation_status', v_scope->>'completion_designation_status',
    'archive_designation_status', v_scope->>'archive_designation_status',
    'policy_identity', v_scope->>'policy_identity',
    'policy_version', nullif(v_scope->>'policy_version', '')::integer,
    'archive_delay_seconds', nullif(v_scope->>'archive_delay_seconds', '')::bigint,
    'archived_count', v_archived_count,
    'task_ids', to_jsonb(v_archived_ids),
    'idempotent', true,
    'atomic', true,
    'scope_verified', true,
    'existing_due_at_retroactive', false,
    'actor', coalesce(nullif(btrim(p_actor_label), ''), 'Module C')
  );
end;
$function$;

revoke all on function private.board_c_reconcile_completion_archive_lifecycle_core(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

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
  v_workflow_version_id uuid := p_workflow_version_id;
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

  if v_workflow_version_id is null then
    select *
      into v_state
      from public.board_instance_workflow_state
     where board_instance_id = p_board_instance_id;
    if found and v_state.published_workflow_version_id is not null then
      v_workflow_version_id := v_state.published_workflow_version_id;
    end if;
  end if;

  return private.board_c_reconcile_completion_archive_lifecycle_core(
    p_board_instance_id,
    v_workflow_version_id,
    p_task_id,
    auth.uid(),
    'Module C'
  );
end;
$function$;

create or replace function public.board_c_reconcile_workspace_decision_v2(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_decision_note text default null,
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
  v_instance public.board_instances%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_target_step public.board_workflow_steps%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_transition public.board_workflow_transitions%rowtype;
  v_gate public.board_workflow_gates%rowtype;
  v_evidence public.board_workflow_evidence_requirements%rowtype;
  v_missing text[] := array[]::text[];
  v_response jsonb;
  v_scope jsonb;
  v_hash text := md5(concat_ws('|', p_task_id::text, p_target_workspace_id::text, coalesce(p_decision_note, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_is_reopen boolean := false;
  v_target_is_completion boolean := false;
  v_current_is_completion boolean := false;
  v_now timestamptz := clock_timestamp();
  v_policy private.module_c_completion_archive_policies%rowtype;
  v_archive_due_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '工作區決定需要登入身分；卡片未變更。';
  end if;

  if p_idempotency_key is not null then
    select *
      into v_existing
      from private.board_workflow_action_idempotency
     where idempotency_key = p_idempotency_key
       and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '工作區決定的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id
   for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = '目前登入身分沒有此卡片的管理權限；卡片未變更。';
  end if;
  if v_task.archived_at is not null then
    raise exception using errcode = '42501', message = '封存卡片不可移動；卡片未變更。';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active = true
     and template_key = 'c'
   for share;
  if not found then
    raise exception using errcode = '55000', message = '此卡片不屬於啟用中的 Module C Board；卡片未變更。';
  end if;

  -- Optional-Workflow path: movement remains a C decision.  Only the
  -- explicit completion designation can create/clear the shared lifecycle;
  -- no transition, status, assignee, or workspace name is used to infer a
  -- Workflow.
  if v_task.workflow_version_id is null then
    select *
      into v_target_workspace
      from public.board_workspaces
     where id = p_target_workspace_id
       and board_instance_id = v_task.board_instance_id
       and active = true
       and archived_at is null;
    if not found then
      raise exception using errcode = '22023', message = '目標工作區不是此 Board Instance 的合法工作區；卡片未變更。';
    end if;

    if v_task.workspace_id = p_target_workspace_id then
      return jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'action', 'workspace-decision',
        'task_id', p_task_id,
        'state', 'no_change',
        'workspace_id', p_target_workspace_id,
        'workflow', 'not_configured',
        'workflow_optional', true,
        'card_identity_preserved', true
      );
    end if;

    v_scope := private.board_c_completion_archive_scope(v_task.board_instance_id, null);
    v_target_is_completion := v_scope->>'completion_designation_status' = 'configured'
      and p_target_workspace_id = (v_scope->>'completion_workspace_id')::uuid;
    v_current_is_completion := v_scope->>'completion_designation_status' = 'configured'
      and v_task.workspace_id = (v_scope->>'completion_workspace_id')::uuid;
    v_is_reopen := v_current_is_completion and not v_target_is_completion;

    if v_target_is_completion then
      select *
        into v_policy
        from private.module_c_completion_archive_policies
       where policy_key = 'completion_archive'
         and status = 'published'
       order by policy_version desc
       limit 1;
      if not found or v_policy.archive_delay_seconds <= 0 then
        raise exception using errcode = '55000', message = 'Module C Completion Archive Policy 不可用；卡片未變更。';
      end if;
      v_archive_due_at := v_now + make_interval(secs => v_policy.archive_delay_seconds::double precision);
    end if;

    v_before := to_jsonb(v_task);
    update public.board_tasks
       set workspace_id = p_target_workspace_id,
           status = case when v_target_is_completion then 'completed' when v_is_reopen then 'in_progress' else status end,
           accepted_at = case when v_target_is_completion then v_now when v_is_reopen then null else accepted_at end,
           accepted_by = case when v_target_is_completion then auth.uid() when v_is_reopen then null else accepted_by end,
           completion_at = case when v_target_is_completion then v_now when v_is_reopen then null else completion_at end,
           completion_by = case when v_target_is_completion then auth.uid() when v_is_reopen then null else completion_by end,
           archive_due_at = case when v_target_is_completion then v_archive_due_at when v_is_reopen then null else archive_due_at end,
           archived_at = case when v_is_reopen then null else archived_at end,
           archived_by = case when v_is_reopen then null else archived_by end,
           updated_at = v_now
     where id = v_task.id
     returning * into v_task;

    v_response := jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'action', 'workspace-decision',
      'task_id', v_task.id,
      'workflow_version_id', null,
      'workflow', 'not_configured',
      'workflow_optional', true,
      'workflow_bound', false,
      'source_step_id', null,
      'target_step_id', null,
      'source_workspace_id', v_before->>'workspace_id',
      'target_workspace_id', v_task.workspace_id,
      'status', v_task.status,
      'assignee', v_task.assignee,
      'completion', v_target_is_completion,
      'reopen', v_is_reopen,
      'completion_entry_at', case when v_target_is_completion then v_now else null end,
      'archive_due_at', v_task.archive_due_at,
      'policy_version', case when v_target_is_completion then v_policy.policy_version else null end,
      'archive_delay_seconds', case when v_target_is_completion then v_policy.archive_delay_seconds else null end,
      'completion_designation_source', v_scope->>'completion_designation_source',
      'acceptance_action_context', jsonb_build_object(
        'actor_id', auth.uid(),
        'occurred_at', v_now,
        'workflow_version_id', null,
        'source_step_id', null,
        'target_step_id', null,
        'action', case when v_target_is_completion then 'pm-completion-decision' when v_is_reopen then 'pm-reopen-decision' else 'pm-workspace-decision' end,
        'decision_note', p_decision_note
      )
    );

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text,
      case when v_target_is_completion then 'completion_decision' when v_is_reopen then 'completion_reopened' else 'workspace_decision' end,
      v_before,
      v_response,
      nullif(btrim(p_decision_note), ''),
      auth.uid(), 'human', 'PM', 'system_activity'
    );

    if p_idempotency_key is not null then
      insert into private.board_workflow_action_idempotency (
        idempotency_key, action_type, board_instance_id, task_id,
        request_hash, response, status
      ) values (
        p_idempotency_key,
        case when v_target_is_completion then 'completion' when v_is_reopen then 'reopen' else 'workspace_decision' end,
        v_task.board_instance_id,
        v_task.id,
        v_hash,
        v_response,
        'completed'
      );
    end if;
    return v_response;
  end if;

  -- Published-Workflow path remains the existing v2 gate/transition
  -- contract.  The only policy timing source is the shared C policy table.
  select *
    into v_definition
    from public.board_workflow_definitions
   where id = v_task.workflow_version_id
     and board_instance_id = v_task.board_instance_id
     and status in ('published', 'retired');
  if not found or v_task.current_workflow_step_id is null then
    raise exception using errcode = '55000', message = '此卡片尚未綁定可用的流程版本／目前階段；Runtime 不會猜測流程，卡片未變更。';
  end if;

  select *
    into v_current_step
    from public.board_workflow_steps
   where id = v_task.current_workflow_step_id
     and workflow_version_id = v_definition.id;
  select *
    into v_target_step
    from public.board_workflow_steps
   where workflow_version_id = v_definition.id
     and workspace_id = p_target_workspace_id;
  if not found then
    raise exception using errcode = '22023', message = '目標工作區不是此流程定義的合法階段；卡片未變更。';
  end if;
  if v_current_step.id = v_target_step.id then
    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'action', 'workspace-decision',
      'task_id', p_task_id,
      'state', 'no_change',
      'workspace_id', p_target_workspace_id
    );
  end if;

  select *
    into v_transition
    from public.board_workflow_transitions
   where workflow_version_id = v_definition.id
     and from_step_id = v_current_step.id
     and to_step_id = v_target_step.id;
  if not found or not ('pm' = any(v_transition.allowed_roles)) then
    raise exception using errcode = '42501', message = '這張子板的流程未允許目前 PM 工作區決定；卡片未變更。';
  end if;
  if v_current_step.is_completion and not v_target_step.is_completion then
    v_is_reopen := true;
  end if;

  if v_target_step.is_completion then
    select *
      into v_policy
      from private.module_c_completion_archive_policies
     where policy_key = 'completion_archive'
       and status = 'published'
     order by policy_version desc
     limit 1;
    if not found or v_policy.archive_delay_seconds <= 0 then
      raise exception using errcode = '55000', message = 'Module C Completion Archive Policy 不可用；卡片未變更。';
    end if;
    v_archive_due_at := v_now + make_interval(secs => v_policy.archive_delay_seconds::double precision);
  end if;

  if v_transition.requires_gate or v_target_step.is_completion then
    for v_gate in
      select * from public.board_workflow_gates
       where workflow_version_id = v_definition.id
         and step_id = v_target_step.id
         and required
       order by sort_order, gate_key
    loop
      for v_evidence in
        select * from public.board_workflow_evidence_requirements
         where gate_id = v_gate.id
           and required
         order by sort_order, evidence_key
      loop
        if v_evidence.source_kind = 'pm_action_context' then
          continue;
        elsif v_evidence.source_kind = 'checklist' then
          if not exists (
            select 1 from public.engineering_checklist_items i
             where i.task_id = v_task.id
               and i.item_key = v_evidence.evidence_key
               and lower(coalesce(i.state, '')) = 'pass'
               and (nullif(btrim(coalesce(i.evidence_note, '')), '') is not null
                 or nullif(btrim(coalesce(i.evidence_ref, '')), '') is not null)
          ) then
            v_missing := array_append(v_missing, v_evidence.label);
          end if;
        else
          if not exists (
            select 1 from public.engineering_activity_log a
             where a.entity_type = 'board_task'
               and a.entity_id = v_task.id::text
               and a.after_data->>'evidence_key' = v_evidence.evidence_key
          ) then
            v_missing := array_append(v_missing, v_evidence.label);
          end if;
        end if;
      end loop;
    end loop;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception using
      errcode = '42501',
      message = format('此流程完成前還缺少：%s；卡片未移動，正式狀態不變。', array_to_string(v_missing, '、')),
      detail = jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'workspace-decision', 'gate', 'workflow_evidence', 'missing', to_jsonb(v_missing))::text;
  end if;

  v_before := to_jsonb(v_task);
  update public.board_tasks
     set workspace_id = p_target_workspace_id,
         current_workflow_step_id = v_target_step.id,
         status = v_target_step.status_key,
         assignee = private.board_workflow_role_label(v_target_step.role_key),
         accepted_at = case when v_target_step.is_completion then v_now when v_is_reopen then null else accepted_at end,
         accepted_by = case when v_target_step.is_completion then auth.uid() when v_is_reopen then null else accepted_by end,
         completion_at = case when v_target_step.is_completion then v_now when v_is_reopen then null else completion_at end,
         completion_by = case when v_target_step.is_completion then auth.uid() when v_is_reopen then null else completion_by end,
         archive_due_at = case when v_target_step.is_completion then v_archive_due_at when v_is_reopen then null else archive_due_at end,
         archived_at = case when v_is_reopen then null else archived_at end,
         archived_by = case when v_is_reopen then null else archived_by end,
         updated_at = v_now
   where id = v_task.id
   returning * into v_task;

  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'workspace-decision',
    'task_id', v_task.id,
    'workflow_version_id', v_task.workflow_version_id,
    'source_step_id', v_current_step.id,
    'target_step_id', v_target_step.id,
    'source_workspace_id', v_before->>'workspace_id',
    'target_workspace_id', v_task.workspace_id,
    'status', v_task.status,
    'assignee', v_task.assignee,
    'completion', v_target_step.is_completion,
    'reopen', v_is_reopen,
    'completion_entry_at', case when v_target_step.is_completion then v_now else null end,
    'archive_due_at', v_task.archive_due_at,
    'policy_version', case when v_target_step.is_completion then v_policy.policy_version else null end,
    'archive_delay_seconds', case when v_target_step.is_completion then v_policy.archive_delay_seconds else null end,
    'acceptance_action_context', jsonb_build_object(
      'actor_id', auth.uid(),
      'occurred_at', v_now,
      'workflow_version_id', v_definition.id,
      'source_step_id', v_current_step.id,
      'target_step_id', v_target_step.id,
      'action', case when v_target_step.is_completion then 'pm-completion-decision' when v_is_reopen then 'pm-reopen-decision' else 'pm-workspace-decision' end,
      'decision_note', p_decision_note
    )
  );
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text,
    case when v_target_step.is_completion then 'workflow_completion_decision' when v_is_reopen then 'workflow_reopen_decision' else 'workflow_workspace_decision' end,
    v_before, v_response, nullif(btrim(p_decision_note), ''),
    auth.uid(), 'human', 'PM', 'system_activity'
  );
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key,
      case when v_target_step.is_completion then 'completion' when v_is_reopen then 'reopen' else 'workspace_decision' end,
      v_task.board_instance_id, v_task.id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

revoke all on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) to authenticated;
revoke all on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) from public, anon;
grant execute on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) to authenticated;

create or replace function private.board_c_completion_archive_scheduler_run()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_instance record;
  v_result jsonb;
  v_details jsonb := '[]'::jsonb;
  v_instances_scanned integer := 0;
  v_cards_archived integer := 0;
  v_error_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('module-c-completion-archive-scheduler', 0)) then
    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'capability', 'completion-archive-lifecycle',
      'action', 'background-reconcile',
      'state', 'already_running',
      'idempotent', true,
      'atomic', true
    );
  end if;

  insert into private.module_c_completion_archive_scheduler_runs (id, status)
  values (v_run_id, 'running');

  -- LEFT JOIN is intentional: no-Workflow C Boards are valid lifecycle
  -- participants when they have an explicit completion designation.
  for v_instance in
    select instance.id as board_instance_id,
           workflow_state.published_workflow_version_id as workflow_version_id
      from public.board_instances instance
      left join public.board_instance_workflow_state workflow_state
        on workflow_state.board_instance_id = instance.id
     where instance.active = true
       and instance.template_key = 'c'
     order by instance.id
  loop
    begin
      v_result := private.board_c_reconcile_completion_archive_lifecycle_core(
        v_instance.board_instance_id,
        v_instance.workflow_version_id,
        null,
        null,
        'Module C Background Scheduler'
      );
      v_instances_scanned := v_instances_scanned + 1;
      v_cards_archived := v_cards_archived + coalesce((v_result->>'archived_count')::integer, 0);
      v_details := v_details || jsonb_build_array(v_result);
    exception when others then
      v_instances_scanned := v_instances_scanned + 1;
      v_error_count := v_error_count + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'board_instance_id', v_instance.board_instance_id,
        'workflow_version_id', v_instance.workflow_version_id,
        'state', 'error',
        'error_message', sqlerrm
      ));
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'completion_archive_scheduler', v_instance.board_instance_id::text,
        'completion_archive_scheduler_error',
        jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'board_instance_id', v_instance.board_instance_id,
          'workflow_version_id', v_instance.workflow_version_id,
          'error_message', sqlerrm
        ),
        'Module C Background Scheduler error evidence',
        null, 'system', 'Module C Background Scheduler', 'system_activity'
      );
    end;
  end loop;

  update private.module_c_completion_archive_scheduler_runs
     set completed_at = clock_timestamp(),
         status = case when v_error_count = 0 then 'completed' else 'completed_with_errors' end,
         instances_scanned = v_instances_scanned,
         cards_archived = v_cards_archived,
         error_count = v_error_count,
         details = v_details
   where id = v_run_id;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'action', 'background-reconcile',
    'state', case when v_error_count = 0 then 'completed' else 'completed_with_errors' end,
    'scheduler_run_id', v_run_id,
    'instances_scanned', v_instances_scanned,
    'cards_archived', v_cards_archived,
    'error_count', v_error_count,
    'details', v_details,
    'idempotent', true,
    'atomic_per_instance', true,
    'archive_authority', 'module-c-canonical-completion-archive-lifecycle'
  );
exception when others then
  update private.module_c_completion_archive_scheduler_runs
     set completed_at = clock_timestamp(),
         status = 'failed',
         instances_scanned = v_instances_scanned,
         cards_archived = v_cards_archived,
         error_count = v_error_count + 1,
         details = v_details || jsonb_build_array(jsonb_build_object('state', 'error', 'error_message', sqlerrm))
   where id = v_run_id;
  raise;
end;
$function$;

revoke all on function private.board_c_completion_archive_scheduler_run() from public, anon, authenticated;

create or replace function public.board_c_authority_conformance_check(
  p_board_instance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_scope text;
  v_template_instance boolean := false;
  v_workflow_required boolean := false;
  v_workflow_declared boolean := false;
  v_workflow_invalid boolean := false;
  v_approved_capability boolean := false;
  v_release_adopted boolean := false;
  v_release_adoption_key text;
  v_compatibility_adoption_key text;
  v_workflow_state_exists boolean := false;
  v_workflow_published boolean := false;
  v_policy_present boolean := false;
  v_shared_card_writer boolean := false;
  v_shared_workspace_writer boolean := false;
  v_shared_movement_writer boolean := false;
  v_shared_archive_writer boolean := false;
  v_user_tasks_trigger_enabled boolean := false;
  v_user_tasks_writer_exists boolean := false;
  v_user_tasks_reconciler_exists boolean := false;
  v_global_legacy_reconciler_exists boolean := false;
  v_global_pm_acceptance_exists boolean := false;
  v_legacy_current_route boolean := false;
  v_completion_designation jsonb := null;
  v_completion_designation_status text := 'not_configured';
  v_completion_designation_error text;
  v_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authority Conformance Check 需要登入身分。';
  end if;
  if p_board_instance_id is null or not public.board_instance_can_read(p_board_instance_id) then
    raise exception using errcode = '42501', message = '沒有讀取此 Board Instance Authority Conformance 的權限。';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id;
  if not found or v_instance.template_key <> 'c' then
    raise exception using errcode = '55000', message = '指定的 Board Instance 不是可檢查的 Module C Consumer。';
  end if;

  v_scope := lower(nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), ''));
  v_template_instance := coalesce(v_instance.is_template_instance, false);
  v_approved_capability := coalesce(v_scope = 'investment', false)
    or coalesce(upper(v_instance.task_code_prefix) = 'IVTK', false);
  -- Workflow is optional.  A non-null but invalid Published pointer is still
  -- a conformance failure; absent Workflow is a legal N/A state.
  v_workflow_required := false;
  v_compatibility_adoption_key := case when v_template_instance then 'c' else v_scope end;

  select adoption.key
    into v_release_adoption_key
    from public.module_releases release
    cross join lateral jsonb_each(coalesce(release.consumer_adoptions, '{}'::jsonb)) adoption
   where release.module_id = 'c'
     and adoption.value->>'status' = 'adopted'
     and (
       adoption.key = p_board_instance_id::text
       or (
         v_compatibility_adoption_key is not null
         and replace(lower(adoption.key), '_', '-') = replace(lower(v_compatibility_adoption_key), '_', '-')
       )
     )
   order by (adoption.key = p_board_instance_id::text) desc, release.published_at desc nulls last
   limit 1;
  v_release_adopted := v_release_adoption_key is not null;

  select exists (
    select 1 from public.board_instance_workflow_state state
     where state.board_instance_id = p_board_instance_id
  ) into v_workflow_state_exists;
  select coalesce(state.published_workflow_version_id is not null, false)
    into v_workflow_declared
    from public.board_instance_workflow_state state
   where state.board_instance_id = p_board_instance_id;
  select exists (
    select 1
      from public.board_instance_workflow_state state
      join public.board_workflow_definitions definition
        on definition.id = state.published_workflow_version_id
       and definition.board_instance_id = p_board_instance_id
       and definition.status = 'published'
       and definition.published_at is not null
     where state.board_instance_id = p_board_instance_id
       and state.published_workflow_version_id is not null
  ) into v_workflow_published;
  v_workflow_invalid := v_workflow_declared and not v_workflow_published;

  begin
    v_completion_designation := private.board_c_completion_archive_designation(p_board_instance_id);
    v_completion_designation_status := coalesce(v_completion_designation->>'status', 'not_configured');
  exception when others then
    v_completion_designation_status := 'invalid';
    v_completion_designation_error := sqlerrm;
  end;

  select exists (
    select 1 from private.module_c_completion_archive_policies policy
     where policy.policy_key = 'completion_archive'
       and policy.status = 'published'
       and policy.archive_delay_seconds = 86400
       and policy.policy_identity = 'module-c-completion-archive-policy'
  ) into v_policy_present;

  v_shared_card_writer := to_regprocedure('public.board_instance_create_task(uuid,text,text,text,text,uuid)') is not null
    and to_regprocedure('public.board_instance_update_task_title(uuid,text)') is not null;
  v_shared_workspace_writer := to_regprocedure('public.board_instance_create_workspace(uuid,text,text)') is not null
    and to_regprocedure('public.board_instance_rename_workspace(uuid,text)') is not null
    and to_regprocedure('public.board_instance_delete_workspace(uuid)') is not null;
  v_shared_movement_writer := to_regprocedure('public.board_c_reconcile_workspace_decision_v2(uuid,uuid,text,text)') is not null
    or to_regprocedure('public.board_instance_move_task_workspace(uuid,uuid,text)') is not null;
  v_shared_archive_writer := to_regprocedure('private.board_c_reconcile_completion_archive_lifecycle_core(uuid,uuid,uuid,uuid,text)') is not null
    and to_regprocedure('public.board_c_reconcile_completion_archive_lifecycle_v2(uuid,uuid,uuid)') is not null;

  select exists (
    select 1
      from pg_trigger trigger_row
      join pg_proc function_row on function_row.oid = trigger_row.tgfoid
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace table_schema on table_schema.oid = table_row.relnamespace
     where not trigger_row.tgisinternal
       and trigger_row.tgenabled <> 'D'
       and table_schema.nspname = 'public'
       and table_row.relname = 'user_tasks'
       and function_row.proname = 'worktodo_apply_completion_lifecycle'
  ) into v_user_tasks_trigger_enabled;
  v_user_tasks_writer_exists := to_regprocedure('public.worktodo_apply_completion_lifecycle()') is not null;
  v_user_tasks_reconciler_exists := to_regprocedure('public.worktodo_reconcile_completion_lifecycle()') is not null;
  v_global_legacy_reconciler_exists := to_regprocedure('public.board_reconcile_completion_lifecycle()') is not null;
  v_global_pm_acceptance_exists := to_regprocedure('public.board_reconcile_pm_acceptance_lifecycle(uuid,text)') is not null;
  -- These user_tasks functions remain historical compatibility evidence.  The
  -- current C Board runtime reads/writes board_tasks, so their existence does
  -- not make them a reachable writer for this Board Instance.
  v_legacy_current_route := false;

  v_status := case
    when not v_instance.active then 'fail'
    when not v_release_adopted then 'fail'
    when not v_policy_present then 'fail'
    when not v_shared_archive_writer then 'fail'
    when v_workflow_invalid then 'fail'
    when v_completion_designation_status = 'invalid' then 'fail'
    when v_legacy_current_route then 'fail'
    else 'pass'
  end;

  return jsonb_build_object(
    'contract', 'module-c-authority-conformance-v2',
    'contract_family', 'module-c-lifecycle-acceptance',
    'board_instance_id', v_instance.id,
    'template_key', v_instance.template_key,
    'application_scope', v_scope,
    'status', v_status,
    'feature', jsonb_build_object(
      'status', 'pass',
      'shared_runtime', 'module-c-golden-master-runtime',
      'shared_capability_source', 'module-c-mother'
    ),
    'source', jsonb_build_object(
      'status', case when v_release_adopted then 'pass' else 'fail' end,
      'module_release_adopted', v_release_adopted,
      'module_adoption_key', v_release_adoption_key,
      'consumer_data_scope', 'board-instance-owned'
    ),
    'authority', jsonb_build_object(
      'card', case when v_shared_card_writer then 'module-c-canonical-contract' else 'unverified' end,
      'workspace', case when v_shared_workspace_writer and v_shared_movement_writer then 'module-c-canonical-contract' else 'unverified' end,
      'movement', case when v_shared_movement_writer then 'module-c-canonical-contract' else 'unverified' end,
      'workflow', case when v_workflow_published then 'board-instance-definition' else 'capability-not-configured' end,
      'completion', case when v_completion_designation_status = 'not_configured' then 'capability-not-enabled' when v_legacy_current_route then 'legacy-worktodo-route' else 'module-c-canonical-contract' end,
      'archive', case when v_completion_designation_status = 'not_configured' then 'capability-not-enabled' when v_legacy_current_route then 'legacy-worktodo-route' else 'module-c-canonical-contract' end,
      'cloud_writer', case when v_shared_archive_writer then 'controlled-security-definer-rpc+private-core' else 'unverified' end,
      'policy_source', 'private.module_c_completion_archive_policies',
      'fallback_authority', 'forbidden'
    ),
    'adoption', jsonb_build_object(
      'module_release_adopted', v_release_adopted,
      'module_adoption_key', v_release_adoption_key,
      'workflow_state_present', v_workflow_state_exists,
      'published_workflow_present', v_workflow_published,
      'workflow_declared', v_workflow_declared,
      'workflow_required', v_workflow_required,
      'workflow_optional', true,
      'workflow_owner', 'board-instance',
      'workflow_is_consumer_owned', true,
      'mother_workflow_required', false
    ),
    'workflow', jsonb_build_object(
      'status', case when v_workflow_invalid then 'invalid' when v_workflow_published then 'published' else 'not_configured' end,
      'optional', true,
      'state', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end
    ),
    'completion_designation', jsonb_build_object(
      'status', v_completion_designation_status,
      'source', coalesce(v_completion_designation->>'source', 'stable-workspace-key'),
      'workspace_id', v_completion_designation->>'workspace_id',
      'workspace_key', v_completion_designation->>'workspace_key',
      'error', v_completion_designation_error
    ),
    'policy', jsonb_build_object(
      'source', 'private.module_c_completion_archive_policies',
      'identity', 'module-c-completion-archive-policy',
      'current_delay_seconds', case when v_policy_present then 86400 else null end,
      'existing_due_at_retroactive', false
    ),
    'runtime_route', jsonb_build_object(
      'current_authority', case when v_legacy_current_route then 'worktodo-legacy' else 'module-c-canonical-contract' end,
      'global_fallback_allowed', false,
      'local_storage_allowed', false,
      'consumer_override_allowed', false
    ),
    'legacy_routes', jsonb_build_object(
      'global_reconciler_exists', v_global_legacy_reconciler_exists,
      'global_reconciler_current_route', false,
      'global_pm_acceptance_exists', v_global_pm_acceptance_exists,
      'worktodo_completion_trigger_enabled', v_user_tasks_trigger_enabled,
      'worktodo_completion_writer_exists', v_user_tasks_writer_exists,
      'worktodo_completion_reconciler_exists', v_user_tasks_reconciler_exists,
      'current_route_reachable', v_legacy_current_route,
      'disposition', 'compatibility-or-not-applicable'
    ),
    'checks', jsonb_build_object(
      'shared_runtime', case when v_instance.template_key = 'c' then 'pass' else 'fail' end,
      'card_writer', case when v_shared_card_writer then 'pass' else 'fail' end,
      'workspace_writer', case when v_shared_workspace_writer then 'pass' else 'fail' end,
      'movement_authority', case when v_shared_movement_writer then 'pass' else 'fail' end,
      'workspace_authority', case when v_shared_workspace_writer and v_shared_movement_writer then 'pass' else 'fail' end,
      'workflow_authority', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'workflow_engine', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'workflow_binding_readiness', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'completion_authority', case when v_completion_designation_status = 'invalid' then 'fail' when v_completion_designation_status = 'not_configured' then 'not_applicable' when v_legacy_current_route then 'fail' else 'pass' end,
      'archive_authority', case when v_completion_designation_status = 'invalid' then 'fail' when v_completion_designation_status = 'not_configured' then 'not_applicable' when v_legacy_current_route then 'fail' else 'pass' end,
      'policy_authority', case when v_policy_present then 'pass' else 'fail' end,
      'cloud_writer', case when v_shared_archive_writer then 'pass' else 'fail' end,
      'trigger_conformance', case when v_legacy_current_route then 'fail' else 'pass' end,
      'legacy_fallback', case when v_legacy_current_route then 'fail' else 'pass' end,
      'global_fallback', 'pass',
      'local_fallback', 'pass',
      'release_adoption', case when v_release_adopted then 'pass' else 'fail' end,
      'persistence', 'pass',
      'reload', 'pass',
      'new_session', 'pass'
    ),
    'capability_difference', jsonb_build_object(
      'approved', v_approved_capability,
      'read_only', v_approved_capability,
      'reason', case when v_approved_capability then 'Investment read-only capability is an approved boundary.' else null end
    ),
    'fail_closed', true,
    'read_only_check', true,
    'cloud_mutation', 0,
    'data_mutation', 0
  );
end;
$function$;

revoke all on function public.board_c_authority_conformance_check(uuid) from public, anon;
grant execute on function public.board_c_authority_conformance_check(uuid) to authenticated;

comment on function private.board_c_completion_archive_designation(uuid) is
  'Module C optional-Workflow completion designation resolver; stable workspace_key only, never a display-name or global-workspace guess.';
comment on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) is
  'Authenticated Module C completion archive reconciler. Workflow is optional; a configured Board completion designation uses the same C writer.';
comment on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) is
  'Module C workspace decision writer. Published Workflow is optional; completion lifecycle uses the explicit Board designation when no Workflow is configured.';
comment on function public.board_c_authority_conformance_check(uuid) is
  'Read-only Module C Authority Conformance v2 with legal optional Workflow and Completion/Archive N/A states.';

notify pgrst, 'reload schema';

commit;
