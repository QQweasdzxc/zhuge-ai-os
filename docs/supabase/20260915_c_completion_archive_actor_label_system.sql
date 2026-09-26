-- Priority hotfix: align Module C completion/archive audit writes with the
-- existing engineering_activity_log actor taxonomy.
--
-- The source actor remains provenance only.  The persisted actor_label is the
-- existing canonical system value, System.  No policy, lifecycle decision,
-- writer authority, or product data is changed by this migration.

begin;

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
  v_source_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'Module C');
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
      'actor', v_source_actor_label,
      'actor_label', 'System',
      'actor_provenance', jsonb_build_object(
        'source_actor_label', v_source_actor_label,
        'stored_actor_label', 'System',
        'authority', 'module-c-canonical-completion-archive-lifecycle'
      )
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
        v_after := to_jsonb(v_archived) || jsonb_build_object(
          'archive_context', v_scope,
          'actor_provenance', jsonb_build_object(
            'source_actor_label', v_source_actor_label,
            'stored_actor_label', 'System',
            'authority', 'module-c-canonical-completion-archive-lifecycle'
          )
        );
        insert into public.engineering_activity_log (
          entity_type, entity_id, action, before_data, after_data, note,
          actor_id, actor_type, actor_label, activity_type
        ) values (
          'board_task', v_archived.id::text, 'task_auto_archived',
          v_before, v_after,
          'Module C optional-Workflow completion archive reconciliation',
          p_actor_id, 'system', 'System', 'system_activity'
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
        v_after := to_jsonb(v_archived) || jsonb_build_object(
          'archive_context', v_scope,
          'actor_provenance', jsonb_build_object(
            'source_actor_label', v_source_actor_label,
            'stored_actor_label', 'System',
            'authority', 'module-c-canonical-completion-archive-lifecycle'
          )
        );
        insert into public.engineering_activity_log (
          entity_type, entity_id, action, before_data, after_data, note,
          actor_id, actor_type, actor_label, activity_type
        ) values (
          'board_task', v_archived.id::text, 'task_auto_archived',
          v_before, v_after,
          'Module C instance-scoped completion archive reconciliation',
          p_actor_id, 'system', 'System', 'system_activity'
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
    'actor', v_source_actor_label,
    'actor_label', 'System',
    'actor_provenance', jsonb_build_object(
      'source_actor_label', v_source_actor_label,
      'stored_actor_label', 'System',
      'authority', 'module-c-canonical-completion-archive-lifecycle'
    )
  );
end;
$function$;

revoke all on function private.board_c_reconcile_completion_archive_lifecycle_core(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- The background scheduler is a private SECURITY DEFINER system path.  Keep
-- the normal owner/engineering checks unchanged for every application write;
-- allow only the scheduler's narrowly validated archive-only update through
-- the board-task trigger.  The marker is set only inside the private
-- scheduler below and is never a client-provided function parameter.
create or replace function public.enforce_board_task_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_instance public.board_instances;
  v_is_c_archive_scheduler boolean := (
    current_user = 'postgres'
    and coalesce(current_setting('zhuge.module_c_completion_archive_scheduler', true), '') = '1'
  );
begin
  if tg_op = 'DELETE' then
    if old.board_instance_id is null then
      raise exception using errcode = '23502', message = 'board_instance_id is required';
    end if;

    select * into v_instance
    from public.board_instances
    where id = old.board_instance_id
      and active = true;
    if not found then
      raise exception using errcode = '23503', message = 'Active board instance is required';
    end if;

    if old.application_scope = 'worktodo' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif old.application_scope is null and v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif old.application_scope is null
      and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
      end if;
    return old;
  end if;

  if new.board_instance_id is null then
    raise exception using errcode = '23502', message = 'board_instance_id is required';
  end if;

  select * into v_instance
  from public.board_instances
  where id = new.board_instance_id
    and active = true;
  if not found then
    raise exception using errcode = '23503', message = 'Active board instance is required';
  end if;

  if tg_op = 'UPDATE'
     and v_is_c_archive_scheduler
     and v_instance.template_key = 'c'
     and old.archived_at is null
     and new.archived_at is not null
     and new.completion_at is not null
     and new.archive_due_at is not null
     and new.archive_due_at <= clock_timestamp()
     and new.archived_by is null
     and (to_jsonb(old) - 'archived_at' - 'archived_by' - 'updated_at') =
         (to_jsonb(new) - 'archived_at' - 'archived_by' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.application_scope = 'worktodo' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif new.application_scope = 'ai_board' then
      if new.owner_uuid is not null then
        raise exception using errcode = '42501', message = 'AI Board task owner must be null';
      end if;
    elsif v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
    end if;
    return new;
  end if;

  if old.board_instance_id is distinct from new.board_instance_id then
    raise exception using errcode = '22023', message = 'board_instance_id is immutable';
  end if;
  if old.application_scope is distinct from new.application_scope
     or old.owner_uuid is distinct from new.owner_uuid then
    raise exception using errcode = '22023', message = 'Task board identity is immutable';
  end if;

  if new.application_scope = 'worktodo'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'owner'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'Board owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'engineering'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'Engineering board authorization is required';
  end if;
  return new;
end;
$function$;

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
      -- The trigger's owner check is intentionally bypassed only for this
      -- private, SECURITY DEFINER scheduler call.  The trigger validates the
      -- exact archive-only update before accepting the marker.
      perform set_config('zhuge.module_c_completion_archive_scheduler', '1', true);
      v_result := private.board_c_reconcile_completion_archive_lifecycle_core(
        v_instance.board_instance_id,
        v_instance.workflow_version_id,
        null,
        null,
        'Module C Background Scheduler'
      );
      perform set_config('zhuge.module_c_completion_archive_scheduler', '0', true);
      v_instances_scanned := v_instances_scanned + 1;
      v_cards_archived := v_cards_archived + coalesce((v_result->>'archived_count')::integer, 0);
      v_details := v_details || jsonb_build_array(v_result);
      exception when others then
      perform set_config('zhuge.module_c_completion_archive_scheduler', '0', true);
      v_instances_scanned := v_instances_scanned + 1;
      v_error_count := v_error_count + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'board_instance_id', v_instance.board_instance_id,
        'workflow_version_id', v_instance.workflow_version_id,
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
          'workflow_version_id', v_instance.workflow_version_id,
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

revoke all on function private.board_c_completion_archive_scheduler_run() from public, anon, authenticated;

comment on function private.board_c_reconcile_completion_archive_lifecycle_core(uuid, uuid, uuid, uuid, text) is
  'Single Module C Archive writer. Persisted activity actor_label is the existing System taxonomy; Module C source identity remains audit provenance.';

comment on function private.board_c_completion_archive_scheduler_run() is
  'Module C background scheduler. Persisted activity actor_label is System; scheduler identity remains audit provenance.';

notify pgrst, 'reload schema';

commit;
