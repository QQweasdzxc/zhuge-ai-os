-- Narrow readiness correction. Function-only; no Task rebinding, data backfill,
-- policy change, scheduler replacement, Workflow publication or Cloud apply.
begin;

-- Internal selection only; policy, context validation and archive writes remain
-- in the existing scope/core. NULL represents the optional/unbound path.
create or replace function private.board_c_pending_archive_workflow_versions(p_board_instance_id uuid)
returns table(workflow_version_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select distinct task.workflow_version_id
  from public.board_tasks task
  join public.board_instances instance on instance.id = task.board_instance_id
  left join public.board_workflow_definitions definition
    on definition.id = task.workflow_version_id
    and definition.board_instance_id = task.board_instance_id
    and definition.status in ('published', 'retired')
  where task.board_instance_id = p_board_instance_id
    and instance.active and instance.template_key = 'c'
    and task.archived_at is null
    and task.completion_at is not null and task.archive_due_at is not null
    and (task.workflow_version_id is null or definition.id is not null)
$function$;
revoke all on function private.board_c_pending_archive_workflow_versions(uuid) from public, anon, authenticated;

-- Preserve the existing public RPC signature/primary context. A Board-wide
-- read reconciles every pending legal binding, even when its caller supplies
-- the current Published pointer. Task-scoped calls retain exact context checks.
create or replace function public.board_c_reconcile_completion_archive_lifecycle_v2(
  p_board_instance_id uuid, p_workflow_version_id uuid default null, p_task_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_primary uuid := p_workflow_version_id;
  v_task public.board_tasks%rowtype;
  v_scope record;
  v_result jsonb; v_extra jsonb;
  v_count integer; v_ids jsonb; v_contexts jsonb;
begin
  if auth.uid() is null or p_board_instance_id is null
     or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501',
      message = '沒有執行此 Board Instance Archive Reconciliation 的權限；資料未變更。',
      detail = jsonb_build_object('contract','module-c-lifecycle-acceptance-v2',
        'capability','completion-archive-lifecycle','error_code','C_ARCHIVE_RECONCILE_FORBIDDEN',
        'board_instance_id',p_board_instance_id)::text;
  end if;
  if p_task_id is not null then
    -- Let the existing context reject missing, foreign or mismatched Tasks.
    perform private.board_c_completion_archive_context(p_task_id,p_board_instance_id,p_workflow_version_id);
    select * into v_task from public.board_tasks where id = p_task_id;
    return private.board_c_reconcile_completion_archive_lifecycle_core(
      p_board_instance_id,v_task.workflow_version_id,p_task_id,auth.uid(),'Module C');
  end if;
  if v_primary is null then
    select published_workflow_version_id into v_primary
      from public.board_instance_workflow_state where board_instance_id = p_board_instance_id;
  end if;
  v_result := private.board_c_reconcile_completion_archive_lifecycle_core(
    p_board_instance_id,v_primary,null,auth.uid(),'Module C');
  v_count := coalesce((v_result->>'archived_count')::integer,0);
  v_ids := coalesce(v_result->'task_ids','[]'::jsonb);
  v_contexts := jsonb_build_array(v_result);
  for v_scope in select workflow_version_id from private.board_c_pending_archive_workflow_versions(p_board_instance_id)
    where workflow_version_id is distinct from v_primary order by workflow_version_id nulls first loop
    v_extra := private.board_c_reconcile_completion_archive_lifecycle_core(
      p_board_instance_id,v_scope.workflow_version_id,null,auth.uid(),'Module C');
    v_count := v_count + coalesce((v_extra->>'archived_count')::integer,0);
    v_ids := v_ids || coalesce(v_extra->'task_ids','[]'::jsonb);
    v_contexts := v_contexts || jsonb_build_array(v_extra);
  end loop;
  return v_result || jsonb_build_object('archived_count',v_count,'task_ids',v_ids,'reconciled_contexts',v_contexts);
end;
$function$;
revoke all on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid,uuid,uuid) from public, anon;
grant execute on function public.board_c_reconcile_completion_archive_lifecycle_v2(uuid,uuid,uuid) to authenticated;

create or replace function private.board_c_completion_archive_scheduler_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_instance record;
  v_result jsonb;
  v_scope record;
  v_board_count integer;
  v_board_details jsonb;
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
    v_instances_scanned := v_instances_scanned + 1;
    v_board_count := 0;
    v_board_details := '[]'::jsonb;
    begin
    for v_scope in
      select v_instance.workflow_version_id as workflow_version_id
      union
      select workflow_version_id from private.board_c_pending_archive_workflow_versions(v_instance.board_instance_id)
      order by workflow_version_id nulls first
    loop
      -- The trigger's owner check is intentionally bypassed only for this
      -- private, SECURITY DEFINER scheduler call.  The trigger validates the
      -- exact archive-only update before accepting the marker.
      perform set_config('zhuge.module_c_completion_archive_scheduler', '1', true);
      v_result := private.board_c_reconcile_completion_archive_lifecycle_core(
        v_instance.board_instance_id,
        v_scope.workflow_version_id,
        null,
        null,
        'Module C Background Scheduler'
      );
      perform set_config('zhuge.module_c_completion_archive_scheduler', '0', true);
      v_board_count := v_board_count + coalesce((v_result->>'archived_count')::integer, 0);
      v_board_details := v_board_details || jsonb_build_array(v_result);
    end loop;
    v_cards_archived := v_cards_archived + v_board_count;
    v_details := v_details || v_board_details;
      exception when others then
      perform set_config('zhuge.module_c_completion_archive_scheduler', '0', true);
      v_error_count := v_error_count + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'board_instance_id', v_instance.board_instance_id,
        'workflow_version_id', v_scope.workflow_version_id,
        'state', 'error',
        'error_message', sqlerrm,
        'actor_provenance', jsonb_build_object(
          'source_actor_label', 'Module C Background Scheduler',
          'stored_actor_label', 'System',
          'authority', 'module-c-canonical-completion-archive-lifecycle'
        )
      ));
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'board_instance', v_instance.board_instance_id::text,
        'completion_archive_scheduler_error',
        jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'board_instance_id', v_instance.board_instance_id,
          'workflow_version_id', v_scope.workflow_version_id,
          'error_message', sqlerrm,
          'actor_provenance', jsonb_build_object(
            'source_actor_label', 'Module C Background Scheduler',
            'stored_actor_label', 'System',
            'authority', 'module-c-canonical-completion-archive-lifecycle'
          )
        ),
        'Module C Background Scheduler error evidence',
        null, 'system', 'System', 'system_activity'
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


