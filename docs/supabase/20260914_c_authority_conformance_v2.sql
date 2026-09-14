-- Module C Authority / Runtime Route Conformance v2.
--
-- The existing public checker is the only C Authority judge.  This migration
-- extends that contract in place; it does not repair, migrate, adopt, move,
-- archive, provision, or otherwise mutate product data.
-- V2 overall status enum: 'healthy', 'partial', 'unhealthy', 'na', 'unknown'.

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
  v_release public.module_releases%rowtype;
  v_release_found boolean := false;
  v_scope text;
  v_template_instance boolean := false;
  v_approved_capability boolean := false;
  v_expected_adoption_key text;
  v_release_adoption_key text;
  v_release_adoption jsonb := '{}'::jsonb;
  v_release_adopted boolean := false;
  v_release_adoption_status text := 'fail';
  v_release_identity_status text := 'unknown';
  v_release_identity_reason text := 'Published Release or Consumer Adoption identity evidence is unavailable.';
  v_adoption_version text;
  v_adoption_build text;
  v_adoption_source_commit text;
  v_adoption_source_fingerprint text;

  v_policy_present boolean := false;
  v_policy_identity text;
  v_policy_version text;
  v_policy_delay_seconds integer;

  v_workflow_state_exists boolean := false;
  v_workflow_declared boolean := false;
  v_workflow_published boolean := false;
  v_workflow_invalid boolean := false;
  v_published_workflow_version_id uuid;
  v_workflow_step_count integer := 0;
  v_workflow_scope_errors integer := 0;

  v_completion_designation jsonb := '{}'::jsonb;
  v_completion_designation_status text := 'not_configured';
  v_archive_designation_status text := 'not_configured';
  v_completion_designation_error text;
  v_lifecycle_applicable boolean := false;

  v_shared_card_writer boolean := false;
  v_shared_workspace_writer boolean := false;
  v_shared_child_writer boolean := false;
  v_shared_movement_writer boolean := false;
  v_shared_completion_writer boolean := false;
  v_shared_archive_writer boolean := false;

  v_writer_surfaces jsonb := '[]'::jsonb;
  v_trigger_surfaces jsonb := '[]'::jsonb;
  v_findings jsonb := '[]'::jsonb;
  v_active_alternate_writer_count integer := 0;
  v_active_legacy_writer_count integer := 0;
  v_reachable_48h_writer_count integer := 0;
  v_alternate_card_writer_count integer := 0;
  v_alternate_workspace_writer_count integer := 0;
  v_alternate_movement_writer_count integer := 0;
  v_alternate_workflow_writer_count integer := 0;
  v_alternate_completion_writer_count integer := 0;
  v_alternate_archive_writer_count integer := 0;
  v_alternate_child_writer_count integer := 0;
  v_enabled_alternate_trigger_count integer := 0;
  v_active_legacy_trigger_count integer := 0;
  v_inactive_legacy_trigger_count integer := 0;
  v_user_tasks_trigger_enabled boolean := false;
  v_user_tasks_trigger_exists boolean := false;
  v_user_tasks_writer_exists boolean := false;
  v_user_tasks_reconciler_exists boolean := false;
  v_global_legacy_reconciler_exists boolean := false;
  v_global_pm_acceptance_exists boolean := false;
  v_legacy_current_route boolean := false;
  v_global_fallback_count integer := 0;
  v_global_fallback_status text := 'unknown';

  v_task_workspace_scope_errors integer := 0;
  v_task_workflow_scope_errors integer := 0;
  v_task_step_scope_errors integer := 0;
  v_vendor_scope_errors integer := 0;
  v_notification_scope_errors integer := 0;
  v_attachment_orphan_count integer := 0;
  v_checklist_orphan_count integer := 0;
  v_historical_activity_unknown_count integer := 0;
  v_data_scope_errors integer := 0;
  v_data_isolation_status text := 'unknown';
  v_runtime_route_status text := 'unknown';
  v_runtime_route_reason text := 'Cloud static evidence cannot prove Browser/source caller reachability.';
  v_persistence_status text := 'unknown';
  v_overall_status text := 'unknown';
  v_legacy_status text := 'unknown';
  v_legacy_compatible_status text := 'unknown';
  v_gap_count integer := 0;
  v_has_unhealthy boolean := false;
  v_has_unknown boolean := false;

  v_canonical_function_names text[] := array[
    'board_assign_consumer_scope',
    'board_provision_consumer',
    'board_instance_create_task',
    'board_instance_update_task_title',
    'board_instance_update_task_content',
    'board_instance_update_task_due_date',
    'board_instance_set_agreement_schedule',
    'board_instance_delete_task',
    'board_instance_create_workspace',
    'board_instance_rename_workspace',
    'board_instance_reorder_workspaces',
    'board_instance_add_task_checklist_item',
    'board_instance_update_task_checklist_item',
    'board_instance_delete_task_checklist_item',
    'board_instance_add_progress_note',
    'board_instance_edit_progress_note',
    'board_instance_delete_progress_note',
    'board_instance_prepare_task_attachment',
    'board_instance_prepare_progress_attachment',
    'board_instance_complete_attachment',
    'board_instance_request_attachment_delete',
    'board_instance_finalize_attachment_delete',
    'board_instance_cancel_attachment_delete',
    'board_instance_set_task_vendor_link',
    'board_c_reconcile_workspace_decision_v2',
    'board_c_reconcile_completion_archive_lifecycle_v2',
    'board_c_reconcile_completion_archive_lifecycle_core',
    'board_c_workflow_save_draft',
    'board_c_workflow_publish',
    'board_c_workflow_request_adoption',
    'board_c_workflow_approve_adoption',
    'board_c_workflow_set_step_mapping',
    'board_c_workflow_apply_card_mapping',
    'board_c_workflow_adopt_unbound_card_v2',
    'board_c_workflow_retire_legacy_workspace_v2'
  ];
  v_known_alternate_functions text[] := array[
    'board_instance_move_task_workspace',
    'board_instance_delete_workspace',
    'board_c_reconcile_workspace_decision',
    'board_c_workflow_reconcile_legacy_card_v2',
    'board_reconcile_completion_lifecycle',
    'board_reconcile_pm_acceptance_lifecycle',
    'board_pm_acceptance_from_qjc_drop',
    'worktodo_update_task',
    'worktodo_delete_task'
  ];
  v_canonical_trigger_names text[] := array[
    'board_instance_identity_immutable',
    'board_workflow_bind_new_task',
    'allocate_board_task_work_code',
    'enforce_board_task_scope',
    'enforce_module_c_workflow_invariant',
    'enforce_worktodo_workspace_scope'
  ];

  v_function record;
  v_trigger record;
  v_function_surface jsonb;
  v_trigger_surface jsonb;
  v_writes_c_owned boolean;
  v_writes_legacy boolean;
  v_application_reachable boolean;
  v_is_canonical boolean;
  v_is_alternate boolean;
  v_is_legacy boolean;
  v_definition text;
  v_capability text;
  v_target_relation text;
  v_trigger_canonical boolean;
  v_trigger_legacy boolean;
  v_trigger_alternate boolean;
  v_trigger_application_reachable boolean;
  v_trigger_enabled boolean;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authority Conformance Check 需要登入身分。';
  end if;

  if p_board_instance_id is null
     or not public.board_instance_can_read(p_board_instance_id) then
    raise exception using
      errcode = '42501',
      message = '沒有讀取此 Board Instance Authority Conformance 的權限。';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id;

  if not found or coalesce(v_instance.template_key, '') <> 'c' then
    raise exception using
      errcode = '55000',
      message = '指定的 Board Instance 不是可檢查的 Module C Consumer。';
  end if;

  v_scope := lower(nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), ''));
  v_template_instance := coalesce(v_instance.is_template_instance, false);
  v_approved_capability := coalesce(v_scope = 'investment', false)
    or coalesce(upper(v_instance.task_code_prefix) = 'IVTK', false);
  v_expected_adoption_key := case
    when v_template_instance then 'c'
    else v_scope
  end;

  select *
    into v_release
    from public.module_releases
   where module_id = 'c'
   order by updated_at desc nulls last
   limit 1;
  v_release_found := found;

  if v_release_found then
    select adoption.key, adoption.value
      into v_release_adoption_key, v_release_adoption
      from jsonb_each(coalesce(v_release.consumer_adoptions, '{}'::jsonb)) adoption
     where adoption.value->>'status' = 'adopted'
       and (
         adoption.key = p_board_instance_id::text
         or (
           v_expected_adoption_key is not null
           and replace(lower(adoption.key), '_', '-') =
               replace(lower(v_expected_adoption_key), '_', '-')
         )
       )
     order by (adoption.key = p_board_instance_id::text) desc
     limit 1;
    v_release_adopted := found
      and coalesce(v_release_adoption->>'status', '') = 'adopted';
  end if;

  v_adoption_version := coalesce(
    v_release_adoption->>'module_version',
    v_release_adoption->>'templateVersion',
    v_release_adoption->>'version'
  );
  v_adoption_build := v_release_adoption->>'build';
  v_adoption_source_commit := coalesce(
    v_release_adoption->>'source_commit',
    v_release_adoption->>'sourceCommit'
  );
  v_adoption_source_fingerprint := coalesce(
    v_release_adoption->>'source_fingerprint',
    v_release_adoption->>'sourceFingerprint'
  );

  if v_release_adopted
     and v_adoption_version = v_release.published_version
     and v_adoption_build = v_release.published_build then
    v_release_adoption_status := 'pass';
  end if;

  if not v_release_found or not v_release_adopted then
    v_release_identity_status := 'unknown';
    v_release_identity_reason := 'No adopted C Release record was found for this Board Instance.';
  elsif v_release_adoption_status <> 'pass' then
    v_release_identity_status := 'stale_adoption';
    v_release_identity_reason := 'Consumer Adoption version/build does not match the Published C Release.';
  elsif nullif(btrim(coalesce(v_release.source_commit, '')), '') is null
     or nullif(btrim(coalesce(v_release.source_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(v_adoption_source_commit, '')), '') is null
     or nullif(btrim(coalesce(v_adoption_source_fingerprint, '')), '') is null then
    v_release_identity_status := 'unknown';
    v_release_identity_reason := 'Published Release and Adoption lack complete sourceCommit/sourceFingerprint evidence.';
  elsif v_adoption_source_commit <> v_release.source_commit
     or v_adoption_source_fingerprint <> v_release.source_fingerprint then
    v_release_identity_status := 'identity_mismatch';
    v_release_identity_reason := 'Consumer Adoption source identity does not match the Published C Release.';
  else
    v_release_identity_status := 'published_match';
    v_release_identity_reason := 'Published C Release and Consumer Adoption source identity match.';
  end if;

  select policy_identity,
         policy_version::text,
         archive_delay_seconds
    into v_policy_identity, v_policy_version, v_policy_delay_seconds
    from private.module_c_completion_archive_policies policy
   where policy.policy_key = 'completion_archive'
     and policy.status = 'published'
     and policy.archive_delay_seconds = 86400
   order by policy_version desc nulls last
   limit 1;
  v_policy_present := found
    and v_policy_identity = 'module-c-completion-archive-policy'
    and v_policy_delay_seconds = 86400;

  select exists (
           select 1
             from public.board_instance_workflow_state state
            where state.board_instance_id = p_board_instance_id
         )
    into v_workflow_state_exists;

  select coalesce(bool_or(state.published_workflow_version_id is not null), false)
    into v_workflow_declared
    from public.board_instance_workflow_state state
   where state.board_instance_id = p_board_instance_id;

  select state.published_workflow_version_id
    into v_published_workflow_version_id
    from public.board_instance_workflow_state state
   where state.board_instance_id = p_board_instance_id
     and state.published_workflow_version_id is not null
   limit 1;
  v_workflow_published := found
    and exists (
      select 1
        from public.board_workflow_definitions definition
       where definition.id = v_published_workflow_version_id
         and definition.board_instance_id = p_board_instance_id
         and definition.status = 'published'
         and definition.published_at is not null
    );
  v_workflow_invalid := v_workflow_declared and not v_workflow_published;

  if v_workflow_published then
    select count(*)
      into v_workflow_step_count
      from public.board_workflow_steps step
     where step.workflow_version_id = v_published_workflow_version_id;

    select count(*)
      into v_workflow_scope_errors
      from public.board_workflow_steps step
      left join public.board_workspaces workspace
        on workspace.id = step.workspace_id
     where step.workflow_version_id = v_published_workflow_version_id
       and (
         workspace.id is null
         or workspace.board_instance_id is distinct from p_board_instance_id
       );
    v_workflow_invalid := v_workflow_step_count = 0
      or v_workflow_scope_errors > 0;
  end if;

  begin
    select private.board_c_completion_archive_designation(p_board_instance_id)
      into v_completion_designation;
    v_completion_designation_status := coalesce(
      v_completion_designation->>'status',
      'not_configured'
    );
    v_archive_designation_status := coalesce(
      v_completion_designation->>'archive_status',
      v_completion_designation->>'archiveStatus',
      v_completion_designation_status
    );
  exception when others then
    v_completion_designation_status := 'invalid';
    v_archive_designation_status := 'invalid';
    v_completion_designation_error := sqlerrm;
  end;

  if v_completion_designation_status in ('configured', 'pass')
     and nullif(v_completion_designation->>'workspace_id', '') is not null
     and not exists (
       select 1
         from public.board_workspaces workspace
        where workspace.id::text = v_completion_designation->>'workspace_id'
          and workspace.board_instance_id = p_board_instance_id
     ) then
    v_completion_designation_status := 'invalid';
    v_completion_designation_error := 'Completion designation workspace is outside this Board Instance.';
  end if;

  if v_archive_designation_status in ('configured', 'pass')
     and nullif(v_completion_designation->>'archive_workspace_id', '') is not null
     and not exists (
       select 1
         from public.board_workspaces workspace
        where workspace.id::text = v_completion_designation->>'archive_workspace_id'
          and workspace.board_instance_id = p_board_instance_id
     ) then
    v_archive_designation_status := 'invalid';
    v_completion_designation_error := 'Archive designation workspace is outside this Board Instance.';
  end if;
  v_lifecycle_applicable := not v_approved_capability
    and v_completion_designation_status not in ('not_configured', 'not_applicable');

  select count(distinct p.proname) = 3
    into v_shared_card_writer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'board_instance_create_task',
       'board_instance_update_task_title',
       'board_instance_delete_task'
     )
     and has_function_privilege('authenticated', p.oid, 'execute');

  select count(distinct p.proname) = 4
    into v_shared_workspace_writer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'board_instance_create_workspace',
       'board_instance_rename_workspace',
       'board_instance_reorder_workspaces',
       'board_instance_delete_workspace'
     )
     and has_function_privilege('authenticated', p.oid, 'execute');

  select count(distinct p.proname) >= 3
    into v_shared_child_writer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'board_instance_add_task_checklist_item',
       'board_instance_add_progress_note',
       'board_instance_prepare_task_attachment'
     )
     and has_function_privilege('authenticated', p.oid, 'execute');

  select exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = 'board_c_reconcile_workspace_decision_v2'
              and has_function_privilege('authenticated', p.oid, 'execute')
         )
    into v_shared_movement_writer;
  v_shared_completion_writer := v_shared_movement_writer;

  select exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = 'board_c_reconcile_completion_archive_lifecycle_v2'
              and has_function_privilege('authenticated', p.oid, 'execute')
         )
     and exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private'
              and p.proname = 'board_c_reconcile_completion_archive_lifecycle_core'
         )
    into v_shared_archive_writer;

  /*
   * Inventory function bodies and execute surfaces.  A function is not
   * classified by name alone: existence, body target, grant, and the
   * canonical name are all considered.
   */
  for v_function in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments,
           pg_get_functiondef(p.oid) as function_definition,
           length(pg_get_functiondef(p.oid)) as function_definition_length,
           has_function_privilege('anon', p.oid, 'execute') as anon_execute,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
           has_function_privilege('service_role', p.oid, 'execute') as service_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
       and p.oid <> to_regprocedure(
         'public.board_c_authority_conformance_check(uuid)'
       )::oid
       and (
         p.proname ~* '(board|task|workspace|workflow|completion|archive|lifecycle|worktodo|checklist|progress|attachment|vendor|acceptance)'
         or pg_get_functiondef(p.oid) ~* '(board_tasks|board_workspaces|board_workflow|board_task_|board_instance_workflow_state|user_tasks|work_journal_entries)'
       )
  loop
    v_definition := coalesce(v_function.function_definition, '');
    v_application_reachable := coalesce(v_function.anon_execute, false)
      or coalesce(v_function.authenticated_execute, false);
    v_is_canonical := v_function.function_name = any(v_canonical_function_names);
    v_is_legacy := v_function.function_name ~* '(legacy|old|deprecated|compatibility|migration|fallback|v1)'
      or v_function.function_name in (
        'worktodo_create_task',
        'worktodo_reconcile_completion_lifecycle',
        'worktodo_apply_completion_lifecycle'
      );
    v_writes_c_owned := v_definition ~* (
      '(insert|update|delete)[[:space:]]+([^;]*)(board_tasks|board_workspaces|board_workflow_definitions|board_workflow_steps|board_instance_workflow_state|board_task_|board_workspace_notification_settings)'
    )
      or v_function.function_name = any(v_known_alternate_functions);
    v_writes_legacy := v_definition ~* (
      '(insert|update|delete)[[:space:]]+([^;]*)(user_tasks|work_journal_entries)'
    );
    v_is_alternate := v_application_reachable
      and v_writes_c_owned
      and not v_is_canonical;

    if v_function.function_name ~* '(move|movement)' then
      v_capability := 'movement';
    elsif v_function.function_name ~* '(workspace)' then
      v_capability := 'workspace';
    elsif v_function.function_name ~* '(workflow)' then
      v_capability := 'workflow';
    elsif v_function.function_name ~* '(completion|archive|lifecycle|acceptance)' then
      v_capability := 'completion_archive';
    elsif v_function.function_name ~* '(checklist|progress|attachment|vendor|agreement|schedule)' then
      v_capability := 'child';
    else
      v_capability := 'card';
    end if;

    v_target_relation := case
      when v_writes_c_owned then 'c-owned'
      when v_writes_legacy then 'legacy-worktodo'
      else 'read-or-unresolved'
    end;

    if v_writes_c_owned or v_writes_legacy or v_is_legacy then
      v_function_surface := jsonb_build_object(
        'schema', v_function.schema_name,
        'name', v_function.function_name,
        'identity_arguments', v_function.identity_arguments,
        'exists', true,
        'authenticated_execute', coalesce(v_function.authenticated_execute, false),
        'anon_execute', coalesce(v_function.anon_execute, false),
        'service_execute', coalesce(v_function.service_execute, false),
        'application_reachable', v_application_reachable,
        'canonical', v_is_canonical,
        'alternate', v_is_alternate,
        'legacy', v_is_legacy,
        'capability', v_capability,
        'target', v_target_relation,
        'body_inspected', true,
        'body_length', v_function.function_definition_length,
        'body_targets_c_owned', v_writes_c_owned,
        'body_targets_legacy', v_writes_legacy,
        'classification', case
          when v_is_alternate then 'ALTERNATE'
          when v_is_canonical then 'CANONICAL'
          when v_application_reachable and v_is_legacy then 'LEGACY_REACHABLE'
          when v_is_legacy then 'HISTORICAL_COMPATIBILITY'
          else 'UNRESOLVED'
        end
      );
      v_writer_surfaces := v_writer_surfaces
        || jsonb_build_array(v_function_surface);
    end if;

    if v_is_alternate then
      v_active_alternate_writer_count := v_active_alternate_writer_count + 1;
      v_gap_count := v_gap_count + 1;
      v_has_unhealthy := true;
      case v_capability
        when 'movement' then v_alternate_movement_writer_count := v_alternate_movement_writer_count + 1;
        when 'workspace' then v_alternate_workspace_writer_count := v_alternate_workspace_writer_count + 1;
        when 'workflow' then v_alternate_workflow_writer_count := v_alternate_workflow_writer_count + 1;
        when 'completion_archive' then
          v_alternate_completion_writer_count := v_alternate_completion_writer_count + 1;
          v_alternate_archive_writer_count := v_alternate_archive_writer_count + 1;
        when 'child' then v_alternate_child_writer_count := v_alternate_child_writer_count + 1;
        else v_alternate_card_writer_count := v_alternate_card_writer_count + 1;
      end case;
      v_findings := v_findings || jsonb_build_array(jsonb_build_object(
        'rule', 'reachable-alternate-c-owned-writer',
        'status', 'unhealthy',
        'reason', 'Application-reachable function body writes or delegates C-owned state outside the canonical C contract.',
        'evidence', v_function_surface,
        'affected_capability', v_capability,
        'authority_surface', v_function.schema_name || '.' || v_function.function_name
      ));
    end if;

    if v_application_reachable
       and v_writes_legacy then
      v_active_legacy_writer_count := v_active_legacy_writer_count + 1;
      if v_function.function_name ~* '(completion|archive|lifecycle)'
         or v_is_legacy then
        v_legacy_current_route := true;
      end if;
    end if;

    if v_application_reachable
       and not v_is_canonical
       and v_definition ~* '(172800|interval[[:space:]]*''48[[:space:]]*hours?'')'
       and v_definition ~* '(completion|archive|lifecycle)' then
      v_reachable_48h_writer_count := v_reachable_48h_writer_count + 1;
      v_gap_count := v_gap_count + 1;
      v_has_unhealthy := true;
      v_findings := v_findings || jsonb_build_array(jsonb_build_object(
        'rule', 'no-reachable-legacy-48h-writer',
        'status', 'unhealthy',
        'reason', 'A reachable non-canonical lifecycle writer contains the retired 48-hour policy.',
        'evidence', v_function_surface,
        'affected_capability', 'completion_archive',
        'authority_surface', v_function.schema_name || '.' || v_function.function_name
      ));
    end if;

    if v_application_reachable
       and v_function.function_name in (
         'board_reconcile_completion_lifecycle',
         'board_reconcile_pm_acceptance_lifecycle'
       ) then
      v_global_fallback_count := v_global_fallback_count + 1;
    end if;
  end loop;

  for v_trigger in
    select table_schema.nspname as table_schema,
           table_row.relname as table_name,
           trigger_row.tgname as trigger_name,
           trigger_row.tgenabled <> 'D' as trigger_enabled,
           pg_get_triggerdef(trigger_row.oid, true) as trigger_definition,
           function_schema.nspname as function_schema,
           function_row.proname as function_name,
           pg_get_function_identity_arguments(function_row.oid) as identity_arguments,
           has_function_privilege('anon', function_row.oid, 'execute') as anon_execute,
           has_function_privilege('authenticated', function_row.oid, 'execute') as authenticated_execute,
           has_function_privilege('service_role', function_row.oid, 'execute') as service_execute
      from pg_trigger trigger_row
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace table_schema on table_schema.oid = table_row.relnamespace
      join pg_proc function_row on function_row.oid = trigger_row.tgfoid
      join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
     where not trigger_row.tgisinternal
       and table_schema.nspname = 'public'
       and table_row.relname in (
         'board_tasks',
         'board_workspaces',
         'board_task_attachments',
         'board_task_checklist_items',
         'board_task_vendor_links',
         'board_workspace_notification_settings',
         'user_tasks'
       )
  loop
    v_trigger_enabled := v_trigger.trigger_enabled;
    v_trigger_application_reachable := coalesce(v_trigger.anon_execute, false)
      or coalesce(v_trigger.authenticated_execute, false);
    v_trigger_canonical := v_trigger.function_name = any(v_canonical_trigger_names);
    v_trigger_legacy := v_trigger.function_name ~* '(worktodo|legacy|deprecated|fallback|v1)'
      or v_trigger.table_name = 'user_tasks';
    -- Legacy tables are reported separately.  Their enabled triggers are not
    -- C-owned alternate triggers unless they are attached to C-owned tables.
    v_trigger_alternate := v_trigger_enabled
      and not v_trigger_canonical
      and not v_trigger_legacy;
    v_trigger_surface := jsonb_build_object(
      'table_schema', v_trigger.table_schema,
      'table', v_trigger.table_name,
      'trigger', v_trigger.trigger_name,
      'exists', true,
      'enabled', v_trigger_enabled,
      'definition', v_trigger.trigger_definition,
      'function_schema', v_trigger.function_schema,
      'function', v_trigger.function_name,
      'identity_arguments', v_trigger.identity_arguments,
      'authenticated_execute', coalesce(v_trigger.authenticated_execute, false),
      'anon_execute', coalesce(v_trigger.anon_execute, false),
      'service_execute', coalesce(v_trigger.service_execute, false),
      'application_reachable', v_trigger_application_reachable,
      'canonical', v_trigger_canonical,
      'legacy', v_trigger_legacy,
      'classification', case
        when v_trigger_alternate then 'ALTERNATE'
        when v_trigger_canonical then 'CANONICAL'
        when v_trigger_legacy then 'LEGACY_COMPATIBILITY'
        else 'UNRESOLVED'
      end
    );
    v_trigger_surfaces := v_trigger_surfaces
      || jsonb_build_array(v_trigger_surface);

    if v_trigger.table_name = 'user_tasks'
       and v_trigger.function_name = 'worktodo_apply_completion_lifecycle' then
      v_user_tasks_trigger_exists := true;
      if v_trigger_enabled then
        v_user_tasks_trigger_enabled := true;
      end if;
    end if;

    if v_trigger_enabled and v_trigger_alternate then
      v_enabled_alternate_trigger_count := v_enabled_alternate_trigger_count + 1;
      v_gap_count := v_gap_count + 1;
      v_has_unhealthy := true;
      v_findings := v_findings || jsonb_build_array(jsonb_build_object(
        'rule', 'enabled-alternate-c-owned-trigger',
        'status', 'unhealthy',
        'reason', 'An enabled trigger is outside the canonical C trigger set and may write current state.',
        'evidence', v_trigger_surface,
        'affected_capability', case
          when v_trigger.table_name = 'user_tasks' then 'legacy-worktodo-lifecycle'
          else 'c-owned-state'
        end,
        'authority_surface', v_trigger.function_schema || '.' || v_trigger.function_name
      ));
    elsif v_trigger_enabled and v_trigger_legacy and not v_trigger_canonical then
      v_active_legacy_trigger_count := v_active_legacy_trigger_count + 1;
      if v_trigger.function_name ~* '(completion|archive|lifecycle)' then
        v_legacy_current_route := true;
      end if;
    elsif not v_trigger_enabled and v_trigger_legacy then
      v_inactive_legacy_trigger_count := v_inactive_legacy_trigger_count + 1;
    end if;
  end loop;

  v_user_tasks_writer_exists := exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'worktodo_apply_completion_lifecycle'
  );
  v_user_tasks_reconciler_exists := exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'worktodo_reconcile_completion_lifecycle'
  );
  v_global_legacy_reconciler_exists := exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'board_reconcile_completion_lifecycle'
  );
  v_global_pm_acceptance_exists := exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'board_reconcile_pm_acceptance_lifecycle'
  );

  select count(*)
    into v_task_workspace_scope_errors
    from public.board_tasks task
    left join public.board_workspaces workspace
      on workspace.id = task.workspace_id
   where task.board_instance_id = p_board_instance_id
     and (
       workspace.id is null
       or workspace.board_instance_id is distinct from p_board_instance_id
     );

  select count(*)
    into v_task_workflow_scope_errors
    from public.board_tasks task
    left join public.board_workflow_definitions definition
      on definition.id = task.workflow_version_id
   where task.board_instance_id = p_board_instance_id
     and task.workflow_version_id is not null
     and (
       definition.id is null
       or definition.board_instance_id is distinct from p_board_instance_id
     );

  select count(*)
    into v_task_step_scope_errors
    from public.board_tasks task
    left join public.board_workflow_steps step
      on step.id = task.current_workflow_step_id
    left join public.board_workflow_definitions definition
      on definition.id = step.workflow_version_id
   where task.board_instance_id = p_board_instance_id
     and task.current_workflow_step_id is not null
     and (
       step.id is null
       or definition.id is null
       or definition.board_instance_id is distinct from p_board_instance_id
     );

  select count(*)
    into v_vendor_scope_errors
    from public.board_task_vendor_links link
    left join public.board_tasks task on task.id = link.task_id
   where (
     task.board_instance_id = p_board_instance_id
     and link.board_instance_id is distinct from p_board_instance_id
   )
   or (
     link.board_instance_id = p_board_instance_id
     and (
       task.id is null
       or task.board_instance_id is distinct from p_board_instance_id
     )
   );

  select count(*)
    into v_notification_scope_errors
    from public.board_workspace_notification_settings setting
    left join public.board_workspaces workspace on workspace.id = setting.workspace_id
   where (
     workspace.board_instance_id = p_board_instance_id
     and setting.board_instance_id is distinct from p_board_instance_id
   )
   or (
     setting.board_instance_id = p_board_instance_id
     and (
       workspace.id is null
       or workspace.board_instance_id is distinct from p_board_instance_id
     )
   );

  select count(*)
    into v_attachment_orphan_count
    from public.board_task_attachments attachment
   where attachment.task_id is null
      or not exists (
        select 1
          from public.board_tasks task
         where task.id = attachment.task_id
      );

  select count(*)
    into v_checklist_orphan_count
    from public.board_task_checklist_items checklist
   where checklist.task_id is null
      or not exists (
        select 1
          from public.board_tasks task
         where task.id = checklist.task_id
      );

  select count(*)
    into v_historical_activity_unknown_count
    from public.engineering_activity_log activity
   where activity.entity_id is not null
     and activity.entity_type ~* '(task|card)'
     and not exists (
       select 1
         from public.board_tasks task
        where task.id::text = activity.entity_id::text
     );

  v_data_scope_errors := v_task_workspace_scope_errors
    + v_task_workflow_scope_errors
    + v_task_step_scope_errors
    + v_vendor_scope_errors
    + v_notification_scope_errors
    + v_attachment_orphan_count
    + v_checklist_orphan_count;
  v_data_isolation_status := case
    when v_data_scope_errors > 0 then 'fail'
    when v_historical_activity_unknown_count > 0 then 'unknown'
    else 'pass'
  end;
  if v_data_scope_errors > 0 then
    v_gap_count := v_gap_count + v_data_scope_errors;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'c-owned-data-instance-isolation',
      'status', 'unhealthy',
      'reason', 'One or more C-owned records cross the Board Instance boundary.',
      'evidence', jsonb_build_object(
        'task_workspace_scope_errors', v_task_workspace_scope_errors,
        'task_workflow_scope_errors', v_task_workflow_scope_errors,
        'task_step_scope_errors', v_task_step_scope_errors,
        'vendor_scope_errors', v_vendor_scope_errors,
        'notification_scope_errors', v_notification_scope_errors,
        'attachment_orphans', v_attachment_orphan_count,
        'checklist_orphans', v_checklist_orphan_count
      ),
      'affected_capability', 'data_isolation',
      'authority_surface', 'c-owned-table-contract'
    ));
  elsif v_historical_activity_unknown_count > 0 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'historical-parentless-activity',
      'status', 'unknown',
      'reason', 'Historical activity has unmatched entity IDs; it was not assigned to this Consumer.',
      'evidence', jsonb_build_object(
        'unmatched_activity_count', v_historical_activity_unknown_count
      ),
      'affected_capability', 'data_isolation',
      'authority_surface', 'engineering_activity_log'
    ));
  end if;

  v_global_fallback_status := case
    when v_global_fallback_count > 0 then 'fail'
    else 'unknown'
  end;
  if v_global_fallback_count > 0 then
    v_gap_count := v_gap_count + v_global_fallback_count;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'no-global-completion-fallback',
      'status', 'unhealthy',
      'reason', 'An application-reachable route can resolve completion/archive state through a global fallback.',
      'evidence', jsonb_build_object('matched_route_count', v_global_fallback_count),
      'affected_capability', 'completion_archive',
      'authority_surface', 'global-workspace-resolution'
    ));
  end if;

  if v_active_legacy_writer_count > 0 then
    v_legacy_current_route := true;
    v_has_unhealthy := true;
    v_gap_count := v_gap_count + v_active_legacy_writer_count;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'no-reachable-legacy-writer',
      'status', 'unhealthy',
      'reason', 'An application-reachable legacy writer targets legacy WorkTodo state.',
      'evidence', jsonb_build_object(
        'active_legacy_writer_count', v_active_legacy_writer_count
      ),
      'affected_capability', 'legacy-worktodo',
      'authority_surface', 'user_tasks-runtime'
    ));
  end if;

  if v_reachable_48h_writer_count > 0 then
    v_legacy_current_route := true;
  end if;

  v_runtime_route_status := case
    when v_legacy_current_route or v_active_alternate_writer_count > 0
      or v_enabled_alternate_trigger_count > 0 then 'fail'
    else 'unknown'
  end;
  v_runtime_route_reason := case
    when v_runtime_route_status = 'fail'
      then 'Cloud evidence found an application-reachable legacy or alternate writer surface.'
    else 'Only Cloud static catalog evidence is available; Browser/source caller reachability remains unproven.'
  end;

  v_legacy_status := case
    when v_legacy_current_route then 'active'
    when v_active_legacy_writer_count > 0 then 'reachable_compatibility'
    when v_inactive_legacy_trigger_count > 0 then 'inactive_compatibility'
    else 'not_evidenced'
  end;
  v_legacy_compatible_status := case
    when v_inactive_legacy_trigger_count > 0 and not v_legacy_current_route
      then 'compatibility_inactive'
    when v_active_legacy_writer_count > 0
      then 'compatibility_reachable'
    else 'not_evidenced'
  end;

  v_has_unknown := v_release_identity_status = 'unknown'
    or v_runtime_route_status = 'unknown'
    or v_global_fallback_status = 'unknown'
    or v_data_isolation_status = 'unknown'
    or v_persistence_status = 'unknown';
  v_overall_status := case
    when not coalesce(v_instance.active, false) then 'unhealthy'
    when v_has_unhealthy then 'unhealthy'
    when v_has_unknown then 'partial'
    else 'healthy'
  end;
  v_legacy_status := case
    when v_legacy_current_route then 'active'
    when v_inactive_legacy_trigger_count > 0 then 'inactive_compatibility'
    else 'retired_or_not_evidenced'
  end;
  v_legacy_compatible_status := case
    when v_active_legacy_writer_count > 0 then 'compatibility_reachable'
    when v_inactive_legacy_trigger_count > 0 then 'compatibility_inactive'
    else 'none_evidenced'
  end;

  if not coalesce(v_instance.active, false) then
    v_gap_count := v_gap_count + 1;
  end if;
  if v_release_adoption_status <> 'pass' then
    v_gap_count := v_gap_count + 1;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'published-release-adoption',
      'status', 'unhealthy',
      'reason', 'Consumer Release Adoption version/build does not match the published C Release.',
      'evidence', jsonb_build_object(
        'adoption_key', v_release_adoption_key,
        'adoption_version', v_adoption_version,
        'adoption_build', v_adoption_build,
        'published_version', case when v_release_found then v_release.published_version else null end,
        'published_build', case when v_release_found then v_release.published_build else null end
      ),
      'affected_capability', 'release_adoption',
      'authority_surface', 'public.module_releases.consumer_adoptions'
    ));
  end if;
  if v_release_identity_status = 'identity_mismatch' then
    v_gap_count := v_gap_count + 1;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'published-release-source-identity',
      'status', 'unhealthy',
      'reason', v_release_identity_reason,
      'evidence', jsonb_build_object(
        'published_source_commit', v_release.source_commit,
        'published_source_fingerprint', v_release.source_fingerprint,
        'adoption_source_commit', v_adoption_source_commit,
        'adoption_source_fingerprint', v_adoption_source_fingerprint
      ),
      'affected_capability', 'release_identity',
      'authority_surface', 'public.module_releases'
    ));
  elsif v_release_identity_status = 'unknown' then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'published-release-source-identity-evidence',
      'status', 'unknown',
      'reason', v_release_identity_reason,
      'evidence', jsonb_build_object(
        'published_source_commit', case when v_release_found then v_release.source_commit else null end,
        'published_source_fingerprint', case when v_release_found then v_release.source_fingerprint else null end,
        'adoption_source_commit', v_adoption_source_commit,
        'adoption_source_fingerprint', v_adoption_source_fingerprint
      ),
      'affected_capability', 'release_identity',
      'authority_surface', 'public.module_releases'
    ));
  end if;

  if not v_policy_present then
    v_gap_count := v_gap_count + 1;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'module-c-shared-policy',
      'status', 'unhealthy',
      'reason', 'The canonical Module C completion/archive policy is not the published 86400-second policy.',
      'evidence', jsonb_build_object(
        'policy_identity', v_policy_identity,
        'policy_version', v_policy_version,
        'archive_delay_seconds', v_policy_delay_seconds
      ),
      'affected_capability', 'completion_archive',
      'authority_surface', 'private.module_c_completion_archive_policies'
    ));
  end if;
  if v_workflow_invalid then
    v_gap_count := v_gap_count + 1;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'published-workflow-instance-scope',
      'status', 'unhealthy',
      'reason', 'A declared Published Workflow is missing, invalid, empty, or outside the Board Instance scope.',
      'evidence', jsonb_build_object(
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', v_published_workflow_version_id,
        'step_count', v_workflow_step_count,
        'scope_errors', v_workflow_scope_errors
      ),
      'affected_capability', 'workflow',
      'authority_surface', 'public.board_instance_workflow_state'
    ));
  end if;
  if v_completion_designation_status = 'invalid'
     or v_archive_designation_status = 'invalid' then
    v_gap_count := v_gap_count + 1;
    v_has_unhealthy := true;
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'rule', 'completion-archive-designation-scope',
      'status', 'unhealthy',
      'reason', coalesce(v_completion_designation_error, 'Completion or Archive designation is invalid.'),
      'evidence', v_completion_designation,
      'affected_capability', 'completion_archive',
      'authority_surface', 'private.board_c_completion_archive_designation'
    ));
  end if;

  -- Recompute the V2 result after every evidence source has been evaluated.
  -- Unknown runtime/persistence evidence is deliberately partial, never pass.
  v_has_unknown := v_release_identity_status = 'unknown'
    or v_runtime_route_status = 'unknown'
    or v_global_fallback_status = 'unknown'
    or v_data_isolation_status = 'unknown'
    or v_persistence_status = 'unknown';
  v_overall_status := case
    when not coalesce(v_instance.active, false) then 'unhealthy'
    when v_has_unhealthy then 'unhealthy'
    when v_has_unknown then 'partial'
    else 'healthy'
  end;

  return jsonb_build_object(
    'contract', 'module-c-authority-conformance-v2',
    'schema_version', 2,
    'contract_family', 'module-c-lifecycle-acceptance',
    -- status is retained for current clients; overall.status is the V2 enum.
    'status', case when v_overall_status = 'healthy' then 'pass' else 'fail' end,
    'v2_status', v_overall_status,
    'board_instance_id', v_instance.id,
    'template_key', v_instance.template_key,
    'application_scope', v_scope,
    'consumer', jsonb_build_object(
      'name', v_instance.name,
      'board_instance_id', v_instance.id,
      'template_key', v_instance.template_key,
      'active', coalesce(v_instance.active, false),
      'approved_capability_difference', v_approved_capability
    ),
    'feature', jsonb_build_object(
      'status', 'pass',
      'shared_runtime', 'module-c-golden-master-runtime',
      'shared_capability_source', 'module-c-mother'
    ),
    'source', jsonb_build_object(
      'status', case when v_release_adoption_status = 'pass' then 'pass' else 'unknown' end,
      'module_release_adopted', v_release_adopted,
      'module_adoption_key', v_release_adoption_key,
      'consumer_data_scope', 'board-instance-owned'
    ),
    'release', jsonb_build_object(
      'module_id', 'c',
      'published_version', case when v_release_found then v_release.published_version else null end,
      'published_build', case when v_release_found then v_release.published_build else null end,
      'published_source_commit', case when v_release_found then v_release.source_commit else null end,
      'published_source_fingerprint', case when v_release_found then v_release.source_fingerprint else null end,
      'adoption_key', v_release_adoption_key,
      'adoption_status', v_release_adoption_status,
      'identity_status', v_release_identity_status,
      'identity_reason', v_release_identity_reason,
      'runtime_identity_evidence', 'not supplied to Cloud checker'
    ),
    'authority', jsonb_build_object(
      'card', case when v_shared_card_writer and v_alternate_card_writer_count = 0 then 'module-c-canonical-contract' else 'unverified' end,
      'workspace', case when v_shared_workspace_writer and v_alternate_workspace_writer_count = 0 then 'module-c-canonical-contract' else 'unverified' end,
      'movement', case when v_shared_movement_writer and v_alternate_movement_writer_count = 0 then 'module-c-canonical-contract' else 'unverified' end,
      'workflow', case when v_workflow_published then 'board-instance-definition' else 'capability-not-configured' end,
      'completion', case
        when not v_lifecycle_applicable then 'capability-not-enabled'
        when v_legacy_current_route then 'legacy-worktodo-route'
        when v_shared_completion_writer then 'module-c-canonical-contract'
        else 'unverified'
      end,
      'archive', case
        when not v_lifecycle_applicable then 'capability-not-enabled'
        when v_legacy_current_route then 'legacy-worktodo-route'
        when v_shared_archive_writer then 'module-c-canonical-contract'
        else 'unverified'
      end,
      'cloud_writer', case when v_shared_archive_writer and v_alternate_archive_writer_count = 0 then 'controlled-security-definer-rpc+private-core' else 'unverified' end,
      'policy_source', 'private.module_c_completion_archive_policies',
      'fallback_authority', 'forbidden'
    ),
    'adoption', jsonb_build_object(
      'module_release_adopted', v_release_adopted,
      'module_adoption_key', v_release_adoption_key,
      'workflow_state_present', v_workflow_state_exists,
      'published_workflow_present', v_workflow_published,
      'workflow_declared', v_workflow_declared,
      'workflow_optional', true,
      'workflow_owner', 'board-instance',
      'workflow_is_consumer_owned', true,
      'mother_workflow_required', false,
      'identity_status', v_release_identity_status
    ),
    'workflow', jsonb_build_object(
      'status', case
        when v_workflow_invalid then 'invalid'
        when v_workflow_published then 'published'
        else 'not_configured'
      end,
      'optional', true,
      'state', case
        when v_workflow_invalid then 'fail'
        when v_workflow_published then 'pass'
        else 'not_applicable'
      end,
      'version_id', v_published_workflow_version_id,
      'step_count', v_workflow_step_count,
      'scope_errors', v_workflow_scope_errors
    ),
    'completion_designation', jsonb_build_object(
      'status', v_completion_designation_status,
      'source', coalesce(v_completion_designation->>'source', 'stable-workspace-key'),
      'workspace_id', v_completion_designation->>'workspace_id',
      'workspace_key', v_completion_designation->>'workspace_key',
      'error', v_completion_designation_error
    ),
    'archive_designation', jsonb_build_object(
      'status', v_archive_designation_status,
      'source', coalesce(v_completion_designation->>'source', 'stable-workspace-key'),
      'workspace_id', coalesce(
        v_completion_designation->>'archive_workspace_id',
        v_completion_designation->>'workspace_id'
      ),
      'workspace_key', coalesce(
        v_completion_designation->>'archive_workspace_key',
        v_completion_designation->>'workspace_key'
      ),
      'error', v_completion_designation_error
    ),
    'completion', jsonb_build_object(
      'status', case
        when not v_lifecycle_applicable then 'not_configured'
        when v_completion_designation_status = 'invalid' then 'invalid'
        when v_shared_completion_writer and v_policy_present and v_alternate_completion_writer_count = 0 then 'configured'
        else 'unverified'
      end,
      'entry_authority', case when v_shared_completion_writer then 'module-c-canonical-contract' else 'unverified' end,
      'policy_identity', v_policy_identity,
      'policy_version', v_policy_version,
      'archive_delay_seconds', v_policy_delay_seconds,
      'existing_due_at_retroactive', false
    ),
    'policy', jsonb_build_object(
      'source', 'private.module_c_completion_archive_policies',
      'identity', v_policy_identity,
      'policy_version', v_policy_version,
      'current_delay_seconds', v_policy_delay_seconds,
      'existing_due_at_retroactive', false
    ),
    'runtime', jsonb_build_object(
      'status', v_runtime_route_status,
      'entry', null,
      'current_authority', case
        when v_runtime_route_status = 'fail' then 'authority-conflict-detected'
        else 'module-c-canonical-contract-unverified'
      end,
      'evidence_type', 'cloud-static',
      'reason', v_runtime_route_reason
    ),
    'runtime_route', jsonb_build_object(
      'status', v_runtime_route_status,
      'current_authority', case
        when v_legacy_current_route then 'legacy-or-alternate-route'
        else 'module-c-canonical-contract-unverified'
      end,
      'global_fallback_allowed', false,
      'local_storage_allowed', false,
      'consumer_override_allowed', false,
      'evidence_type', 'cloud-static'
    ),
    'data_isolation', jsonb_build_object(
      'status', v_data_isolation_status,
      'task_workspace_scope_errors', v_task_workspace_scope_errors,
      'task_workflow_scope_errors', v_task_workflow_scope_errors,
      'task_step_scope_errors', v_task_step_scope_errors,
      'vendor_scope_errors', v_vendor_scope_errors,
      'notification_scope_errors', v_notification_scope_errors,
      'attachment_orphans', v_attachment_orphan_count,
      'checklist_orphans', v_checklist_orphan_count,
      'historical_activity_unknown', v_historical_activity_unknown_count,
      'evidence_type', 'cloud-read-only'
    ),
    'legacy_routes', jsonb_build_object(
      'global_reconciler_exists', v_global_legacy_reconciler_exists,
      'global_reconciler_current_route', false,
      'global_pm_acceptance_exists', v_global_pm_acceptance_exists,
      'worktodo_completion_trigger_exists', v_user_tasks_trigger_exists,
      'worktodo_completion_trigger_enabled', v_user_tasks_trigger_enabled,
      'worktodo_completion_writer_exists', v_user_tasks_writer_exists,
      'worktodo_completion_reconciler_exists', v_user_tasks_reconciler_exists,
      'current_route_reachable', v_legacy_current_route,
      'active_legacy_writer_count', v_active_legacy_writer_count,
      'reachable_48h_writer_count', v_reachable_48h_writer_count,
      'active_legacy_trigger_count', v_active_legacy_trigger_count,
      'inactive_legacy_trigger_count', v_inactive_legacy_trigger_count,
      'status', v_legacy_status,
      'compatibility_status', v_legacy_compatible_status,
      'disposition', case
        when v_legacy_current_route then 'legacy-runtime-authority'
        when v_inactive_legacy_trigger_count > 0 then 'compatibility-inactive'
        else 'compatibility-or-not-applicable'
      end
    ),
    'writers', jsonb_build_object(
      'surfaces', v_writer_surfaces,
      'active_alternate_count', v_active_alternate_writer_count,
      'alternate_card_count', v_alternate_card_writer_count,
      'alternate_workspace_count', v_alternate_workspace_writer_count,
      'alternate_movement_count', v_alternate_movement_writer_count,
      'alternate_workflow_count', v_alternate_workflow_writer_count,
      'alternate_completion_count', v_alternate_completion_writer_count,
      'alternate_archive_count', v_alternate_archive_writer_count,
      'alternate_child_count', v_alternate_child_writer_count
    ),
    'triggers', jsonb_build_object(
      'enabled_alternate_count', v_enabled_alternate_trigger_count,
      'active_legacy_count', v_active_legacy_trigger_count,
      'inactive_legacy_count', v_inactive_legacy_trigger_count,
      'surfaces', v_trigger_surfaces
    ),
    'capabilities', jsonb_build_object(
      'card', jsonb_build_object(
        'status', case when v_shared_card_writer and v_alternate_card_writer_count = 0 then 'pass' else 'fail' end,
        'canonical_contract', v_shared_card_writer
      ),
      'workspace', jsonb_build_object(
        'status', case when v_shared_workspace_writer and v_alternate_workspace_writer_count = 0 then 'pass' else 'fail' end,
        'canonical_contract', v_shared_workspace_writer
      ),
      'child_data', jsonb_build_object(
        'status', case when v_shared_child_writer and v_alternate_child_writer_count = 0 then 'pass' else 'fail' end,
        'canonical_contract', v_shared_child_writer
      ),
      'movement', jsonb_build_object(
        'status', case when v_shared_movement_writer and v_alternate_movement_writer_count = 0 then 'pass' else 'fail' end,
        'canonical_contract', v_shared_movement_writer
      ),
      'workflow', jsonb_build_object(
        'status', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
        'optional', true
      ),
      'completion_archive', jsonb_build_object(
        'status', case when not v_lifecycle_applicable then 'not_applicable' when v_completion_designation_status = 'invalid' or v_archive_designation_status = 'invalid' then 'fail' when v_shared_completion_writer and v_shared_archive_writer and v_policy_present and v_alternate_completion_writer_count = 0 and v_alternate_archive_writer_count = 0 then 'pass' else 'fail' end,
        'policy_source', 'private.module_c_completion_archive_policies'
      )
    ),
    'checks', jsonb_build_object(
      'shared_runtime', case when v_instance.template_key = 'c' then 'pass' else 'fail' end,
      'card_writer', case when v_shared_card_writer and v_alternate_card_writer_count = 0 then 'pass' else 'fail' end,
      'workspace_writer', case when v_shared_workspace_writer and v_alternate_workspace_writer_count = 0 then 'pass' else 'fail' end,
      'movement_authority', case when v_shared_movement_writer and v_alternate_movement_writer_count = 0 then 'pass' else 'fail' end,
      'workspace_authority', case when v_shared_workspace_writer and v_alternate_workspace_writer_count = 0 then 'pass' else 'fail' end,
      'workflow_authority', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'workflow_engine', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'workflow_binding_readiness', case when v_workflow_invalid then 'fail' when v_workflow_published then 'pass' else 'not_applicable' end,
      'completion_authority', case when not v_lifecycle_applicable then 'not_applicable' when v_completion_designation_status = 'invalid' or v_alternate_completion_writer_count > 0 or not v_shared_completion_writer or not v_policy_present then 'fail' else 'pass' end,
      'archive_authority', case when not v_lifecycle_applicable then 'not_applicable' when v_archive_designation_status = 'invalid' or v_alternate_archive_writer_count > 0 or not v_shared_archive_writer or not v_policy_present then 'fail' else 'pass' end,
      'policy_authority', case when v_policy_present then 'pass' else 'fail' end,
      'cloud_writer', case when v_shared_archive_writer and v_alternate_archive_writer_count = 0 then 'pass' else 'fail' end,
      'trigger_conformance', case when v_enabled_alternate_trigger_count = 0 then 'pass' else 'fail' end,
      'legacy_fallback', case when v_legacy_current_route then 'fail' else 'pass' end,
      'global_fallback', v_global_fallback_status,
      'local_fallback', 'unknown',
      'release_adoption', v_release_adoption_status,
      'release_identity', case when v_release_identity_status = 'published_match' then 'pass' when v_release_identity_status = 'identity_mismatch' then 'fail' else 'unknown' end,
      'runtime_route', v_runtime_route_status,
      'data_isolation', v_data_isolation_status,
      'persistence', v_persistence_status,
      'reload', v_persistence_status,
      'new_session', v_persistence_status,
      'overall', v_overall_status
    ),
    'overall', jsonb_build_object(
      'status', v_overall_status,
      'gap_count', v_gap_count,
      'healthy_rule', 'skeleton + shared logic + runtime route + authority + data isolation + release identity + applicable capabilities + zero reachable alternate writers',
      'reasons', v_findings
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
  'Single read-only Module C Authority / Runtime Route Conformance v2 checker. It reports structured release, runtime, writer, trigger, data-isolation, optional-workflow, persistence-evidence, and legacy-route results without repairing data.';

notify pgrst, 'reload schema';

commit;
