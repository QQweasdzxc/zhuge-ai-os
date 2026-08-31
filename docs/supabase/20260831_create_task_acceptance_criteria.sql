-- Minimal additive Create Contract support for complete TASK creation.
--
-- This migration preserves the existing 7-argument board_create_task overload,
-- TASK number allocation, Governance Write authorization, actor checks, checklist
-- initialization, and all other Lifecycle behavior.  The new overload only adds
-- acceptance_criteria to the initial controlled write so a complete TASK can be
-- created atomically through the existing Governance path.

begin;

-- Additive create contract overload: preserve the existing 7-argument function
-- and checklist initialization while allowing a complete TASK contract in one write.
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
set search_path = public, pg_temp
as $$
declare
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
  target_workspace_id uuid;
  instance_row public.board_instances;
  created_task public.board_tasks;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Task actor is not allowed';
  end if;

  select * into instance_row
  from public.board_instances
  where legacy_application_scope = 'ai_board'
    and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'AI Board registry is unavailable';
  end if;
  if p_workspace_id is null then
    select id into target_workspace_id
    from public.board_workspaces
    where board_instance_id = instance_row.id
      and workspace_key = 'todo'
      and active = true;
  else
    select id into target_workspace_id
    from public.board_workspaces
    where id = p_workspace_id
      and board_instance_id = instance_row.id
      and application_scope = 'ai_board'
      and active = true;
  end if;
  if target_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active AI Board workspace is unavailable';
  end if;

  insert into public.board_tasks (
    board_instance_id, application_scope, owner_uuid, title, summary,
    usage_scenario, priority, acceptance_criteria, status, assignee, workspace_id,
    created_by, created_at, updated_at
  ) values (
    instance_row.id, 'ai_board', null, trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''),
    nullif(trim(coalesce(p_acceptance_criteria, '')), ''), 'ready', 'Co',
    target_workspace_id, actor_id_value, now(), now()
  ) returning * into created_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', created_task.id::text, 'task_created', to_jsonb(created_task),
    'Board task created', actor_id_value, actor_type_value, actor_label_value,
    'system_activity'
  );

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order, version
  ) values
    (created_task.id, 'task_acceptance', 'co', 'developer-qa',
      format('Co Developer QA：完成「%s」並附 Evidence', created_task.title), true, 10, 1),
    (created_task.id, 'task_acceptance', 'gpt', 'gpt-review',
      format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', created_task.title), true, 20, 1),
    (created_task.id, 'task_acceptance', 'qjc', 'pm-acceptance',
      format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', created_task.title), true, 30, 1);
  return created_task;
end;
$$;



revoke all on function public.board_create_task(text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid, text) to authenticated, service_role;

comment on function public.board_create_task(text, text, text, text, text, text, uuid, text)
  is 'Additive complete TASK create contract for the canonical C Template; acceptance_criteria is written with the initial governed task insert';

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
      where name not in ('title', 'summary', 'usage_scenario', 'priority', 'acceptance_criteria')
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: task contract field is not allowlisted';
    end if;

    saved_task := public.board_create_task(
      p_title => payload->>'title',
      p_summary => payload->>'summary',
      p_usage_scenario => payload->>'usage_scenario',
      p_priority => payload->>'priority',
      p_actor_type => 'ai',
      p_actor_label => 'GPT',
      p_workspace_id => null,
      p_acceptance_criteria => payload->>'acceptance_criteria'
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

commit;
