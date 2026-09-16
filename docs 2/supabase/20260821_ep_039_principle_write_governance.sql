-- EP-039 controlled Engineering Principle Write Path
--
-- This extends the existing PM Authorization -> GPT governance-write actor
-- -> engineering-transition -> SECURITY DEFINER path. It does not grant
-- table DML to browser, authenticated users, GPT, or Co, and it does not
-- create a second Principle registry.

begin;

alter table public.engineering_governance_authorizations
  drop constraint if exists engineering_governance_authorizations_operation_check;
alter table public.engineering_governance_authorizations
  add constraint engineering_governance_authorizations_operation_check
  check (operation in (
    'create_task_contract', 'update_task_contract', 'update_checkpoint',
    'register_artifact', 'create_engineering_principle'
  ));

create or replace function public.issue_engineering_governance_authorization(
  p_authorization jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  authorization_payload jsonb := coalesce(p_authorization, '{}'::jsonb);
  operation_value text := lower(trim(coalesce(authorization_payload->>'operation', '')));
  actor_value text := upper(trim(coalesce(authorization_payload->>'authorized_actor', 'GPT')));
  payload jsonb := coalesce(authorization_payload->'payload', '{}'::jsonb);
  authorization_id_value uuid := extensions.gen_random_uuid();
  token_value text := encode(extensions.gen_random_bytes(32), 'hex');
  expires_at_value timestamptz := coalesce(nullif(trim(authorization_payload->>'expires_at'), '')::timestamptz, now() + interval '5 minutes');
  request_hash_value text;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'PM Authorization Failed: authenticated QJC / PM owner is required';
  end if;
  if operation_value not in (
    'create_task_contract', 'update_task_contract', 'update_checkpoint',
    'register_artifact', 'create_engineering_principle'
  ) then
    raise exception using errcode = '22023', message = 'Need PM Decision: governance operation is not allowlisted';
  end if;
  if actor_value <> 'GPT' then
    raise exception using errcode = '22023', message = 'Need PM Decision: only GPT may receive governance-write authorization';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'PM Decision is ambiguous: authorization payload must be an object';
  end if;
  if expires_at_value <= now() or expires_at_value > now() + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'PM Authorization expiry must be within 15 minutes';
  end if;

  if operation_value = 'create_task_contract'
     and length(trim(coalesce(payload->>'title', ''))) = 0 then
    raise exception using errcode = '22023', message = 'PM Decision is ambiguous: task title is required';
  end if;
  if operation_value = 'update_task_contract'
     and nullif(trim(coalesce(payload->>'task_id', '')), '') is null then
    raise exception using errcode = '22023', message = 'PM Decision is ambiguous: task_id is required';
  end if;
  if operation_value = 'update_checkpoint'
     and coalesce(payload->>'checkpoint_key', 'current') <> 'current' then
    raise exception using errcode = '22023', message = 'Only the current Engineering Checkpoint can be authorized';
  end if;
  if operation_value = 'create_engineering_principle' then
    if exists (
      select 1
      from jsonb_object_keys(payload) as keys(name)
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
  end if;

  request_hash_value := encode(extensions.digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex');

  insert into public.engineering_governance_authorizations (
    authorization_id, token_hash, operation, request_hash, authorized_actor,
    authorized_by, issued_at, expires_at, pm_note
  ) values (
    authorization_id_value,
    encode(extensions.digest(convert_to(token_value, 'utf8'), 'sha256'), 'hex'),
    operation_value,
    request_hash_value,
    actor_value,
    auth.uid(),
    now(),
    expires_at_value,
    nullif(trim(authorization_payload->>'pm_note'), '')
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'engineering_governance_authorization', authorization_id_value::text,
    'pm_authorization_issued',
    jsonb_build_object(
      'operation', operation_value,
      'authorized_actor', actor_value,
      'request_hash', request_hash_value,
      'expires_at', expires_at_value
    ),
    coalesce(nullif(trim(authorization_payload->>'pm_note'), ''), 'PM authorized Governance Write'),
    auth.uid(), 'human', 'QJC'
  );

  return jsonb_build_object(
    'authorization_id', authorization_id_value,
    'operation', operation_value,
    'authorized_actor', actor_value,
    'expires_at', expires_at_value,
    'authorization_token', token_value
  );
end;
$$;

revoke all on function public.issue_engineering_governance_authorization(jsonb) from public, anon, service_role;
grant execute on function public.issue_engineering_governance_authorization(jsonb) to authenticated;

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
      where name not in ('title', 'summary', 'usage_scenario', 'priority')
    ) then
      raise exception using errcode = '22023', message = 'Need PM Decision: task contract field is not allowlisted';
    end if;

    saved_task := public.board_create_task(
      payload->>'title', payload->>'summary', payload->>'usage_scenario',
      payload->>'priority', 'ai', 'GPT'
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

commit;
