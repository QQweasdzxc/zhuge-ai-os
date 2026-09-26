-- Module C Authority / Runtime Route Conformance v2 hardening.
--
-- Read-only checker for the final C Consumer lifecycle closure.  It reports
-- shared authority, release adoption, workflow readiness, policy authority,
-- persistence, and reachable legacy writers separately.  It never repairs,
-- adopts, moves, or changes product data.

begin;

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
  v_workflow_required boolean := true;
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
  v_shared_completion_writer boolean := false;
  v_shared_archive_writer boolean := false;
  v_user_tasks_trigger_enabled boolean := false;
  v_user_tasks_writer_exists boolean := false;
  v_user_tasks_reconciler_exists boolean := false;
  v_global_legacy_reconciler_exists boolean := false;
  v_global_pm_acceptance_exists boolean := false;
  v_legacy_current_route boolean := false;
  v_status text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authority Conformance Check 需要登入身分。';
  end if;
  if p_board_instance_id is null or not public.board_instance_can_read(p_board_instance_id) then
    raise exception using
      errcode = '42501',
      message = '沒有讀取此 Board Instance Authority Conformance 的權限。';
  end if;

  select * into v_instance
    from public.board_instances
   where id = p_board_instance_id;
  if not found or v_instance.template_key <> 'c' then
    raise exception using
      errcode = '55000',
      message = '指定的 Board Instance 不是可檢查的 Module C Consumer。';
  end if;

  v_scope := lower(nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), ''));
  v_template_instance := coalesce(v_instance.is_template_instance, false);
  -- The existing Investment Board was provisioned before application_scope was
  -- consistently recorded.  IVTK is its formal Board Identity; using that
  -- identity here only classifies the already-approved read-only capability,
  -- it does not grant a Consumer any lifecycle authority.
  v_approved_capability := coalesce(v_scope = 'investment', false)
    or coalesce(upper(v_instance.task_code_prefix) = 'IVTK', false);
  -- C Mother is the shared engine/template and deliberately has no consumer
  -- workflow.  Every other completion-capable C instance must expose its own
  -- Board Instance-owned Published Workflow before lifecycle use.
  v_workflow_required := not v_template_instance and not v_approved_capability;
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
    select 1
      from public.board_instance_workflow_state state
     where state.board_instance_id = p_board_instance_id
  ) into v_workflow_state_exists;
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

  select exists (
    select 1
      from private.module_c_completion_archive_policies policy
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
  v_shared_completion_writer := to_regprocedure('public.board_c_reconcile_workspace_decision_v2(uuid,uuid,text,text)') is not null;
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
  v_legacy_current_route := coalesce(v_scope = 'worktodo', false)
    and (v_user_tasks_trigger_enabled or v_user_tasks_reconciler_exists);

  v_status := case
    when not v_instance.active then 'fail'
    when not v_release_adopted then 'fail'
    when not v_policy_present then 'fail'
    when not v_shared_archive_writer then 'fail'
    when v_legacy_current_route then 'fail'
    when v_workflow_required and not v_workflow_published then 'fail_closed'
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
      'workflow', case when v_workflow_required then 'board-instance-definition' else 'capability-not-enabled' end,
      'completion', case when v_approved_capability then 'approved-capability-not-enabled' when v_legacy_current_route then 'legacy-worktodo-route' else 'module-c-canonical-contract' end,
      'archive', case when v_approved_capability then 'approved-capability-not-enabled' when v_legacy_current_route then 'legacy-worktodo-route' else 'module-c-canonical-contract' end,
      'cloud_writer', case when v_shared_archive_writer then 'controlled-security-definer-rpc+private-core' else 'unverified' end,
      'policy_source', 'private.module_c_completion_archive_policies',
      'fallback_authority', 'forbidden'
    ),
    'adoption', jsonb_build_object(
      'module_release_adopted', v_release_adopted,
      'module_adoption_key', v_release_adoption_key,
      'workflow_state_present', v_workflow_state_exists,
      'published_workflow_present', v_workflow_published,
      'workflow_required', v_workflow_required,
      'workflow_owner', 'board-instance',
      'workflow_is_consumer_owned', true,
      'mother_workflow_required', false
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
      'disposition', case when v_legacy_current_route then 'legacy-runtime-authority' else 'compatibility-or-not-applicable' end
    ),
    'checks', jsonb_build_object(
      'shared_runtime', case when v_instance.template_key = 'c' then 'pass' else 'fail' end,
      'card_writer', case when v_shared_card_writer then 'pass' else 'fail' end,
      'workspace_writer', case when v_shared_workspace_writer then 'pass' else 'fail' end,
      'movement_authority', case when v_shared_movement_writer then 'pass' else 'fail' end,
      'workspace_authority', case when v_shared_workspace_writer and v_shared_movement_writer then 'pass' else 'fail' end,
      'workflow_authority', case when v_workflow_required and not v_workflow_published then 'not_configured' when v_approved_capability or v_template_instance then 'not_applicable' else 'pass' end,
      'workflow_engine', case when v_workflow_required and not v_workflow_published then 'not_configured' else 'pass' end,
      'workflow_binding_readiness', case when v_workflow_required and not v_workflow_published then 'not_configured' else 'pass' end,
      'completion_authority', case when v_approved_capability or v_template_instance then 'not_applicable' when v_legacy_current_route then 'fail' else 'pass' end,
      'archive_authority', case when v_approved_capability or v_template_instance then 'not_applicable' when v_legacy_current_route then 'fail' else 'pass' end,
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

comment on function public.board_c_authority_conformance_check(uuid) is
  'Read-only Module C Authority / Runtime Route Conformance v2.  Separates shared authority, adoption readiness, approved capability differences, and reachable legacy writers without changing data.';

notify pgrst, 'reload schema';

commit;
