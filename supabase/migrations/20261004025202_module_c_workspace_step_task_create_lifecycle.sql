-- Source-only. Requires the existing Canvas and archive/restore migrations.
-- Extend the one Module C lifecycle; no backfill, Task movement or Cloud apply.
begin;

create or replace function private.board_workspace_publish_lifecycle(p_board_instance_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_user_draft public.board_workflow_definitions%rowtype;
  v_node jsonb;
  v_steps jsonb; v_edges jsonb; v_gates jsonb; v_evidence jsonb;
  v_saved jsonb; v_validated jsonb; v_result jsonb; v_system_draft uuid; v_retained_draft uuid;
  v_needs_publish boolean; v_order integer; v_key text; v_suffix integer;
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '你沒有管理此看板工作區的權限。';
  end if;
  -- All lifecycle writers acquire Board before Workspace/Workflow locks.
  select * into v_instance from public.board_instances where id = p_board_instance_id and active for update;
  if not found then raise exception using errcode = '55000', message = '此看板目前未啟用。'; end if;
  if v_instance.template_key <> 'c' then return null; end if;
  select * into v_state from public.board_instance_workflow_state where board_instance_id = p_board_instance_id for update;
  if v_state.published_workflow_version_id is not null then
    select * into v_definition from public.board_workflow_definitions
      where id = v_state.published_workflow_version_id and board_instance_id = p_board_instance_id and status = 'published' for update;
    if not found then raise exception using errcode = '55000', message = '流程版本已變更，請重新整理看板後再試。'; end if;
  end if;
  if v_state.draft_workflow_version_id is not null and not exists (
    select 1 from public.board_workflow_definitions where id = v_state.draft_workflow_version_id
      and board_instance_id = p_board_instance_id and status = 'draft'
  ) then raise exception using errcode = '55000', message = '流程草稿狀態無法核對，請重新整理後再試。'; end if;
  perform 1 from public.board_workflow_definitions where board_instance_id = p_board_instance_id and status = 'draft' order by id for update;
  select id into v_retained_draft from public.board_workflow_definitions where board_instance_id = p_board_instance_id and status = 'draft';

  v_needs_publish := v_definition.id is null or exists (
    select 1 from public.board_workspaces w where w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
      and (select count(*) from public.board_workflow_steps s where s.workflow_version_id = v_definition.id and s.workspace_id = w.id) <> 1
  ) or exists (
    select 1 from public.board_workflow_steps s left join public.board_workspaces w on w.id = s.workspace_id
    where s.workflow_version_id = v_definition.id
      and (w.id is null or w.board_instance_id <> p_board_instance_id or not w.active or w.archived_at is not null)
  );

  -- Only Published/retired evidence contributes metadata. User Draft contents
  -- are never input to the system version, including on first initialization.
  with nodes as (
    select w.id, coalesce(s.name, w.name) as name, w.sort_order,
      coalesce(s.step_key, 'ws-' || replace(w.id::text, '-', '')) as step_key,
      coalesce(s.role_key, case when w.workspace_key ~ '(^|-)completed$' then 'pm' else 'co' end) as role_key,
      coalesce(s.status_key, case when w.workspace_key ~ '(^|-)completed$' then 'done' else 'ready' end) as status_key
    from public.board_workspaces w left join lateral (
      select step.* from public.board_workflow_steps step join public.board_workflow_definitions def on def.id = step.workflow_version_id
      where step.workspace_id = w.id and def.board_instance_id = p_board_instance_id and def.status in ('published','retired')
      order by (def.id = v_definition.id) desc nulls last, def.version_no desc limit 1
    ) s on true where w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', id, 'step_key', step_key, 'name', name, 'sort_order', sequence,
    'role_key', role_key, 'status_key', status_key, 'is_initial', false, 'is_completion', false
  ) order by sequence), '[]'::jsonb) into v_steps from (
    select nodes.*, (row_number() over (order by sort_order, id))::integer * 10 as sequence from nodes
  ) ordered;
  select coalesce(jsonb_agg(jsonb_build_object(
    'transition_key', edge.transition_key, 'from_step_key', source.step_key, 'to_step_key', target.step_key,
    'allowed_roles', edge.allowed_roles, 'requires_gate', edge.requires_gate
  ) order by edge.transition_key), '[]'::jsonb) into v_edges
  from public.board_workflow_transitions edge
  join public.board_workflow_steps source on source.id = edge.from_step_id
  join public.board_workflow_steps target on target.id = edge.to_step_id
  join public.board_workspaces sw on sw.id = source.workspace_id and sw.board_instance_id = p_board_instance_id and sw.active and sw.archived_at is null
  join public.board_workspaces tw on tw.id = target.workspace_id and tw.board_instance_id = p_board_instance_id and tw.active and tw.archived_at is null
  where edge.workflow_version_id = v_definition.id;
  select coalesce(jsonb_agg(node || jsonb_build_object(
    'is_initial', not exists (select 1 from jsonb_array_elements(v_edges) e where e->>'to_step_key' = node->>'step_key'),
    'is_completion', not exists (select 1 from jsonb_array_elements(v_edges) e where e->>'from_step_key' = node->>'step_key')
  )), '[]'::jsonb) into v_steps from jsonb_array_elements(v_steps) node;
  select coalesce(jsonb_agg(to_jsonb(gate) || jsonb_build_object('step_key', step.step_key) order by gate.sort_order, gate.id), '[]'::jsonb)
    into v_gates from public.board_workflow_gates gate join public.board_workflow_steps step on step.id = gate.step_id
    join public.board_workspaces w on w.id = step.workspace_id and w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
    where gate.workflow_version_id = v_definition.id;
  select coalesce(jsonb_agg(to_jsonb(evidence) || jsonb_build_object('gate_key', gate.gate_key) order by evidence.sort_order, evidence.id), '[]'::jsonb)
    into v_evidence from public.board_workflow_evidence_requirements evidence join public.board_workflow_gates gate on gate.id = evidence.gate_id
    where gate.workflow_version_id = v_definition.id and exists (select 1 from jsonb_array_elements(v_gates) g where g->>'gate_key' = gate.gate_key);

  if v_needs_publish then
    -- The existing unique index allows one Draft. Park its status/pointer only
    -- inside this locked transaction, keeping all rows/IDs/content/timestamps.
    -- Restore it after canonical Publish; rollback restores it on any failure.
    update public.board_instance_workflow_state set draft_workflow_version_id = null where board_instance_id = p_board_instance_id;
    update public.board_workflow_definitions set status = 'retired' where id = v_retained_draft;
    v_saved := public.board_c_workflow_save_draft(p_board_instance_id,
      coalesce(v_definition.name, v_instance.name || ' 流程'), v_definition.description, v_steps, v_edges, v_gates, v_evidence);
    v_system_draft := (v_saved->'workflow'->>'id')::uuid;
    update public.board_workflow_definitions set based_on_workflow_version_id = v_definition.id where id = v_system_draft;
    v_validated := public.board_c_workflow_validate_draft(v_system_draft);
    if coalesce((v_validated->'validation'->>'valid')::boolean, false) is not true then
      raise exception using errcode = '55000', message = '工作區與流程目前無法安全對應；未變更任何資料。';
    end if;
    v_result := public.board_c_workflow_publish(v_system_draft, v_definition.id);
    update public.board_workflow_definitions set status = 'draft' where id = v_retained_draft;
  else
    v_system_draft := v_definition.id;
    v_result := jsonb_build_object('workflow', private.board_workflow_snapshot(v_definition.id));
  end if;

  -- Synchronize only required Workspace nodes in every retained user Draft.
  -- Surviving node/Edge/Gate/evidence IDs and all user settings stay unchanged.
  -- Cascade removes incident Draft references only for deactivated Workspaces.
  for v_user_draft in select * from public.board_workflow_definitions
    where board_instance_id = p_board_instance_id and status = 'draft' order by id for update loop
    delete from public.board_workflow_steps s where s.workflow_version_id = v_user_draft.id and not exists (
      select 1 from public.board_workspaces w where w.id = s.workspace_id and w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
    );
    for v_node in select value from jsonb_array_elements(v_steps) loop
      if not exists (select 1 from public.board_workflow_steps where workflow_version_id = v_user_draft.id and workspace_id = (v_node->>'workspace_id')::uuid) then
        v_key := v_node->>'step_key'; v_suffix := 1;
        while exists (select 1 from public.board_workflow_steps where workflow_version_id = v_user_draft.id and step_key = v_key) loop
          v_suffix := v_suffix + 1; v_key := left(v_node->>'step_key', 55) || '-' || v_suffix;
        end loop;
        select coalesce(max(sort_order), 0) + 10 into v_order from public.board_workflow_steps where workflow_version_id = v_user_draft.id;
        insert into public.board_workflow_steps(workflow_version_id,workspace_id,step_key,name,sort_order,role_key,status_key,is_initial,is_completion)
          values(v_user_draft.id,(v_node->>'workspace_id')::uuid,v_key,v_node->>'name',v_order,v_node->>'role_key',v_node->>'status_key',true,true);
      end if;
    end loop;
    update public.board_workflow_definitions set based_on_workflow_version_id = v_system_draft where id = v_user_draft.id;
  end loop;
  update public.board_instance_workflow_state set draft_workflow_version_id = coalesce(v_state.draft_workflow_version_id, v_retained_draft) where board_instance_id = p_board_instance_id;
  if exists (select 1 from public.board_workspaces w where w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
    and (select count(*) from public.board_workflow_steps s where s.workflow_version_id = v_system_draft and s.workspace_id = w.id) <> 1) then
    raise exception using errcode = '55000', message = '工作區階段尚未完整讀回；未變更任何資料。';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.board_workspace_publish_lifecycle(uuid) from public, anon, authenticated;


