-- TASK-37: Module C Workflow Canvas simplification and lifecycle binding.
-- Source-only migration. It does not backfill or mutate existing Board/Task rows.
-- Published Workflow remains the only runtime authority; 0 Edges are valid.

begin;

drop index if exists public.board_workflow_one_initial_step_idx;
drop index if exists public.board_workflow_one_completion_step_idx;

create or replace function private.board_workflow_validate(p_workflow_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
  v_errors text[] := array[]::text[];
begin
  select * into v_definition from public.board_workflow_definitions where id = p_workflow_version_id;
  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array('找不到流程版本。'), 'warnings', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.board_workflow_steps where workflow_version_id = p_workflow_version_id) then
    v_errors := array_append(v_errors, '流程至少需要一個 Workspace 階段。');
  end if;
  if exists (
    select 1
      from public.board_workflow_steps step
      left join public.board_workspaces workspace on workspace.id = step.workspace_id
     where step.workflow_version_id = p_workflow_version_id
       and (workspace.id is null or workspace.board_instance_id <> v_definition.board_instance_id or workspace.active is not true or workspace.archived_at is not null)
  ) then
    v_errors := array_append(v_errors, '每個階段必須對應同一子板內的啟用 Workspace。');
  end if;
  if exists (
    select 1
      from public.board_workspaces workspace
     where workspace.board_instance_id = v_definition.board_instance_id
       and workspace.active is true
       and workspace.archived_at is null
       and (select count(*) from public.board_workflow_steps step where step.workflow_version_id = p_workflow_version_id and step.workspace_id = workspace.id) <> 1
  ) then
    v_errors := array_append(v_errors, '每個啟用中的 Workspace 必須恰好對應一個階段。');
  end if;
  if exists (
    select 1
      from public.board_workflow_transitions edge
      left join public.board_workflow_steps source_step on source_step.id = edge.from_step_id
      left join public.board_workflow_steps target_step on target_step.id = edge.to_step_id
     where edge.workflow_version_id = p_workflow_version_id
       and (source_step.workflow_version_id is distinct from p_workflow_version_id or target_step.workflow_version_id is distinct from p_workflow_version_id)
  ) then
    v_errors := array_append(v_errors, '流程連線只能連接同一版本內的階段。');
  end if;
  if exists (
    select 1
      from public.board_workflow_gates gate
      left join public.board_workflow_steps step on step.id = gate.step_id
     where gate.workflow_version_id = p_workflow_version_id
       and step.workflow_version_id is distinct from p_workflow_version_id
  ) then
    v_errors := array_append(v_errors, '流程既有確認資料無法對應階段。');
  end if;
  if exists (
    select 1
      from public.board_workflow_evidence_requirements evidence
      left join public.board_workflow_gates gate on gate.id = evidence.gate_id
     where gate.id is null or gate.workflow_version_id is distinct from p_workflow_version_id
  ) then
    v_errors := array_append(v_errors, '流程既有證據資料無法對應確認項目。');
  end if;
  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', '[]'::jsonb
  );
end;
$function$;

-- Keep the existing exact-one resolver/guard. The former explicit unbound
-- switch cannot bypass it once the Board has a Published Workflow; optional
-- Workspace/TASK behavior remains legal when no Workflow is published.
do $task37_invariant$
declare
  v_definition text;
  v_occurrences integer;
begin
  v_definition := pg_get_functiondef('public.enforce_module_c_workflow_invariant()'::regprocedure);
  v_occurrences := (length(v_definition) - length(replace(v_definition, 'and not v_unbound_create', ''))) / length('and not v_unbound_create');
  if v_occurrences <> 2 then
    raise exception 'TASK-37 expected two unbound bypass checks in enforce_module_c_workflow_invariant; found %', v_occurrences;
  end if;
  v_definition := replace(v_definition, 'and not v_unbound_create', 'and v_published');
  execute v_definition;
end;
$task37_invariant$;

