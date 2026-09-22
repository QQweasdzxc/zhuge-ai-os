-- Module C completion/archive closure.
--
-- Policy v1 (48h) remains as retired historical policy.  Policy v2 is the
-- current 24h Product Rule.  Existing task timestamps are never recalculated.
-- The C workspace decision writer and the background/read reconciler share the
-- same policy table and the same instance/workflow scope.

begin;

update private.module_c_completion_archive_policies
   set status = 'retired',
       retired_at = coalesce(retired_at, now())
 where policy_key = 'completion_archive'
   and status = 'published'
   and policy_version < 2;

insert into private.module_c_completion_archive_policies (
  policy_key,
  policy_version,
  status,
  archive_delay_seconds,
  policy_identity,
  policy_source,
  effective_at
)
values (
  'completion_archive',
  2,
  'published',
  86400,
  'module-c-completion-archive-policy',
  'module-c-mother',
  now()
)
on conflict (policy_key, policy_version) do update
  set status = 'published',
      archive_delay_seconds = 86400,
      policy_identity = excluded.policy_identity,
      policy_source = excluded.policy_source,
      effective_at = excluded.effective_at,
      retired_at = null;

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
  v_transition public.board_workflow_transitions%rowtype;
  v_gate public.board_workflow_gates%rowtype;
  v_evidence public.board_workflow_evidence_requirements%rowtype;
  v_missing text[] := array[]::text[];
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_task_id::text, p_target_workspace_id::text, coalesce(p_decision_note, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_is_reopen boolean := false;
  v_now timestamptz := clock_timestamp();
  v_policy private.module_c_completion_archive_policies%rowtype;
  v_archive_due_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '工作區決定需要登入身分；卡片未變更。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
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

  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = '目前登入身分沒有此卡片的管理權限；卡片未變更。';
  end if;
  if v_task.archived_at is not null then
    raise exception using errcode = '42501', message = '封存卡片不可移動；卡片未變更。';
  end if;

  select * into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active
   for share;
  select * into v_definition
    from public.board_workflow_definitions
   where id = v_task.workflow_version_id
     and board_instance_id = v_task.board_instance_id
     and status in ('published', 'retired');
  if not found or v_task.current_workflow_step_id is null then
    raise exception using errcode = '55000', message = '此卡片尚未綁定可用的流程版本／目前階段；Runtime 不會猜測流程，卡片未變更。';
  end if;

  select * into v_current_step
    from public.board_workflow_steps
   where id = v_task.current_workflow_step_id
     and workflow_version_id = v_definition.id;
  select * into v_target_step
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

  select * into v_transition
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
    select * into v_policy
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
         accepted_at = case
           when v_target_step.is_completion then v_now
           when v_is_reopen then null
           else accepted_at
         end,
         accepted_by = case
           when v_target_step.is_completion then auth.uid()
           when v_is_reopen then null
           else accepted_by
         end,
         completion_at = case
           when v_target_step.is_completion then v_now
           when v_is_reopen then null
           else completion_at
         end,
         completion_by = case
           when v_target_step.is_completion then auth.uid()
           when v_is_reopen then null
           else completion_by
         end,
         archive_due_at = case
           when v_target_step.is_completion then v_archive_due_at
           when v_is_reopen then null
           else archive_due_at
         end,
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
      'action', case
        when v_target_step.is_completion then 'pm-completion-decision'
        when v_is_reopen then 'pm-reopen-decision'
        else 'pm-workspace-decision'
      end,
      'decision_note', p_decision_note
    )
  );
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text,
    case when v_target_step.is_completion then 'workflow_completion_decision' when v_is_reopen then 'workflow_reopen_decision' else 'workflow_workspace_decision' end,
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
      case when v_target_step.is_completion then 'completion' when v_is_reopen then 'reopen' else 'workspace_decision' end,
      v_task.board_instance_id,
      v_task.id,
      v_hash,
      v_response,
      'completed'
    );
  end if;
  return v_response;
end;
$function$;

-- Private worker shared by the authenticated read-safety-net path and the
-- Cloud scheduler.  It is the only Archive writer; the scheduler never
-- implements a second due-time or Archive decision.
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
begin
  v_scope := private.board_c_completion_archive_scope(p_board_instance_id, p_workflow_version_id);
  v_completion_step_id := (v_scope->>'completion_step_id')::uuid;

  if p_task_id is not null then
    perform private.board_c_completion_archive_context(p_task_id, p_board_instance_id, p_workflow_version_id);
  end if;

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

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'action', 'reconcile-completion-archive',
    'state', 'reconciled',
    'board_instance_id', p_board_instance_id,
    'workflow_version_id', p_workflow_version_id,
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
      detail = jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'capability', 'completion-archive', 'error_code', 'C_ARCHIVE_RECONCILE_FORBIDDEN', 'board_instance_id', p_board_instance_id)::text;
  end if;
  if v_workflow_version_id is null then
    select * into v_state
      from public.board_instance_workflow_state
     where board_instance_id = p_board_instance_id;
    if not found or v_state.published_workflow_version_id is null then
      raise exception using errcode = '55000', message = '此 Board Instance 沒有 Published Workflow；資料未變更。';
    end if;
    v_workflow_version_id := v_state.published_workflow_version_id;
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

revoke all on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) to authenticated;
revoke all on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) from public, anon;
grant execute on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid) to authenticated;

comment on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) is
  'C v2 instance/workflow-scoped Workspace Decision and PM Completion writer; new Completion entries use the published Module C archive policy and reopens clear the active completion timer.';
comment on function private.board_c_reconcile_completion_archive_lifecycle_core(uuid, uuid, uuid, uuid, text) is
  'Single Module C Archive writer reused by authenticated safety-net and Cloud scheduler paths.';

notify pgrst, 'reload schema';

commit;