create or replace function public.module_c_workspace_ordering_authority(
  p_workspace_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_instance uuid;
  v_expected_count integer;
  v_supplied_count integer := coalesce(array_length(p_workspace_ids, 1), 0);
  v_distinct_count integer;
  v_workspace_id uuid;
  v_order integer := 10;
  v_updated_count integer := 0;
  v_worktodo_count integer := 0;
  v_previous_module_guard text;
  v_module_guard_set boolean := false;
  v_ordered_ids jsonb := '[]'::jsonb;
  v_before_workspaces jsonb := '[]'::jsonb;
  v_after_workspaces jsonb := '[]'::jsonb;
  v_audit_id bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Board workspace write authorization is required';
  end if;
  if p_workspace_ids is null or v_supplied_count = 0 then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace exactly once';
  end if;

  select workspace.board_instance_id
    into v_instance
  from public.board_workspaces workspace
  where workspace.id = p_workspace_ids[1]
    and workspace.active = true;

  if not found or v_instance is null then
    raise exception using errcode = '22023', message = 'Workspace order contains an inactive or unknown workspace';
  end if;
  if not public.board_instance_can_write(v_instance) then
    raise exception using errcode = '42501', message = 'Board workspace write authorization is required';
  end if;

  -- Serialize concurrent reorders of the current active set before taking the
  -- audit snapshot. sort_order remains the only ordering SSOT.
  perform workspace.id
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true
  order by workspace.id
  for update;

  select count(*)
    into v_expected_count
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

  select count(distinct supplied.id)
    into v_distinct_count
  from unnest(p_workspace_ids) as supplied(id);

  if v_supplied_count <> v_expected_count
     or v_distinct_count <> v_expected_count
     or exists (
       select 1
       from unnest(p_workspace_ids) as supplied(id)
       left join public.board_workspaces workspace
         on workspace.id = supplied.id
        and workspace.board_instance_id = v_instance
        and workspace.active = true
       where workspace.id is null
     ) then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace in this board exactly once';
  end if;

  select count(*)
    into v_worktodo_count
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true
    and workspace.application_scope = 'worktodo';

  -- Membership is the full active set of one authorized Board Instance.
  -- Legacy/custom application_scope differences never change membership.
  -- v_worktodo_count only enables the existing sort_order-only trigger marker.

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace.id,
        'workspace_key', workspace.workspace_key,
        'name', workspace.name,
        'sort_order', workspace.sort_order
      ) order by workspace.sort_order nulls last, workspace.created_at, workspace.id
    ),
    '[]'::jsonb
  )
    into v_before_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

  if v_worktodo_count > 0 then
    v_previous_module_guard := current_setting('zhuge.module_c_workspace_ordering', true);
    perform set_config('zhuge.module_c_workspace_ordering', '1', true);
    v_module_guard_set := true;
  end if;

  foreach v_workspace_id in array p_workspace_ids loop
    update public.board_workspaces
    set sort_order = v_order,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_workspace_id
      and board_instance_id = v_instance
      and active = true;

    if not found then
      raise exception using errcode = '40001', message = 'Workspace changed during reorder; ordering was not saved';
    end if;

    v_order := v_order + 10;
    v_updated_count := v_updated_count + 1;
    v_ordered_ids := v_ordered_ids || jsonb_build_array(v_workspace_id);
  end loop;

  if v_module_guard_set then
    perform set_config(
      'zhuge.module_c_workspace_ordering',
      coalesce(v_previous_module_guard, ''),
      true
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace.id,
        'workspace_key', workspace.workspace_key,
        'name', workspace.name,
        'sort_order', workspace.sort_order
      ) order by workspace.sort_order nulls last, workspace.created_at, workspace.id
    ),
    '[]'::jsonb
  )
    into v_after_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

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
    'board_instance',
    v_instance::text,
    'workspace_order_changed',
    jsonb_build_object('board_instance_id', v_instance, 'workspaces', v_before_workspaces),
    jsonb_build_object('board_instance_id', v_instance, 'workspace_ids', v_ordered_ids, 'workspaces', v_after_workspaces),
    'Module C Workspace Ordering Authority',
    auth.uid(),
    'human',
    'QJC',
    'system_activity'
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'updated', v_updated_count,
    'board_instance_id', v_instance,
    'workspace_ids', v_ordered_ids,
    'audit_id', v_audit_id
  );
end;
$function$;

commit;
