-- Module C Workspace lifecycle. Source-only; no backfill or Task mutation.
-- Completion countdown remains a separate authority / migration.
begin;

-- Extend the existing WorkTodo guard. Ordering and immutable ownership checks
-- remain unchanged. The lifecycle marker is Workspace/operation scoped, restored
-- after the update, and cannot authorize unrelated field changes.
create or replace function public.enforce_worktodo_workspace_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1'
       or lower(coalesce(old.workspace_key, '')) in ('completed', 'done', 'worktodo-completed', 'mdtk-completed')
       or lower(coalesce(old.workspace_key, '')) like '%-completed'
       or coalesce(old.name, '') in ('完成', '已完成') then
      raise exception using errcode = '42501', message = 'WorkTodo completion workspace or uncontrolled delete is not allowed';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.module_c_workspace_lifecycle', true), '') in (old.id::text || ':archive', old.id::text || ':delete-empty') then
      if auth.uid() is null or not public.board_instance_can_write(old.board_instance_id)
         or old.active is not true or old.archived_at is not null
         or new.active is not false or new.archived_at is null
         or new.updated_by is distinct from auth.uid()
         or (private.board_c_completion_archive_designation(old.board_instance_id)->>'workspace_id')::uuid = old.id
         or (current_setting('zhuge.module_c_workspace_lifecycle', true) = old.id::text || ':delete-empty' and exists (select 1 from public.board_tasks where workspace_id = old.id))
         or (to_jsonb(new) - array['active', 'archived_at', 'updated_by', 'updated_at'])
           is distinct from (to_jsonb(old) - array['active', 'archived_at', 'updated_by', 'updated_at']) then
        raise exception using errcode = '42501', message = 'Module C workspace archive guard rejects ownership or unrelated changes';
      end if;
      return new;
    end if;
    if coalesce(current_setting('zhuge.module_c_workspace_lifecycle', true), '') = old.id::text || ':restore' then
      if auth.uid() is null or not public.board_instance_can_write(old.board_instance_id)
         or old.active is not false or old.archived_at is null
         or new.active is not true or new.archived_at is not null
         or new.updated_by is distinct from auth.uid()
         or (to_jsonb(new) - array['active', 'archived_at', 'name', 'sort_order', 'updated_by', 'updated_at'])
           is distinct from (to_jsonb(old) - array['active', 'archived_at', 'name', 'sort_order', 'updated_by', 'updated_at']) then
        raise exception using errcode = '42501', message = 'Module C workspace restore guard rejects ownership or unrelated changes';
      end if;
      return new;
    end if;
    if coalesce(current_setting('zhuge.module_c_workspace_ordering', true), '') = '1' then
      if (to_jsonb(new) - array['sort_order', 'updated_by', 'updated_at'])
         is distinct from (to_jsonb(old) - array['sort_order', 'updated_by', 'updated_at']) then
        raise exception using errcode = '42501', message = 'Module C workspace ordering guard permits sort_order only';
      end if;
      return new;
    end if;
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1' then
      raise exception using errcode = '42501', message = 'WorkTodo system workspaces require the controlled WorkTodo workspace path';
    end if;
    if new.application_scope is distinct from old.application_scope
       or new.workspace_key is distinct from old.workspace_key
       or new.owner_uuid is distinct from old.owner_uuid
       or new.active is distinct from old.active
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'WorkTodo workspace identity is immutable';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$function$;