-- Existing writer signatures and permissions remain unchanged.
create or replace function public.board_instance_create_workspace(
  p_board_instance_id uuid,
  p_name text,
  p_workspace_key text default null
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_name text := btrim(coalesce(p_name, ''));
  v_key text;
  v_order integer;
  v_owner uuid;
  v_row public.board_workspaces;
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  select * into v_instance from public.board_instances
  where id = p_board_instance_id and active = true for update;
  if not found then raise exception using errcode = 'P0002', message = 'Active board instance not found'; end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception using errcode = '22023', message = 'Workspace name is invalid';
  end if;
  v_key := nullif(btrim(coalesce(p_workspace_key, '')), '');
  if v_key is null then
    v_key := lower(v_instance.task_code_prefix) || '-custom-' || replace(gen_random_uuid()::text, '-', '');
  end if;
  -- The existing caller-generated key makes transport retries idempotent.
  select * into v_row from public.board_workspaces where board_instance_id = p_board_instance_id and workspace_key = v_key;
  if found then
    if not v_row.active or v_row.archived_at is not null or v_row.name <> v_name then
      raise exception using errcode = '22023', message = '工作區建立請求已用於不同內容，請重新整理後再試。';
    end if;
    perform private.board_workspace_publish_lifecycle(p_board_instance_id);
    return v_row;
  end if;
  select coalesce(max(sort_order), 0) + 10 into v_order
  from public.board_workspaces where board_instance_id = p_board_instance_id and active = true;
  v_owner := case when v_instance.authorization_mode = 'owner' then v_user else null end;
  insert into public.board_workspaces (
    board_instance_id, workspace_key, name, sort_order, active,
    application_scope, owner_uuid, created_by, updated_by
  ) values (
    p_board_instance_id, v_key, v_name, v_order, true,
    null, v_owner, v_user, v_user
  ) returning * into v_row;
  perform private.board_workspace_publish_lifecycle(p_board_instance_id);
  return v_row;
end;
$function$;

create or replace function public.board_instance_delete_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_count integer := 0;
  v_previous_guard text;
begin
  -- Board-first ordering matches create/archive/restore and serializes writers.
  select * into v_workspace from public.board_workspaces where id = p_workspace_id;
  if not found or auth.uid() is null or not public.board_instance_can_write(v_workspace.board_instance_id) then
    raise exception using errcode = '42501', message = 'Board workspace delete authorization is required';
  end if;
  perform 1 from public.board_instances where id = v_workspace.board_instance_id and active for update;
  select *
    into v_workspace
    from public.board_workspaces
   where id = p_workspace_id
     and active = true
   for update;

  if not found or not public.board_instance_can_write(v_workspace.board_instance_id) then
    raise exception using
      errcode = '42501',
      message = 'Board workspace delete authorization is required';
  end if;

  select count(*)
    into v_count
    from public.board_tasks
   where workspace_id = p_workspace_id;

  if v_count = 0 then
    v_previous_guard := current_setting('zhuge.module_c_workspace_lifecycle', true);
    perform set_config('zhuge.module_c_workspace_lifecycle', p_workspace_id::text || ':delete-empty', true);
    update public.board_workspaces
       set active = false,
           archived_at = now(),
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_workspace_id;

    perform set_config('zhuge.module_c_workspace_lifecycle', coalesce(v_previous_guard, ''), true);
    perform private.board_workspace_publish_lifecycle(v_workspace.board_instance_id);

    return jsonb_build_object(
      'workspace_id', p_workspace_id,
      'deleted', true,
      'moved_task_count', 0,
      'moved_task_ids', '[]'::jsonb,
      'target_workspace_id', null,
      'empty_workspace', true
    );
  end if;

  -- Populated deletion is intentionally fail-closed. Cards must be moved
  -- through the canonical C movement contract before Workspace deletion.
  raise exception using
    errcode = '55000',
    message = 'Workspace 內仍有卡片，必須先移動／清空卡片，才能刪除 Workspace';
end;
$function$;

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
  v_workflow_version_id uuid;
  v_current_workflow_step_id uuid;
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
     and active = true for update;
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

  if v_workflow_mode = 'published' then
    perform private.board_workspace_publish_lifecycle(p_board_instance_id);
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
      v_workflow_version_id := v_workflow.workflow_version_id;
      v_current_workflow_step_id := v_workflow.current_workflow_step_id;
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
    v_workflow_version_id,
    v_current_workflow_step_id
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

  -- Personal WorkTodo also receives the shared zero-edge structural baseline.
  if v_is_personal_worktodo then
    v_published_workflow_response := private.board_workspace_publish_lifecycle(v_instance.id);
    v_workflow_version_id := (v_published_workflow_response #>> '{workflow,id}')::uuid;
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
  if not exists (select 1 from public.board_workflow_steps where workflow_version_id = p_workflow_version_id)
    and exists (select 1 from public.board_workspaces where board_instance_id = v_definition.board_instance_id and active and archived_at is null) then
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
     where gate.workflow_version_id = p_workflow_version_id
       and not exists (select 1 from public.board_workflow_steps step where step.id = gate.step_id and step.workflow_version_id = p_workflow_version_id)
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
  v_workflow_version_id uuid;
  v_current_workflow_step_id uuid;
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
    if v_actor_type = 'human' then perform private.board_workspace_publish_lifecycle(v_instance.id); end if;
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
      v_workflow_version_id := v_workflow.workflow_version_id;
      v_current_workflow_step_id := v_workflow.current_workflow_step_id;
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
    v_workflow_version_id, v_current_workflow_step_id
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

create or replace function public.board_c_workflow_publish(
  p_workflow_version_id uuid,
  p_expected_published_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_previous uuid;
  v_validation jsonb;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_workflow_version_id::text, coalesce(p_expected_published_version_id::text, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
begin
  -- Same Board-first order as saveDraft and Workspace lifecycle writers.
  perform 1 from public.board_instances where id = (
    select board_instance_id from public.board_workflow_definitions where id = p_workflow_version_id
  ) for update;
  select * into v_definition
  from public.board_workflow_definitions
  where id = p_workflow_version_id
  for update;
  if not found or not public.board_instance_can_write(v_definition.board_instance_id) then
    raise exception using errcode = '42501', message = '只有子板 Owner／授權管理者可以發布流程。';
  end if;
  if v_definition.status <> 'draft' then
    raise exception using errcode = '55000', message = '只有流程草稿可以發布；已發布版本不可覆寫。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key
      and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '發布請求的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;
  select * into v_state
  from public.board_instance_workflow_state
  where board_instance_id = v_definition.board_instance_id
  for update;
  v_previous := v_state.published_workflow_version_id;
  if p_expected_published_version_id is not null
     and v_previous is distinct from p_expected_published_version_id then
    raise exception using errcode = '40001', message = '已發布版本已變更，請重新載入後再發布。';
  end if;
  v_validation := private.board_workflow_validate(p_workflow_version_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception using errcode = '22023', message = '流程草稿尚未通過驗證。', detail = v_validation::text;
  end if;
  if v_previous is not null then
    update public.board_workflow_definitions
    set status = 'retired', retired_at = now(), updated_at = now()
    where id = v_previous and status = 'published';
  end if;
  update public.board_workflow_definitions
  set status = 'published', published_by = auth.uid(), published_at = now(), updated_at = now()
  where id = p_workflow_version_id
  returning * into v_definition;
  insert into public.board_instance_workflow_state (
    board_instance_id,
    draft_workflow_version_id,
    published_workflow_version_id,
    updated_by
  )
  values (v_definition.board_instance_id, null, p_workflow_version_id, auth.uid())
  on conflict (board_instance_id) do update
  set draft_workflow_version_id = null,
      published_workflow_version_id = excluded.published_workflow_version_id,
      updated_by = excluded.updated_by,
      updated_at = now();
  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'publish',
    'board_instance_id', v_definition.board_instance_id,
    'workflow', private.board_workflow_snapshot(p_workflow_version_id),
    'previous_published_workflow_version_id', v_previous
  );
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workflow_definition', v_definition.id::text, 'workflow_published', v_response,
    'C Mother workflow published', auth.uid(), 'human', 'PM', 'system_activity'
  );
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, request_hash, response, status
    ) values (
      p_idempotency_key, 'publish', v_definition.board_instance_id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

revoke all on function public.board_instance_create_workspace(uuid,text,text), public.board_instance_delete_workspace(uuid), public.board_instance_create_task(uuid,text,text,text,text,uuid,text), public.board_provision_c_consumer_v2(text,text,text,text,jsonb,jsonb,text) from public, anon;
grant execute on function public.board_instance_create_workspace(uuid,text,text), public.board_instance_delete_workspace(uuid), public.board_instance_create_task(uuid,text,text,text,text,uuid,text), public.board_provision_c_consumer_v2(text,text,text,text,jsonb,jsonb,text) to authenticated;

create or replace function private.board_c_completion_archive_scope(
  p_board_instance_id uuid,
  p_workflow_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_completion_step public.board_workflow_steps%rowtype;
  v_completion_workspace public.board_workspaces%rowtype;
  v_policy private.module_c_completion_archive_policies%rowtype;
  v_designation jsonb;
begin
  if p_board_instance_id is null then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 缺少 Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_REQUIRED'
      )::text;
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true
     and template_key = 'c';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Module C Archive Context 找不到啟用中的 C Board Instance；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_INSTANCE_UNAVAILABLE',
        'board_instance_id', p_board_instance_id
      )::text;
  end if;

  if p_workflow_version_id is null then
    v_designation := private.board_c_completion_archive_designation(p_board_instance_id);

    if v_designation->>'status' = 'not_configured' then
      return jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'scope', 'board-instance+optional-completion-designation',
        'state', 'not_applicable',
        'workflow_optional', true,
        'board_instance_id', v_instance.id,
        'workflow_version_id', null,
        'workflow_status', 'not_configured',
        'published_workflow_version_id', null,
        'completion_step_id', null,
        'completion_step_name', null,
        'completion_workspace_id', null,
        'completion_workspace_name', null,
        'completion_designation_status', 'not_configured',
        'completion_designation_source', 'stable-workspace-key',
        'archive_designation', 'not_applicable',
        'archive_designation_status', 'not_applicable',
        'policy_identity', null,
        'policy_key', null,
        'policy_version', null,
        'archive_delay_seconds', null,
        'policy_source', null,
        'existing_due_at_retroactive', false,
        'scope_verified', true
      );
    end if;

    select *
      into v_policy
      from private.module_c_completion_archive_policies
     where policy_key = 'completion_archive'
       and status = 'published'
     order by policy_version desc
     limit 1;

    if not found or v_policy.archive_delay_seconds <= 0 then
      raise exception using
        errcode = '55000',
        message = 'Module C Completion Archive Policy 不可用；已安全停止。',
        detail = jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'capability', 'completion-archive-lifecycle',
          'error_code', 'C_ARCHIVE_POLICY_UNAVAILABLE',
          'board_instance_id', p_board_instance_id
        )::text;
    end if;

    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'capability', 'completion-archive-lifecycle',
      'scope', 'board-instance+optional-completion-designation',
      'state', 'configured',
      'workflow_optional', true,
      'board_instance_id', v_instance.id,
      'workflow_version_id', null,
      'workflow_status', 'not_configured',
      'published_workflow_version_id', null,
      'completion_step_id', null,
      'completion_step_name', null,
      'completion_workspace_id', v_designation->>'workspace_id',
      'completion_workspace_name', v_designation->>'workspace_name',
      'completion_designation_status', 'configured',
      'completion_designation_source', v_designation->>'source',
      'archive_designation', v_designation->>'archive_designation',
      'archive_designation_status', 'configured',
      'policy_identity', v_policy.policy_identity,
      'policy_key', v_policy.policy_key,
      'policy_version', v_policy.policy_version,
      'archive_delay_seconds', v_policy.archive_delay_seconds,
      'policy_source', v_policy.policy_source,
      'existing_due_at_retroactive', false,
      'scope_verified', true
    );
  end if;

  select *
    into v_state
    from public.board_instance_workflow_state
   where board_instance_id = p_board_instance_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = '此 Board Instance 尚未建立 Workflow Scope；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_STATE_REQUIRED',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id
      )::text;
  end if;

  select *
    into v_definition
    from public.board_workflow_definitions
   where id = p_workflow_version_id
     and board_instance_id = p_board_instance_id
     and status in ('published', 'retired')
     and published_at is not null;

  if not found then
    raise exception using
      errcode = '55000',
      message = '指定的 Workflow 不是此 Board Instance 的已發布流程版本；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_WORKFLOW_BINDING_INVALID',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id
      )::text;
  end if;

  if v_definition.status = 'published'
     and v_state.published_workflow_version_id is distinct from v_definition.id then
    raise exception using
      errcode = '55000',
      message = 'Published Workflow 與 Board Instance 的正式指標不一致；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_PUBLISHED_POINTER_MISMATCH',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', p_workflow_version_id,
        'published_workflow_version_id', v_state.published_workflow_version_id
      )::text;
  end if;

  -- Topological endpoints are not Completion ownership. Zero-edge nodes may
  -- all be endpoints; use the existing stable designation, never an arbitrary
  -- is_completion row. The 24h policy/writers/countdown are unchanged.
  v_designation := private.board_c_completion_archive_designation(p_board_instance_id);
  select * into v_completion_step from public.board_workflow_steps
    where workflow_version_id = v_definition.id
      and workspace_id = (v_designation->>'workspace_id')::uuid;
  if not found then
    if v_designation->>'workspace_id' is not null then
      raise exception using errcode = '55000',
        message = '完成工作區尚未對應正式流程階段，請重新整理後再試。',
        detail = jsonb_build_object('error_code','C_ARCHIVE_COMPLETION_STEP_REQUIRED',
          'board_instance_id',p_board_instance_id,'workflow_version_id',v_definition.id)::text;
    end if;
    return jsonb_build_object(
      'contract','module-c-lifecycle-acceptance-v2','capability','completion-archive-lifecycle',
      'scope','board-instance+optional-completion-designation','state','not_applicable',
      'workflow_optional',true,'board_instance_id',v_instance.id,
      'workflow_version_id',v_definition.id,'workflow_status',v_definition.status,
      'published_workflow_version_id',v_state.published_workflow_version_id,
      'completion_step_id',null,'completion_step_name',null,'completion_workspace_id',null,'completion_workspace_name',null,
      'completion_designation_status','not_configured','completion_designation_source','stable-workspace-key',
      'archive_designation','not_applicable','archive_designation_status','not_applicable',
      'policy_identity',null,'policy_key',null,'policy_version',null,'archive_delay_seconds',null,
      'policy_source',null,'existing_due_at_retroactive',false,'scope_verified',true
    );
  end if;

  select *
    into v_completion_workspace
    from public.board_workspaces
   where id = v_completion_step.workspace_id
     and board_instance_id = p_board_instance_id
     and active = true
     and archived_at is null;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Completion Step 對應的 Workspace 無效或未啟用；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_COMPLETION_WORKSPACE_INVALID',
        'board_instance_id', p_board_instance_id,
        'workflow_version_id', v_definition.id,
        'completion_step_id', v_completion_step.id,
        'completion_workspace_id', v_completion_step.workspace_id
      )::text;
  end if;

  select *
    into v_policy
    from private.module_c_completion_archive_policies
   where policy_key = 'completion_archive'
     and status = 'published'
   order by policy_version desc
   limit 1;

  if not found or v_policy.archive_delay_seconds <= 0 then
    raise exception using
      errcode = '55000',
      message = 'Module C Completion Archive Policy 不可用；已安全停止。',
      detail = jsonb_build_object(
        'contract', 'module-c-lifecycle-acceptance-v2',
        'capability', 'completion-archive-lifecycle',
        'error_code', 'C_ARCHIVE_POLICY_UNAVAILABLE'
      )::text;
  end if;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'scope', 'board-instance+published-workflow-version',
    'state', 'configured',
    'workflow_optional', true,
    'board_instance_id', v_instance.id,
    'workflow_version_id', v_definition.id,
    'workflow_status', v_definition.status,
    'workflow_version_no', v_definition.version_no,
    'published_workflow_version_id', v_state.published_workflow_version_id,
    'completion_step_id', v_completion_step.id,
    'completion_step_name', v_completion_step.name,
    'completion_workspace_id', v_completion_workspace.id,
    'completion_workspace_name', v_completion_workspace.name,
    'completion_designation_status', 'configured',
    'completion_designation_source', 'published-workflow-step',
    'archive_designation', 'task-archive-state',
    'archive_designation_status', 'configured',
    'policy_identity', v_policy.policy_identity,
    'policy_key', v_policy.policy_key,
    'policy_version', v_policy.policy_version,
    'archive_delay_seconds', v_policy.archive_delay_seconds,
    'policy_source', v_policy.policy_source,
    'existing_due_at_retroactive', false,
    'scope_verified', true
  );
end;
$function$;
revoke all on function private.board_c_completion_archive_scope(uuid,uuid) from public, anon, authenticated;
commit;
