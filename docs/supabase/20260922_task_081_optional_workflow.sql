-- TASK-081: Optional Workflow architecture repair. Published binding remains the default; explicit unbound Create and canonical detach+move are supported without weakening existing Workflow gates.
--
-- This is an additive function-contract update only. It does not alter tables,
-- rows, Board/Card identity, RLS policies, or the service-role boundary. GPT
-- creation still requires the existing PM-issued, payload-bound authorization
-- and the existing protected governance-write Edge Function.

begin;

create or replace function public.execute_engineering_governance_write(
  p_authorization_token text,
  p_operation text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_label text default 'GPT'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  operation_value text := lower(trim(coalesce(p_operation, '')));
  actor_value text := upper(trim(coalesce(p_actor_label, '')));
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  authorization_row public.engineering_governance_authorizations%rowtype;
  result jsonb;
  saved_task public.board_tasks;
  saved_knowledge public.engineering_knowledge;
  token_hash_value text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Governance service path is required';
  end if;
  if actor_value <> 'GPT' then
    raise exception using errcode = '42501', message = 'Authorization Failed: only GPT may execute governance-write';
  end if;
  if operation_value not in (
    'create_task_contract', 'update_task_contract', 'update_checkpoint',
    'register_artifact', 'create_engineering_principle'
  ) then
    raise exception using errcode = '22023', message = 'Need PM Decision: governance operation is not allowlisted';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'PM Decision is ambiguous: payload must be an object';
  end if;

  token_hash_value := encode(extensions.digest(convert_to(trim(coalesce(p_authorization_token, '')), 'utf8'), 'sha256'), 'hex');
  select *
    into authorization_row
  from public.engineering_governance_authorizations
  where token_hash = token_hash_value
    and operation = operation_value
    and authorized_actor = actor_value
  for update;

  if not found or authorization_row.revoked_at is not null or authorization_row.used_at is not null
     or authorization_row.expires_at <= now() then
    raise exception using errcode = '42501', message = 'PM Authorization Missing / Authorization Failed';
  end if;
  if authorization_row.request_hash <> encode(extensions.digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex') then
    raise exception using errcode = '42501', message = 'PM Decision is ambiguous: payload does not match PM authorization';
  end if;

  if operation_value = 'create_task_contract' then
    if length(trim(coalesce(payload->>'title', ''))) = 0 then
      raise exception using errcode = '22023', message = 'Task title is required';
    end if;
    if exists (
      select 1 from jsonb_object_keys(payload) as keys(name)
      where name not in ('title', 'summary', 'usage_scenario', 'priority', 'acceptance_criteria', 'workspace_id', 'workflow_mode')
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: task contract field is not allowlisted';
    end if;
    if payload ? 'workspace_id'
       and nullif(trim(payload->>'workspace_id'), '') is not null
       and payload->>'workspace_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Task workspace id is invalid';
    end if;
    if payload ? 'workflow_mode'
       and lower(trim(coalesce(payload->>'workflow_mode', ''))) not in ('published', 'unbound') then
      raise exception using errcode = '22023', message = 'Task workflow mode is invalid';
    end if;

    saved_task := public.board_create_task(
      p_title => payload->>'title',
      p_summary => payload->>'summary',
      p_usage_scenario => payload->>'usage_scenario',
      p_priority => payload->>'priority',
      p_actor_type => 'ai',
      p_actor_label => 'GPT',
      p_workspace_id => nullif(trim(payload->>'workspace_id'), '')::uuid,
      p_acceptance_criteria => payload->>'acceptance_criteria',
      p_workflow_mode => coalesce(nullif(lower(trim(payload->>'workflow_mode')), ''), 'published')
    );
    result := to_jsonb(saved_task);
  elsif operation_value = 'register_artifact' then
    if exists (
      select 1 from jsonb_object_keys(payload) as keys(name)
      where name not in (
        'artifact_id', 'filename', 'product_version', 'runtime_build',
        'artifact_timestamp', 'git_commit', 'sha256', 'artifact_type',
        'qa_status', 'pm_acceptance_status', 'storage_location',
        'related_task', 'lineage'
      )
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: artifact field is not allowlisted';
    end if;
    if lower(trim(coalesce(payload->>'artifact_type', ''))) <> 'candidate' then
      raise exception using errcode = '22023', message = 'Recovery artifact type must be candidate';
    end if;
    if lower(trim(coalesce(payload->>'pm_acceptance_status', ''))) in ('accepted', 'pm_accepted', 'production_accepted') then
      raise exception using errcode = '42501', message = 'PM Accepted Product Baseline requires explicit PM acceptance';
    end if;
    result := public.register_engineering_artifact(payload);

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, after_data, note,
      actor_id, actor_type, actor_label
    ) values (
      'engineering_artifact', result->>'artifact_id', 'pm_authorized_artifact_registered',
      result, 'PM-authorized append-only Artifact Registry registration',
      null, 'ai', actor_value
    );
  elsif operation_value = 'update_task_contract' then
    if (payload->>'task_id')::uuid is null then
      raise exception using errcode = '22023', message = 'Task id is required';
    end if;
    if exists (
      select 1 from jsonb_object_keys(payload) as keys(name)
      where name not in (
        'task_id', 'title', 'summary', 'usage_scenario', 'priority', 'domain',
        'category', 'problem', 'objective', 'proposed_solution', 'related_work',
        'acceptance_criteria', 'developer_notes', 'pm_notes'
      )
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: task contract field is not allowlisted';
    end if;

    select * into saved_task
    from public.board_tasks
    where id = (payload->>'task_id')::uuid
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Canonical TASK not found';
    end if;

    update public.board_tasks
    set title = case when payload ? 'title' then nullif(trim(payload->>'title'), '') else title end,
        summary = case when payload ? 'summary' then nullif(trim(payload->>'summary'), '') else summary end,
        usage_scenario = case when payload ? 'usage_scenario' then nullif(trim(payload->>'usage_scenario'), '') else usage_scenario end,
        priority = case when payload ? 'priority' then nullif(trim(payload->>'priority'), '') else priority end,
        domain = case when payload ? 'domain' then nullif(trim(payload->>'domain'), '') else domain end,
        category = case when payload ? 'category' then nullif(trim(payload->>'category'), '') else category end,
        problem = case when payload ? 'problem' then nullif(trim(payload->>'problem'), '') else problem end,
        objective = case when payload ? 'objective' then nullif(trim(payload->>'objective'), '') else objective end,
        proposed_solution = case when payload ? 'proposed_solution' then nullif(trim(payload->>'proposed_solution'), '') else proposed_solution end,
        related_work = case when payload ? 'related_work' then nullif(trim(payload->>'related_work'), '') else related_work end,
        acceptance_criteria = case when payload ? 'acceptance_criteria' then nullif(trim(payload->>'acceptance_criteria'), '') else acceptance_criteria end,
        developer_notes = case when payload ? 'developer_notes' then nullif(trim(payload->>'developer_notes'), '') else developer_notes end,
        pm_notes = case when payload ? 'pm_notes' then nullif(trim(payload->>'pm_notes'), '') else pm_notes end,
        updated_at = now()
    where id = saved_task.id
    returning * into saved_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label
    ) values (
      'board_task', saved_task.id::text, 'pm_authorized_task_contract_update',
      jsonb_build_object('task_id', saved_task.id), to_jsonb(saved_task),
      'PM-authorized TASK Contract update', null, 'ai', actor_value
    );
    result := to_jsonb(saved_task);
  elsif operation_value = 'update_checkpoint' then
    if exists (
      select 1 from jsonb_object_keys(payload) as keys(name)
      where name not in (
        'checkpoint_key', 'current_task', 'current_stage', 'completed', 'pending',
        'files_changed', 'cloud_changes', 'qa_status', 'blocking', 'next_action',
        'branch', 'git_commit', 'working_tree_state'
      )
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: checkpoint field is not allowlisted';
    end if;
    result := public.write_engineering_checkpoint(payload);
  elsif operation_value = 'create_engineering_principle' then
    if exists (
      select 1 from jsonb_object_keys(payload) as keys(name)
      where name not in (
        'knowledge_code', 'title', 'summary', 'content', 'module',
        'version', 'source_path', 'source_reference'
      )
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: Engineering Principle field is not allowlisted';
    end if;
    if coalesce(payload->>'knowledge_code', '') !~ '^EP-[0-9]{3}$' then
      raise exception using errcode = '22023', message = 'Engineering Principle code must use the assigned EP-### namespace';
    end if;
    if length(trim(coalesce(payload->>'title', ''))) = 0
       or length(trim(coalesce(payload->>'summary', ''))) = 0
       or length(trim(coalesce(payload->>'content', ''))) = 0 then
      raise exception using errcode = '22023', message = 'Engineering Principle title, summary and content are required';
    end if;
    if length(trim(coalesce(payload->>'source_path', ''))) = 0
       or length(trim(coalesce(payload->>'source_reference', ''))) = 0 then
      raise exception using errcode = '22023', message = 'Engineering Principle provenance is required';
    end if;
    if coalesce(payload->>'version', '1.0') !~ '^[0-9]+\.[0-9]+$' then
      raise exception using errcode = '22023', message = 'Engineering Principle version is invalid';
    end if;
    if exists (
      select 1 from public.engineering_knowledge
      where knowledge_code = upper(trim(payload->>'knowledge_code'))
    ) then
      raise exception using errcode = '23505', message = 'Engineering Principle already exists; revision requires a separate PM Decision';
    end if;

    insert into public.engineering_knowledge (
      knowledge_code, knowledge_type, title, summary, content, module,
      status, version, source_path, source_reference, conflict_status,
      created_by, approved_by, approved_at
    ) values (
      upper(trim(payload->>'knowledge_code')),
      'principle',
      trim(payload->>'title'),
      trim(payload->>'summary'),
      payload->>'content',
      nullif(trim(payload->>'module'), ''),
      'approved',
      coalesce(nullif(trim(payload->>'version'), ''), '1.0'),
      trim(payload->>'source_path'),
      trim(payload->>'source_reference'),
      'none',
      authorization_row.authorized_by,
      authorization_row.authorized_by,
      now()
    ) returning * into saved_knowledge;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label
    ) values (
      'knowledge', saved_knowledge.id::text, 'pm_authorized_principle_created',
      null,
      jsonb_build_object(
        'id', saved_knowledge.id,
        'knowledge_code', saved_knowledge.knowledge_code,
        'knowledge_type', saved_knowledge.knowledge_type,
        'status', saved_knowledge.status,
        'version', saved_knowledge.version,
        'authorized_by', authorization_row.authorized_by
      ),
      coalesce(authorization_row.pm_note, 'PM-authorized Engineering Principle creation'),
      null, 'ai', actor_value
    );
    result := jsonb_build_object(
      'id', saved_knowledge.id,
      'knowledge_code', saved_knowledge.knowledge_code,
      'knowledge_type', saved_knowledge.knowledge_type,
      'status', saved_knowledge.status,
      'version', saved_knowledge.version
    );
  end if;

  update public.engineering_governance_authorizations
  set used_at = now()
  where authorization_id = authorization_row.authorization_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'engineering_governance_authorization', authorization_row.authorization_id::text,
    'pm_authorized_governance_write',
    jsonb_build_object('operation', operation_value, 'result', result),
    'PM-authorized Governance Write executed',
    null, 'ai', actor_value
  );

  return jsonb_build_object(
    'authorization_id', authorization_row.authorization_id,
    'operation', operation_value,
    'actor_label', actor_value,
    'result', result
  );
end;
$$;

revoke all on function public.execute_engineering_governance_write(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.execute_engineering_governance_write(text, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';

create or replace function public.board_create_task(
  p_title text,
  p_summary text,
  p_usage_scenario text,
  p_priority text,
  p_actor_type text,
  p_actor_label text,
  p_workspace_id uuid,
  p_acceptance_criteria text,
  p_workflow_mode text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_actor_id uuid;
  v_target_workspace_id uuid;
  v_instance public.board_instances;
  v_created_task public.board_tasks;
  v_workflow record;
  v_workflow_configured boolean := false;
  v_status text := 'not_started';
  v_assignee text;
  v_workflow_mode text := lower(btrim(coalesce(p_workflow_mode, 'published')));
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if v_workflow_mode not in ('published', 'unbound') then
    raise exception using errcode = '22023', message = 'Workflow mode must be published or unbound';
  end if;
  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Task actor is not allowed';
  end if;
  if v_workflow_mode = 'unbound' and v_actor_type <> 'ai' then
    raise exception using errcode = '42501', message = 'Unbound AI Board create requires the GPT actor path';
  end if;

  select * into v_instance
    from public.board_instances
   where legacy_application_scope = 'ai_board'
     and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'AI Board registry is unavailable';
  end if;

  if p_workspace_id is null then
    select id into v_target_workspace_id
      from public.board_workspaces
     where board_instance_id = v_instance.id
       and workspace_key = 'todo'
       and active = true
       and archived_at is null;
  else
    select id into v_target_workspace_id
      from public.board_workspaces
     where id = p_workspace_id
       and board_instance_id = v_instance.id
       and active = true
       and archived_at is null;
  end if;
  if v_target_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active AI Board workspace is unavailable';
  end if;

  if v_workflow_mode = 'published' then
    select * into v_workflow
      from private.board_c_resolve_workflow_create_state(
        v_instance.id,
        v_target_workspace_id,
        null
      );
    if found then
      v_workflow_configured := true;
      v_status := v_workflow.workflow_status;
      v_assignee := v_workflow.workflow_assignee;
    end if;
  else
    perform set_config('zhuge.module_c_workflow_mode', 'unbound', true);
  end if;

  insert into public.board_tasks (
    board_instance_id, application_scope, owner_uuid, title, summary,
    usage_scenario, priority, acceptance_criteria, status, assignee,
    workspace_id, created_by, created_at, updated_at,
    workflow_version_id, current_workflow_step_id
  ) values (
    v_instance.id, 'ai_board', null, trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''),
    nullif(trim(coalesce(p_acceptance_criteria, '')), ''),
    v_status, v_assignee, v_target_workspace_id, v_actor_id, now(), now(),
    case when v_workflow_configured then v_workflow.workflow_version_id else null end,
    case when v_workflow_configured then v_workflow.current_workflow_step_id else null end
  ) returning * into v_created_task;

  if v_workflow_mode = 'unbound' then
    perform set_config('zhuge.module_c_workflow_mode', '', true);
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_created_task.id::text, 'task_created', to_jsonb(v_created_task),
    'Board task created', v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order, version
  ) values
    (v_created_task.id, 'task_acceptance', 'co', 'developer-qa',
      format('Co Developer QA：完成「%s」並附 Evidence', v_created_task.title), true, 10, 1),
    (v_created_task.id, 'task_acceptance', 'gpt', 'gpt-review',
      format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', v_created_task.title), true, 20, 1),
    (v_created_task.id, 'task_acceptance', 'qjc', 'pm-acceptance',
      format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', v_created_task.title), true, 30, 1);
  return v_created_task;
end;
$function$;

create or replace function public.board_create_task(
  p_title text,
  p_summary text,
  p_usage_scenario text,
  p_priority text,
  p_actor_type text,
  p_actor_label text,
  p_workspace_id uuid,
  p_acceptance_criteria text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
begin
  return public.board_create_task(
    p_title => p_title,
    p_summary => p_summary,
    p_usage_scenario => p_usage_scenario,
    p_priority => p_priority,
    p_actor_type => p_actor_type,
    p_actor_label => p_actor_label,
    p_workspace_id => p_workspace_id,
    p_acceptance_criteria => p_acceptance_criteria,
    p_workflow_mode => 'published'
  );
end;
$function$;

comment on function public.board_create_task(text, text, text, text, text, text, uuid, text) is
  'Governed AI Board create adapter; published workflow binding is the default and unbound mode is explicit.';

create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_usage_scenario text default null,
  p_priority text default null,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
begin
  return public.board_create_task(
    p_title => p_title,
    p_summary => p_summary,
    p_usage_scenario => p_usage_scenario,
    p_priority => p_priority,
    p_actor_type => p_actor_type,
    p_actor_label => p_actor_label,
    p_workspace_id => p_workspace_id,
    p_acceptance_criteria => null,
    p_workflow_mode => 'published'
  );
end;
$function$;

comment on function public.board_create_task(text, text, text, text, text, text, uuid) is
  'AI Board create compatibility wrapper; published workflow binding remains the default.';

revoke all on function public.board_create_task(text, text, text, text, text, text, uuid, text, text) from public, anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid, text, text) to authenticated, service_role;
revoke all on function public.board_create_task(text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid, text) to authenticated, service_role;
revoke all on function public.board_create_task(text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid) to authenticated, service_role;

create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text,
  p_status text,
  p_usage_scenario text,
  p_workspace_id uuid,
  p_workflow_mode text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_workflow record;
  v_workflow_configured boolean := false;
  v_owner uuid;
  v_assignee text;
  v_status text := lower(btrim(coalesce(p_status, 'not_started')));
  v_default_key text;
  v_title text := btrim(coalesce(p_title, ''));
  v_workflow_mode text := lower(btrim(coalesce(p_workflow_mode, 'published')));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if v_workflow_mode not in ('published', 'unbound') then
    raise exception using errcode = '22023', message = 'Workflow mode must be published or unbound';
  end if;

  select * into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board instance not found';
  end if;

  v_default_key := lower(v_instance.task_code_prefix) || '-todo';
  if p_workspace_id is null then
    select * into v_workspace
      from public.board_workspaces
     where board_instance_id = p_board_instance_id
       and workspace_key = v_default_key
       and active = true
       and archived_at is null
     order by sort_order
     limit 1;
  else
    select * into v_workspace
      from public.board_workspaces
     where id = p_workspace_id
       and board_instance_id = p_board_instance_id
       and active = true
       and archived_at is null;
  end if;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board workspace is required';
  end if;

  -- Published is the existing default. Unbound is explicit and preserves
  -- optional Workflow semantics for a legal custom Workspace.
  if v_workflow_mode = 'published' then
    select * into v_workflow
      from private.board_c_resolve_workflow_create_state(
        p_board_instance_id,
        v_workspace.id,
        null
      );
    if found then
      v_workflow_configured := true;
      v_status := v_workflow.workflow_status;
      v_assignee := v_workflow.workflow_assignee;
    end if;
  else
    perform set_config('zhuge.module_c_workflow_mode', 'unbound', true);
  end if;

  v_owner := case when v_instance.authorization_mode = 'owner' then v_user else null end;
  insert into public.board_tasks (
    board_instance_id,
    workspace_id,
    title,
    summary,
    status,
    assignee,
    usage_scenario,
    application_scope,
    owner_uuid,
    created_by,
    workflow_version_id,
    current_workflow_step_id
  ) values (
    p_board_instance_id,
    v_workspace.id,
    v_title,
    nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(nullif(v_status, ''), 'not_started'),
    case when v_workflow_configured then v_assignee else null end,
    nullif(btrim(coalesce(p_usage_scenario, '')), ''),
    null,
    v_owner,
    v_user,
    case when v_workflow_configured then v_workflow.workflow_version_id else null end,
    case when v_workflow_configured then v_workflow.current_workflow_step_id else null end
  ) returning * into v_row;

  if v_workflow_mode = 'unbound' then
    perform set_config('zhuge.module_c_workflow_mode', '', true);
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.id::text, 'task_created', to_jsonb(v_row),
    'Board task created through the universal board contract',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$function$;

create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text default null,
  p_status text default 'not_started',
  p_usage_scenario text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  return public.board_instance_create_task(
    p_board_instance_id => p_board_instance_id,
    p_title => p_title,
    p_summary => p_summary,
    p_status => p_status,
    p_usage_scenario => p_usage_scenario,
    p_workspace_id => p_workspace_id,
    p_workflow_mode => 'published'
  );
end;
$function$;

comment on function public.board_instance_create_task(uuid, text, text, text, text, uuid) is
  'Module C shared Create authority; published binding remains the default and explicit unbound Create is supported.';

revoke all on function public.board_instance_create_task(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.board_instance_create_task(uuid, text, text, text, text, uuid, text) to authenticated;
revoke all on function public.board_instance_create_task(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.board_instance_create_task(uuid, text, text, text, text, uuid) to authenticated;

create or replace function private.board_workflow_bind_new_task()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_workflow_version_id uuid;
  v_step_id uuid;
begin
  if current_setting('zhuge.module_c_workflow_mode', true) = 'unbound' then
    return new;
  end if;
  if new.board_instance_id is null
     or new.workspace_id is null
     or new.workflow_version_id is not null
     or new.current_workflow_step_id is not null then
    return new;
  end if;

  select d.id, s.id
    into v_workflow_version_id, v_step_id
  from public.board_instance_workflow_state state
  join public.board_workflow_definitions d
    on d.id = state.published_workflow_version_id
   and d.board_instance_id = new.board_instance_id
   and d.status = 'published'
  join public.board_workflow_steps s
    on s.workflow_version_id = d.id
   and s.workspace_id = new.workspace_id
  where state.board_instance_id = new.board_instance_id;

  if v_workflow_version_id is not null and v_step_id is not null then
    new.workflow_version_id := v_workflow_version_id;
    new.current_workflow_step_id := v_step_id;
  end if;

  return new;
end;
$function$;

comment on function private.board_workflow_bind_new_task() is
  'Module C canonical new-card binding; published is the default and explicit unbound Create skips auto-binding.';

revoke all on function private.board_workflow_bind_new_task() from public, anon, authenticated;

create or replace function public.enforce_module_c_workflow_invariant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_expected record;
  v_published boolean := false;
  v_bind_from_target_workspace boolean := false;
  v_unbound_create boolean := current_setting('zhuge.module_c_workflow_mode', true) = 'unbound';
  v_detach_requested boolean := current_setting('zhuge.module_c_workflow_mode', true) = 'detach';
begin
  select *
    into v_instance
    from public.board_instances
   where id = new.board_instance_id
     and active = true
     and template_key = 'c';
  if not found then
    return new;
  end if;

  select exists (
    select 1
      from public.board_instance_workflow_state state
     where state.board_instance_id = new.board_instance_id
       and state.published_workflow_version_id is not null
  ) into v_published;

  if v_detach_requested then
    if tg_op <> 'UPDATE'
       or old.workflow_version_id is null
       or old.current_workflow_step_id is null
       or new.workflow_version_id is not null
       or new.current_workflow_step_id is not null then
      raise exception using errcode = '55000', message = 'Workflow detach must use the canonical detach-and-move contract';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.workflow_version_id is not distinct from old.workflow_version_id
       and new.current_workflow_step_id is not distinct from old.current_workflow_step_id
       and new.workspace_id is distinct from old.workspace_id
       and old.workflow_version_id is not null then
      v_bind_from_target_workspace := true;
    end if;
  elsif tg_op = 'INSERT'
        and new.workflow_version_id is null
        and new.current_workflow_step_id is null
        and not v_unbound_create then
    v_bind_from_target_workspace := true;
  end if;

  if v_published and v_bind_from_target_workspace then
    select * into v_expected
      from private.board_c_resolve_workflow_create_state(
        new.board_instance_id,
        new.workspace_id,
        null
      );
    if not found then
      raise exception using errcode = '55000',
        message = 'Module C published Workflow requires a canonical card binding';
    end if;
    new.workflow_version_id := v_expected.workflow_version_id;
    new.current_workflow_step_id := v_expected.current_workflow_step_id;
  end if;

  if (new.workflow_version_id is null) <> (new.current_workflow_step_id is null) then
    raise exception using errcode = '55000',
      message = 'Module C workflow binding is incomplete; card was not changed';
  end if;

  if tg_op = 'UPDATE'
     and old.workflow_version_id is not null
     and new.workflow_version_id is null then
    raise exception using errcode = '55000',
      message = 'Workflow detach must use the canonical detach-and-move contract';
  end if;

  if new.workflow_version_id is null then
    -- Existing unbound cards stay unbound. Published workflow adoption is an
    -- explicit operation, not a side effect of workspace movement.
    if tg_op = 'INSERT' and v_published and not v_unbound_create then
      raise exception using errcode = '55000',
        message = 'Module C published Workflow requires a canonical card binding';
    end if;
    return new;
  end if;

  select * into v_expected
    from private.board_c_resolve_workflow_create_state(
      new.board_instance_id,
      new.workspace_id,
      new.workflow_version_id
    );
  if not found
     or new.workflow_version_id is distinct from v_expected.workflow_version_id
     or new.current_workflow_step_id is distinct from v_expected.current_workflow_step_id
     or new.status is distinct from v_expected.workflow_status
     or new.assignee is distinct from v_expected.workflow_assignee then
    raise exception using errcode = '55000',
      message = 'Module C Workflow state does not match the bound workspace; card was not changed';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_module_c_workflow_invariant() is
  'Module C invariant: Published binding remains default, while explicit unbound Create and canonical detach are legal optional-Workflow paths.';

revoke all on function public.enforce_module_c_workflow_invariant() from public, anon, authenticated, service_role;

drop trigger if exists trg_module_c_workflow_invariant on public.board_tasks;
create trigger trg_module_c_workflow_invariant
before insert or update of status, assignee, workspace_id, workflow_version_id, current_workflow_step_id on public.board_tasks
for each row execute function public.enforce_module_c_workflow_invariant();


create or replace function public.board_c_detach_workflow_and_move_task_v1(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_reason text default null,
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
  v_target_workspace public.board_workspaces%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_hash text := md5(concat_ws('|', 'workflow_detach_move', p_task_id::text, p_target_workspace_id::text, coalesce(p_reason, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_response jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Workflow detach requires an authenticated actor; card was not changed.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
      from private.board_workflow_action_idempotency
     where idempotency_key = p_idempotency_key
       and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = 'Workflow detach idempotency key was reused for different input.';
      end if;
      return v_existing.response;
    end if;
  end if;

  select * into v_task
    from public.board_tasks
   where id = p_task_id
   for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = 'Current actor cannot move this card; card was not changed.';
  end if;
  if v_task.archived_at is not null then
    raise exception using errcode = '42501', message = 'Archived cards cannot be detached or moved.';
  end if;
  if v_task.workflow_version_id is null or v_task.current_workflow_step_id is null then
    raise exception using errcode = '55000', message = 'Card is already unbound; use the canonical optional-workflow move contract.';
  end if;

  if exists (
    select 1
      from private.board_task_claims claim
     where claim.task_id = v_task.id
       and claim.released_at is null
       and claim.lease_expires_at > now()
  ) then
    raise exception using errcode = '42501', message = 'Active task lease must be released before workflow detach.';
  end if;

  select * into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active = true
     and template_key = 'c'
   for share;
  if not found then
    raise exception using errcode = '55000', message = 'Card is not owned by an active Module C Board.';
  end if;

  select * into v_target_workspace
    from public.board_workspaces
   where id = p_target_workspace_id
     and board_instance_id = v_task.board_instance_id
     and active = true
     and archived_at is null
   for share;
  if not found then
    raise exception using errcode = '22023', message = 'Target workspace is not a legal active workspace for this Board Instance.';
  end if;

  select d.* into v_definition
    from public.board_workflow_definitions d
   where d.id = v_task.workflow_version_id
     and d.board_instance_id = v_task.board_instance_id
     and d.status in ('published', 'retired');
  if not found then
    raise exception using errcode = '55000', message = 'Current workflow definition cannot be verified; card was not changed.';
  end if;
  select s.* into v_current_step
    from public.board_workflow_steps s
   where s.id = v_task.current_workflow_step_id
     and s.workflow_version_id = v_definition.id;
  if not found then
    raise exception using errcode = '55000', message = 'Current workflow step cannot be verified; card was not changed.';
  end if;

  v_before := to_jsonb(v_task);
  perform set_config('zhuge.module_c_workflow_mode', 'detach', true);
  update public.board_tasks
     set workspace_id = p_target_workspace_id,
         workflow_version_id = null,
         current_workflow_step_id = null,
         updated_at = v_now
   where id = v_task.id
   returning * into v_task;
  perform set_config('zhuge.module_c_workflow_mode', '', true);

  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'workflow-detach-workspace-decision',
    'task_id', v_task.id,
    'workflow_version_id', null,
    'workflow', 'not_configured',
    'workflow_optional', true,
    'workflow_bound', false,
    'source_workflow_version_id', v_definition.id,
    'source_step_id', v_current_step.id,
    'source_workspace_id', v_before->>'workspace_id',
    'target_workspace_id', v_task.workspace_id,
    'status', v_task.status,
    'assignee', v_task.assignee,
    'completion_at_preserved', v_task.completion_at
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'workflow_detached_workspace_decision',
    v_before, v_response, nullif(btrim(p_reason), ''),
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key, 'workflow_detach_move', v_task.board_instance_id,
      v_task.id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

comment on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) is
  'Canonical C detach/unbind plus workspace move; preserves Completion lifecycle fields and requires authenticated task write authority.';

revoke all on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) to authenticated;


notify pgrst, 'reload schema';

commit;