-- Server projection of the shared isArchiveTask contract. All workspace
-- lifecycle RPCs use this projection, including every retained Task row.
create or replace function private.board_workspace_retention(p_workspace_id uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  with classified as (
    select task.work_code, case
      -- WorkTodo's existing presentation waits for the Cloud archive stamp,
      -- including personal WorkTodo scopes. Respect that current-work contract.
      when instance.legacy_application_scope = 'worktodo' or instance.legacy_application_scope like 'worktodo-user-%' then task.archived_at is not null
      when regexp_replace(lower(coalesce(task.status, '')), '[[:space:]_-]', '', 'g') in ('merged','merge','cancelled','canceled','cancel') then true
      when task.archived_at is not null then true
      when task.completion_at is not null and task.archive_due_at is not null then task.archive_due_at <= now()
      when task.completion_at is not null then false
      else regexp_replace(lower(coalesce(task.status, '')), '[[:space:]_-]', '', 'g') in ('done','complete','completed')
    end as historical
    from public.board_tasks task
    join public.board_workspaces workspace on workspace.id = task.workspace_id
    join public.board_instances instance on instance.id = workspace.board_instance_id
    where task.workspace_id = p_workspace_id
  ) select jsonb_build_object(
    'current', count(*) filter (where not historical),
    'history', count(*) filter (where historical),
    'retained_total', count(*),
    'history_codes', coalesce(jsonb_agg(work_code order by work_code) filter (where historical), '[]'::jsonb)
  ) from classified;
$function$;

-- Delegate lifecycle changes to saveDraft -> validate -> publish. Published
-- snapshots and Task bindings remain immutable; no second workflow authority.
create or replace function private.board_workspace_publish_lifecycle(p_board_instance_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_state public.board_instance_workflow_state%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_steps jsonb; v_edges jsonb; v_gates jsonb; v_evidence jsonb;
  v_saved jsonb; v_validated jsonb; v_draft uuid;
begin
  select * into v_state from public.board_instance_workflow_state where board_instance_id = p_board_instance_id for update;
  if v_state.draft_workflow_version_id is not null or exists (
    select 1 from public.board_workflow_definitions where board_instance_id = p_board_instance_id and status = 'draft'
  ) then
    raise exception using errcode = '55000', message = '此看板有尚未發布的流程草稿。請先在流程設定完成草稿發布，再封存／恢復工作區。';
  end if;
  if v_state.published_workflow_version_id is null then return null; end if;
  select * into v_definition from public.board_workflow_definitions
    where id = v_state.published_workflow_version_id and board_instance_id = p_board_instance_id and status = 'published';
  if not found then raise exception using errcode = '55000', message = '流程版本已變更，請重新整理看板後再試。'; end if;
  -- Recover restored node metadata, but never recreate incident edges.
  with nodes as (
    select w.id, coalesce(s.name, w.name) as name, w.sort_order,
      coalesce(s.step_key, 'ws-' || replace(w.id::text, '-', '')) as step_key,
      coalesce(s.role_key, 'co') as role_key, coalesce(s.status_key, 'ready') as status_key
    from public.board_workspaces w left join lateral (
      select step.* from public.board_workflow_steps step join public.board_workflow_definitions def on def.id = step.workflow_version_id
      where step.workspace_id = w.id and def.board_instance_id = p_board_instance_id and def.status in ('published','retired')
      order by (def.id = v_definition.id) desc, def.version_no desc limit 1
    ) s on true
    where w.board_instance_id = p_board_instance_id and w.active and w.archived_at is null
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', id, 'step_key', step_key, 'name', name,
    'sort_order', sequence, 'role_key', role_key, 'status_key', status_key,
    'is_initial', false, 'is_completion', false
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
  join public.board_workspaces sw on sw.id = source.workspace_id and sw.active and sw.archived_at is null
  join public.board_workspaces tw on tw.id = target.workspace_id and tw.active and tw.archived_at is null
  where edge.workflow_version_id = v_definition.id;
  select coalesce(jsonb_agg(node || jsonb_build_object(
    'is_initial', not exists (select 1 from jsonb_array_elements(v_edges) e where e->>'to_step_key' = node->>'step_key'),
    'is_completion', not exists (select 1 from jsonb_array_elements(v_edges) e where e->>'from_step_key' = node->>'step_key')
  )), '[]'::jsonb) into v_steps from jsonb_array_elements(v_steps) node;
  select coalesce(jsonb_agg(to_jsonb(gate) || jsonb_build_object('step_key', step.step_key) order by gate.sort_order, gate.id), '[]'::jsonb)
    into v_gates from public.board_workflow_gates gate
    join public.board_workflow_steps step on step.id = gate.step_id
    join public.board_workspaces w on w.id = step.workspace_id and w.active and w.archived_at is null
    where gate.workflow_version_id = v_definition.id;
  select coalesce(jsonb_agg(to_jsonb(evidence) || jsonb_build_object('gate_key', gate.gate_key) order by evidence.sort_order, evidence.id), '[]'::jsonb)
    into v_evidence from public.board_workflow_evidence_requirements evidence
    join public.board_workflow_gates gate on gate.id = evidence.gate_id
    where gate.workflow_version_id = v_definition.id and exists (select 1 from jsonb_array_elements(v_gates) g where g->>'gate_key' = gate.gate_key);
  v_saved := public.board_c_workflow_save_draft(p_board_instance_id, v_definition.name, v_definition.description, v_steps, v_edges, v_gates, v_evidence);
  v_draft := (v_saved->'workflow'->>'id')::uuid;
  update public.board_workflow_definitions set based_on_workflow_version_id = v_definition.id where id = v_draft;
  v_validated := public.board_c_workflow_validate_draft(v_draft);
  if coalesce((v_validated->'validation'->>'valid')::boolean, false) is not true then
    raise exception using errcode = '55000', message = '工作區與流程目前無法安全對應；未變更任何資料。請先檢查流程設定。';
  end if;
  return public.board_c_workflow_publish(v_draft, v_definition.id);
end;
$function$;

create or replace function public.board_instance_archive_workspace(p_board_instance_id uuid, p_workspace_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare v_before public.board_workspaces%rowtype; v_after public.board_workspaces%rowtype; v_counts jsonb; v_workflow jsonb; v_previous_guard text;
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '你沒有管理此看板工作區的權限。';
  end if;
  perform 1 from public.board_instances where id = p_board_instance_id and active for update;
  if not found then raise exception using errcode = '55000', message = '此看板目前未啟用。'; end if;
  select * into v_before from public.board_workspaces where id = p_workspace_id and board_instance_id = p_board_instance_id for update;
  if not found or not v_before.active or v_before.archived_at is not null then
    raise exception using errcode = '55000', message = '工作區狀態已變更，請重新整理。';
  end if;
  if (private.board_c_completion_archive_designation(p_board_instance_id)->>'workspace_id')::uuid = p_workspace_id then
    raise exception using errcode = '55000', message = '完成工作區需保留以處理完成與封存生命週期，不能封存。';
  end if;
  -- Workspace FOR UPDATE conflicts with the FK key-share locks of concurrent
  -- Task inserts/moves. Related existing Task rows are also locked.
  perform 1 from public.board_tasks where workspace_id = p_workspace_id for update;
  v_counts := private.board_workspace_retention(p_workspace_id);
  if (v_counts->>'current')::integer > 0 then
    raise exception using errcode = '55000', message = '此工作區仍有進行中的卡片，請先處理目前工作，再封存工作區。';
  end if;
  if (v_counts->>'history')::integer = 0 then
    raise exception using errcode = '55000', message = '空工作區請使用刪除工作區；系統會保留操作紀錄。';
  end if;
  v_previous_guard := current_setting('zhuge.module_c_workspace_lifecycle', true);
  perform set_config('zhuge.module_c_workspace_lifecycle', p_workspace_id::text || ':archive', true);
  update public.board_workspaces set active = false, archived_at = now(), updated_at = now(), updated_by = auth.uid()
    where id = p_workspace_id returning * into v_after;
  perform set_config('zhuge.module_c_workspace_lifecycle', coalesce(v_previous_guard, ''), true);
  v_workflow := private.board_workspace_publish_lifecycle(p_board_instance_id);
  insert into public.engineering_activity_log(entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type)
    values ('board_workspace', p_workspace_id::text, 'workspace_archived', to_jsonb(v_before), to_jsonb(v_after), 'Workspace archived; all retained ownership unchanged', auth.uid(), 'human', 'PM', 'system_activity');
  return jsonb_build_object('workspace', to_jsonb(v_after), 'counts', v_counts, 'workflow', v_workflow);
end;
$function$;

create or replace function public.board_instance_restore_workspace(p_board_instance_id uuid, p_workspace_id uuid, p_name text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare v_before public.board_workspaces%rowtype; v_after public.board_workspaces%rowtype; v_counts jsonb; v_name text; v_order integer; v_workflow jsonb; v_previous_guard text;
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '你沒有管理此看板工作區的權限。';
  end if;
  perform 1 from public.board_instances where id = p_board_instance_id and active for update;
  if not found then raise exception using errcode = '55000', message = '此看板目前未啟用。'; end if;
  select * into v_before from public.board_workspaces where id = p_workspace_id and board_instance_id = p_board_instance_id for update;
  if not found or v_before.active or v_before.archived_at is null then
    raise exception using errcode = '55000', message = '工作區狀態已變更，請重新整理。';
  end if;
  perform 1 from public.board_tasks where workspace_id = p_workspace_id for update;
  v_counts := private.board_workspace_retention(p_workspace_id);
  if (v_counts->>'retained_total')::integer = 0 then
    raise exception using errcode = '55000', message = '此工作區已依空工作區移除流程處理，不能從封存清單恢復。';
  end if;
  v_name := btrim(coalesce(p_name, v_before.name));
  if v_name = '' then raise exception using errcode = '22023', message = '請輸入工作區名稱。'; end if;
  if exists (select 1 from public.board_workspaces where board_instance_id = p_board_instance_id and active and lower(btrim(name)) = lower(v_name)) then
    raise exception using errcode = '22023', message = '看板已有同名工作區，請換一個名稱後再恢復。';
  end if;
  v_order := v_before.sort_order;
  if exists (select 1 from public.board_workspaces where board_instance_id = p_board_instance_id and active and sort_order = v_order) then
    select coalesce(max(sort_order), 0) + 10 into v_order from public.board_workspaces where board_instance_id = p_board_instance_id and active;
  end if;
  v_previous_guard := current_setting('zhuge.module_c_workspace_lifecycle', true);
  perform set_config('zhuge.module_c_workspace_lifecycle', p_workspace_id::text || ':restore', true);
  update public.board_workspaces set active = true, archived_at = null, name = v_name, sort_order = v_order, updated_at = now(), updated_by = auth.uid()
    where id = p_workspace_id returning * into v_after;
  perform set_config('zhuge.module_c_workspace_lifecycle', coalesce(v_previous_guard, ''), true);
  perform private.board_c_completion_archive_designation(p_board_instance_id);
  v_workflow := private.board_workspace_publish_lifecycle(p_board_instance_id);
  insert into public.engineering_activity_log(entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type)
    values ('board_workspace', p_workspace_id::text, 'workspace_restored', to_jsonb(v_before), to_jsonb(v_after), 'Same Workspace UUID restored; no Task movement', auth.uid(), 'human', 'PM', 'system_activity');
  return jsonb_build_object('workspace', to_jsonb(v_after), 'counts', v_counts, 'workflow', v_workflow);
end;
$function$;

create or replace function public.board_instance_list_archived_workspaces(p_board_instance_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.board_instance_can_read(p_board_instance_id) then
    raise exception using errcode = '42501', message = '你沒有讀取此看板的權限。';
  end if;
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('counts', counts.value) order by w.archived_at desc, w.id), '[]'::jsonb)
    into v_result from public.board_workspaces w
    cross join lateral (select private.board_workspace_retention(w.id) as value) counts
    where w.board_instance_id = p_board_instance_id and not w.active and w.archived_at is not null
      and (counts.value->>'retained_total')::integer > 0;
  return v_result;
end;
$function$;

revoke all on function private.board_workspace_retention(uuid), private.board_workspace_publish_lifecycle(uuid) from public, anon, authenticated;
revoke all on function public.board_instance_archive_workspace(uuid,uuid), public.board_instance_restore_workspace(uuid,uuid,text), public.board_instance_list_archived_workspaces(uuid) from public, anon;
grant execute on function public.board_instance_archive_workspace(uuid,uuid), public.board_instance_restore_workspace(uuid,uuid,text), public.board_instance_list_archived_workspaces(uuid) to authenticated;

-- Retained evidence from older versions must not invalidate a new version.
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


-- Preserve the existing empty soft-deactivate contract through the same guard.
-- Populated deletion still fails before any marker/update; no Task movement.
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

commit;