create or replace function public.board_provision_c_consumer_v2(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c',
  p_application_scope text default null,
  p_workspace_blueprint jsonb default null,
  p_workflow_blueprint jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, private, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_scope text := nullif(lower(btrim(coalesce(p_application_scope, ''))), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_request_hash text := md5(concat_ws('|', v_name, v_prefix, v_template, coalesce(v_scope, ''), coalesce(p_workspace_blueprint::text, ''), coalesce(p_workflow_blueprint::text, '')));
  v_is_personal_worktodo boolean := lower(btrim(coalesce(p_application_scope, ''))) = 'worktodo-self';
  v_is_creator boolean := false;
  v_existing private.board_c_consumer_provision_idempotency%rowtype;
  v_instance public.board_instances%rowtype;
  v_release public.module_releases%rowtype;
  v_workspace jsonb;
  v_workspace_id uuid;
  v_workspace_key text;
  v_workspace_blueprint jsonb := coalesce(
    p_workspace_blueprint,
    jsonb_build_array(
      jsonb_build_object('workspace_key', 'todo', 'name', '待辦', 'sort_order', 10),
      jsonb_build_object('workspace_key', 'working', 'name', '處理中', 'sort_order', 20),
      jsonb_build_object('workspace_key', 'review', 'name', '待驗收', 'sort_order', 30),
      jsonb_build_object('workspace_key', 'completed', 'name', '完成', 'sort_order', 40)
    )
  );
  v_workspace_map jsonb := '{}'::jsonb;
  v_workflow jsonb;
  v_step jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_workflow_response jsonb;
  v_published_workflow_response jsonb;
  v_workflow_version_id uuid;
  v_workspaces jsonb;
  v_adoption jsonb;
  v_response jsonb;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated governance identity is required';
  end if;

  select exists (
    select 1 from public.app_users au
    where au.auth_user_id = v_user
      and lower(trim(au.role)) in ('creator', 'owner')
  ) into v_is_creator;

  if v_is_personal_worktodo then
    if not public.is_app_access_approved() then
      raise exception using errcode = '42501', message = 'Approved Zhuge AI OS access is required';
    end if;
    if v_template <> 'c'
       or v_name <> '工作待辦'
       or v_prefix <> 'SELF'
       or v_scope <> 'worktodo-self'
       or p_workspace_blueprint is not null
       or p_workflow_blueprint is not null then
      raise exception using errcode = '22023', message = 'Personal WorkTodo provisioning accepts only the fixed self-provision contract';
    end if;

    -- A canonical Owner WorkTodo is resolved by the Runtime and must never be
    -- converted, cloned, or provisioned again through the personal branch.
    if exists (
      select 1 from public.board_instances existing_owner
       where existing_owner.owner_uuid = v_user
         and existing_owner.legacy_application_scope = 'worktodo'
    ) then
      raise exception using errcode = '23505', message = 'Canonical WorkTodo already exists; resolve the existing Board instead of provisioning another one';
    end if;

    v_name := '工作待辦';
    v_scope := 'worktodo-user-' || replace(v_user::text, '-', '');
    v_prefix := 'W' || upper(substr(md5(v_user::text), 1, 15));
    v_workspace_blueprint := jsonb_build_array(
      jsonb_build_object('workspace_key', 'worktodo-todo', 'name', '待辦事項', 'sort_order', 10),
      jsonb_build_object('workspace_key', 'worktodo-inprogress', 'name', '進行中', 'sort_order', 20),
      jsonb_build_object('workspace_key', 'worktodo-completed', 'name', '已完成', 'sort_order', 30)
    );
  else
    if not v_is_creator then
      raise exception using errcode = '42501', message = 'Only an approved user may self-provision their own WorkTodo';
    end if;
  end if;

  if v_template <> 'c' then
    raise exception using errcode = '22023', message = 'Module C provisioning requires template key C';
  end if;
  if v_name = '' or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' then
    raise exception using errcode = '22023', message = 'Board name and task-code prefix are required';
  end if;
  if v_scope is not null and v_scope !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Application scope format is invalid';
  end if;
  if v_idempotency_key is null then
    raise exception using errcode = '22023', message = 'C Consumer provisioning requires an idempotency key';
  end if;

  -- Preserve the original per-request idempotency contract, and serialize
  -- personal requests by auth.uid() below so independent tabs cannot create
  -- duplicate Boards using different request keys.
  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));
  select * into v_existing
    from private.board_c_consumer_provision_idempotency
   where idempotency_key = v_idempotency_key
     and expires_at > now()
   for update;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'C Consumer provisioning Idempotency Key 已用於不同內容。';
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  if v_is_personal_worktodo then
    perform pg_advisory_xact_lock(hashtextextended('module-c-personal-worktodo:' || v_user::text, 0));

    select * into v_instance
      from public.board_instances existing_personal
     where existing_personal.owner_uuid = v_user
       and existing_personal.legacy_application_scope = v_scope
     for update;
    if found then
      if v_instance.active is distinct from true
         or v_instance.template_key is distinct from 'c'
         or v_instance.authorization_mode is distinct from 'owner'
         or v_instance.is_template_instance is distinct from false
         or v_instance.task_code_prefix <> v_prefix then
        raise exception using errcode = '23505', message = 'Existing personal WorkTodo identity is inconsistent; provisioning stopped without changes';
      end if;

      select * into v_release
        from public.module_releases
       where module_id = 'c'
       for share;
      if not found then
        raise exception using errcode = 'P0002', message = 'Published Module C release is unavailable';
      end if;
      v_adoption := v_release.consumer_adoptions -> v_instance.id::text;
      if v_adoption is null
         or jsonb_typeof(v_adoption) is distinct from 'object'
         or v_adoption->>'status' is distinct from 'adopted'
         or v_adoption->>'template_key' is distinct from 'c' then
        raise exception using errcode = 'P0002', message = 'Existing personal WorkTodo has no verifiable C adoption; resolution failed closed';
      end if;

      select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
        into v_workspaces
        from public.board_workspaces workspace
       where workspace.board_instance_id = v_instance.id
         and workspace.active = true;
      select state.published_workflow_version_id
        into v_workflow_version_id
        from public.board_instance_workflow_state state
       where state.board_instance_id = v_instance.id;

      v_response := jsonb_build_object(
        'contract', 'module-c-consumer-provisioning-v2',
        'capability', 'c-native-consumer-provisioning',
        'contract_version', 'module-c-lifecycle-acceptance-v2',
        'board_instance', to_jsonb(v_instance),
        'board_instance_id', v_instance.id,
        'template_key', 'c',
        'application_scope', v_scope,
        'workspaces', v_workspaces,
        'published_release', to_jsonb(v_release),
        'module_adoption', v_adoption,
        'workflow', case when v_workflow_version_id is null then null else jsonb_build_object('status', 'published', 'workflow_version_id', v_workflow_version_id) end,
        'workflow_version_id', v_workflow_version_id,
        'shared_runtime', 'module-c-golden-master-runtime',
        'shared_authority', 'module-c-canonical-contract',
        'existing_board', true,
        'atomic', true,
        'idempotent', true,
        'fail_closed', true,
        'card_mutation', 0
      );
      insert into private.board_c_consumer_provision_idempotency (
        idempotency_key, request_hash, board_instance_id, response, status
      ) values (
        v_idempotency_key, v_request_hash, v_instance.id, v_response, 'completed'
      );
      return v_response;
    end if;
  end if;

  if exists (select 1 from public.board_instances where task_code_prefix = v_prefix) then
    raise exception using errcode = '23505', message = 'Board code is already in use';
  end if;
  if v_scope is not null and exists (select 1 from public.board_instances where legacy_application_scope = v_scope) then
    raise exception using errcode = '23505', message = 'Application scope is already assigned';
  end if;

  select * into v_release
    from public.module_releases
   where module_id = v_template
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C release is unavailable';
  end if;

  -- The existing low-level creator supplies Board identity and verifies App
  -- Access. All following writes remain in this same transaction.
  v_instance := public.board_create_instance(v_name, v_prefix, v_template);
  if v_scope is not null then
    update public.board_instances
       set legacy_application_scope = v_scope,
           updated_at = now()
     where id = v_instance.id
     returning * into v_instance;
  end if;

  if jsonb_typeof(v_workspace_blueprint) <> 'array'
     or jsonb_array_length(v_workspace_blueprint) = 0 then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint must be a non-empty array';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_workspace_blueprint) entry
     group by lower(btrim(entry->>'workspace_key'))
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains duplicate keys';
  end if;

  for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
    v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
    if v_workspace_key !~ '^[a-z][a-z0-9_-]{0,63}$'
       or nullif(btrim(v_workspace->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains an invalid workspace';
    end if;
    insert into public.board_workspaces (
      board_instance_id, workspace_key, name, sort_order, active,
      application_scope, owner_uuid, created_by, updated_by
    ) values (
      v_instance.id,
      v_workspace_key,
      btrim(v_workspace->>'name'),
      coalesce((v_workspace->>'sort_order')::integer, 0),
      coalesce((v_workspace->>'active')::boolean, true),
      v_scope,
      v_user,
      v_user,
      v_user
    ) returning id into v_workspace_id;
    v_workspace_map := v_workspace_map || jsonb_build_object(v_workspace_key, v_workspace_id::text);
  end loop;

  if not v_is_personal_worktodo then
    if p_workflow_blueprint is null then
      -- Preserve existing Creator/Owner behavior: a generic C Consumer gets
      -- its current Instance-owned starter Workflow through canonical C APIs.
      v_workflow := jsonb_build_object(
        'name', v_name || ' 流程',
        'description', '由 Module C 建立的子板起始流程；流程資料屬於本 Board Instance。',
        'transitions', '[]'::jsonb,
        'gates', '[]'::jsonb,
        'evidence_requirements', '[]'::jsonb
      );
      -- Initialize the supplied active Workspace blueprint itself. Do not
      -- assume the four default workspace keys exist: custom C consumers
      -- must also receive one standalone Step per Workspace and zero Edges.
      for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
        if coalesce((v_workspace->>'active')::boolean, true) then
          v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
          v_steps := v_steps || jsonb_build_array(jsonb_build_object(
            'step_key', v_workspace_key,
            'name', btrim(v_workspace->>'name'),
            'sort_order', coalesce((v_workspace->>'sort_order')::integer, 0),
            'role_key', case v_workspace_key when 'review' then 'qjc' when 'completed' then 'pm' else 'co' end,
            'workspace_id', v_workspace_map->>v_workspace_key,
            'status_key', case v_workspace_key when 'working' then 'inprogress' when 'review' then 'qa' when 'completed' then 'done' else 'ready' end,
            'is_initial', false,
            'is_completion', false
          ));
        end if;
      end loop;
    else
      if jsonb_typeof(p_workflow_blueprint) <> 'object' then
        raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must be an object';
      end if;
      v_workflow := p_workflow_blueprint;
      if jsonb_typeof(coalesce(v_workflow->'steps', '[]'::jsonb)) <> 'array'
         or jsonb_array_length(coalesce(v_workflow->'steps', '[]'::jsonb)) = 0 then
        raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must contain steps';
      end if;
      for v_step in select value from jsonb_array_elements(v_workflow->'steps') loop
        v_workspace_key := lower(btrim(v_step->>'workspace_key'));
        if not (v_workspace_map ? v_workspace_key) then
          raise exception using errcode = '22023', message = 'C Consumer workflow step references an unknown workspace';
        end if;
        v_step := jsonb_set(v_step - 'workspace_key', '{workspace_id}', to_jsonb(v_workspace_map->>v_workspace_key), true);
        v_steps := v_steps || jsonb_build_array(v_step);
      end loop;
    end if;

    -- A Published Workflow binds every active Workspace exactly once.
    -- Fill missing Steps without creating any Edge; Edges remain opt-in.
    for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
      v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
      if coalesce((v_workspace->>'active')::boolean, true)
         and not exists (
           select 1
             from jsonb_array_elements(v_steps) current_step
            where current_step->>'workspace_id' = v_workspace_map->>v_workspace_key
         ) then
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'step_key', v_workspace_key,
          'name', btrim(v_workspace->>'name'),
          'sort_order', (select coalesce(max((current_step->>'sort_order')::integer), -1) + 1 from jsonb_array_elements(v_steps) current_step),
          'role_key', 'co',
          'workspace_id', v_workspace_map->>v_workspace_key,
          'status_key', 'ready'
        ));
      end if;
    end loop;

    -- Initial and terminal markers are derived from Edge topology. With no
    -- Edges each independent node is both a start and an end.
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(current_step, '{is_initial}', to_jsonb(not exists (
          select 1 from jsonb_array_elements(coalesce(v_workflow->'transitions', '[]'::jsonb)) edge
           where edge->>'to_step_key' = current_step->>'step_key'
        )), true),
        '{is_completion}', to_jsonb(not exists (
          select 1 from jsonb_array_elements(coalesce(v_workflow->'transitions', '[]'::jsonb)) edge
           where edge->>'from_step_key' = current_step->>'step_key'
        )), true
      ) order by coalesce((current_step->>'sort_order')::integer, 0)
    ), '[]'::jsonb)
      into v_steps
      from jsonb_array_elements(v_steps) current_step;

    if nullif(btrim(v_workflow->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'C Consumer workflow name is required';
    end if;
    v_workflow_response := public.board_c_workflow_save_draft(
      v_instance.id,
      btrim(v_workflow->>'name'),
      nullif(btrim(v_workflow->>'description'), ''),
      v_steps,
      coalesce(v_workflow->'transitions', '[]'::jsonb),
      coalesce(v_workflow->'gates', '[]'::jsonb),
      coalesce(v_workflow->'evidence_requirements', '[]'::jsonb),
      null,
      'c-provision-draft-' || v_idempotency_key
    );
    v_workflow_version_id := (v_workflow_response #>> '{workflow,id}')::uuid;
    if v_workflow_version_id is null then
      raise exception using errcode = 'P0002', message = 'C Consumer workflow draft was not created';
    end if;
    v_published_workflow_response := public.board_c_workflow_publish(
      v_workflow_version_id,
      null,
      'c-provision-publish-' || v_idempotency_key
    );
  end if;

  v_adoption := jsonb_build_object(
    'status', 'adopted',
    'module_version', v_release.published_version,
    'build', v_release.published_build,
    'source_commit', v_release.source_commit,
    'source_fingerprint', v_release.source_fingerprint,
    'published_at', v_release.published_at,
    'adopted_at', now(),
    'adopted_by', v_user,
    'template_key', 'c',
    'workflow_version_id', v_workflow_version_id
  );
  update public.module_releases
     set consumer_adoptions = jsonb_set(coalesce(consumer_adoptions, '{}'::jsonb), array[v_instance.id::text], v_adoption, true),
         updated_at = now()
   where module_id = 'c';
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C adoption persistence failed';
  end if;

  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
    into v_workspaces
    from public.board_workspaces workspace
   where workspace.board_instance_id = v_instance.id
     and workspace.active = true;

  v_response := jsonb_build_object(
    'contract', 'module-c-consumer-provisioning-v2',
    'capability', 'c-native-consumer-provisioning',
    'contract_version', 'module-c-lifecycle-acceptance-v2',
    'board_instance', to_jsonb(v_instance),
    'board_instance_id', v_instance.id,
    'template_key', 'c',
    'application_scope', v_scope,
    'workspaces', v_workspaces,
    'published_release', to_jsonb(v_release),
    'module_adoption', v_adoption,
    'workflow', v_published_workflow_response->'workflow',
    'workflow_version_id', v_workflow_version_id,
    'workflow_status', case when v_workflow_version_id is null then 'not_configured' else 'published' end,
    'shared_runtime', 'module-c-golden-master-runtime',
    'shared_authority', 'module-c-canonical-contract',
    'atomic', true,
    'idempotent', false,
    'fail_closed', true,
    'card_mutation', 0
  );
  insert into private.board_c_consumer_provision_idempotency (
    idempotency_key, request_hash, board_instance_id, response, status
  ) values (
    v_idempotency_key, v_request_hash, v_instance.id, v_response, 'completed'
  );
  return v_response;
end;
$function$;


revoke all on function public.board_provision_c_consumer_v2(text, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.board_provision_c_consumer_v2(text, text, text, text, jsonb, jsonb, text) to authenticated;

commit;
