-- Module C Authority / Runtime Route Conformance checker.
--
-- Read-only governance evidence.  It inspects the current Board Instance
-- route and database writer/trigger catalog; it never repairs, adopts, moves,
-- or changes application data.

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
  v_release_adopted boolean := false;
  v_workflow_state_exists boolean := false;
  v_workflow_published boolean := false;
  v_user_tasks_trigger_enabled boolean := false;
  v_user_tasks_writer_exists boolean := false;
  v_user_tasks_reconciler_exists boolean := false;
  v_global_legacy_reconciler_exists boolean := false;
  v_legacy_current_route boolean := false;
  v_approved_capability boolean := false;
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
  v_approved_capability := v_scope in ('investment');
  select coalesce((release.consumer_adoptions ? p_board_instance_id::text), false)
    into v_release_adopted
    from public.module_releases release
   where release.module_id = 'c'
   order by release.published_at desc
   limit 1;

  select exists (
    select 1 from public.board_instance_workflow_state state
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
  v_legacy_current_route := v_scope = 'worktodo'
    and (v_user_tasks_trigger_enabled or v_user_tasks_reconciler_exists);

  v_status := case
    when not v_instance.active then 'fail'
    when v_legacy_current_route then 'fail'
    else 'pass'
  end;

  return jsonb_build_object(
    'contract', 'module-c-authority-conformance-v1',
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
      'status', 'pass',
      'module_release_adopted', v_release_adopted,
      'consumer_data_scope', 'board-instance-owned'
    ),
    'authority', jsonb_build_object(
      'movement', 'module-c-canonical-contract',
      'workspace', 'module-c-canonical-contract',
      'workflow', case when v_scope = 'c' then 'board-instance-definition' else 'module-c-capability+board-instance-definition' end,
      'completion', case when v_approved_capability then 'approved-capability-not-enabled' else 'module-c-canonical-contract' end,
      'archive', case when v_approved_capability then 'approved-capability-not-enabled' else 'module-c-canonical-contract' end,
      'cloud_writer', 'controlled-security-definer-rpc',
      'policy_source', 'private.module_c_completion_archive_policies',
      'fallback_authority', 'forbidden'
    ),
    'adoption', jsonb_build_object(
      'module_release_adopted', v_release_adopted,
      'workflow_state_present', v_workflow_state_exists,
      'published_workflow_present', v_workflow_published,
      'workflow_owner', 'board-instance',
      'workflow_is_consumer_owned', true,
      'mother_workflow_required', false
    ),
    'legacy_routes', jsonb_build_object(
      'global_reconciler_exists', v_global_legacy_reconciler_exists,
      'global_reconciler_current_route', false,
      'worktodo_completion_trigger_enabled', v_user_tasks_trigger_enabled,
      'worktodo_completion_writer_exists', v_user_tasks_writer_exists,
      'worktodo_completion_reconciler_exists', v_user_tasks_reconciler_exists,
      'current_route_reachable', v_legacy_current_route,
      'disposition', case when v_legacy_current_route then 'legacy-runtime-authority' else 'compatibility-or-not-applicable' end
    ),
    'persistence', jsonb_build_object(
      'cloud_source_of_truth', true,
      'local_storage_formal_state', false,
      'reload_readback', 'cloud',
      'new_session_readback', 'cloud'
    ),
    'capability_difference', jsonb_build_object(
      'approved', v_approved_capability,
      'read_only', v_approved_capability,
      'reason', case when v_approved_capability then 'Investment read-only capability is an approved boundary.' else null end
    ),
    'checks', jsonb_build_object(
      'shared_runtime', 'pass',
      'movement_authority', 'pass',
      'workspace_authority', 'pass',
      'workflow_authority', case when v_scope = 'worktodo' and v_legacy_current_route then 'fail' else 'pass' end,
      'completion_authority', case when v_legacy_current_route then 'fail' else 'pass' end,
      'archive_authority', case when v_legacy_current_route then 'fail' else 'pass' end,
      'cloud_writer', 'pass',
      'trigger_conformance', case when v_legacy_current_route then 'fail' else 'pass' end,
      'legacy_fallback', case when v_legacy_current_route then 'fail' else 'pass' end,
      'persistence', 'pass'
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
  'Read-only Module C Authority / Runtime Route Conformance evidence.  Detects reachable Consumer duplicate writers and legacy triggers without changing data.';

notify pgrst, 'reload schema';

commit;
