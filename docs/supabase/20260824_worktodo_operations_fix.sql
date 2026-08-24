-- WorkTodo operation repair.
--
-- Keep the canonical actor label constraint intact.  WorkTodo task and
-- workspace writes use the existing authenticated owner / creator paths;
-- this migration only repairs their Cloud implementation.

begin;

create or replace function public.worktodo_create_workspace(
  p_name text
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  name_value text := btrim(coalesce(p_name, ''));
  workspace_id_value uuid := gen_random_uuid();
  workspace_key_value text := 'worktodo-custom-' || replace(workspace_id_value::text, '-', '');
  sort_order_value integer;
  saved_workspace public.board_workspaces;
begin
  if v_user is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if length(name_value) = 0 then
    raise exception using errcode = '22023', message = 'WorkTodo workspace name is required';
  end if;
  if length(name_value) > 80 then
    raise exception using errcode = '22023', message = 'WorkTodo workspace name is too long';
  end if;

  select coalesce(max(sort_order), 0) + 10
  into sort_order_value
  from public.board_workspaces
  where application_scope = 'worktodo'
    and active = true;

  insert into public.board_workspaces (
    id, workspace_key, name, sort_order, active,
    created_by, updated_by, application_scope, owner_uuid
  ) values (
    workspace_id_value, workspace_key_value, name_value, sort_order_value, true,
    v_user, v_user, 'worktodo', null
  )
  returning * into saved_workspace;

  return saved_workspace;
end;
$function$;

drop function if exists public.worktodo_create_task(text, text, text, text);

create or replace function public.worktodo_create_task(
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
declare
  v_user uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'not_started')));
  v_workspace_id uuid;
  v_workspace_key text;
  v_task public.board_tasks;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception using errcode = '22023', message = 'WorkTodo task title is required';
  end if;
  v_workspace_key := public.worktodo_workspace_key(v_status);
  if v_workspace_key is null then
    raise exception using errcode = '22023', message = 'Unsupported WorkTodo status';
  end if;

  if p_workspace_id is null then
    select id into v_workspace_id
    from public.board_workspaces
    where application_scope = 'worktodo'
      and workspace_key = v_workspace_key
      and active = true;
  else
    select id into v_workspace_id
    from public.board_workspaces
    where id = p_workspace_id
      and application_scope = 'worktodo'
      and active = true;
  end if;
  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active WorkTodo workspace is unavailable';
  end if;

  insert into public.board_tasks (
    application_scope, owner_uuid, title, summary, status, workspace_id,
    source_workspace, domain, usage_scenario, created_by, created_at, updated_at
  ) values (
    'worktodo', v_user, btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''),
    v_status, v_workspace_id, 'worktodo', 'worktodo',
    nullif(btrim(coalesce(p_usage_scenario, '')), ''), v_user, now(), now()
  )
  returning * into v_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'worktodo_task_created', to_jsonb(v_task),
    'WorkTodo task created through the authenticated owner path',
    v_user, 'human', 'QJC', 'system_activity'
  );

  return v_task;
end;
$function$;

create or replace function public.worktodo_update_task(
  p_task_id uuid,
  p_patch jsonb
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_old public.board_tasks;
  v_task public.board_tasks;
  v_status text;
  v_workspace_id uuid;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'WorkTodo task patch must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key(name)
    where key.name not in ('title', 'summary', 'status', 'usage_scenario', 'workspace_id')
  ) then
    raise exception using errcode = '22023', message = 'Unsupported WorkTodo task field';
  end if;

  select * into v_old
  from public.board_tasks
  where id = p_task_id
    and application_scope = 'worktodo'
    and owner_uuid = v_user
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'WorkTodo task is not editable by the current user';
  end if;

  v_status := case
    when p_patch ? 'status' then lower(trim(coalesce(p_patch->>'status', '')))
    else v_old.status
  end;
  if public.worktodo_workspace_key(v_status) is null then
    raise exception using errcode = '22023', message = 'Unsupported WorkTodo status';
  end if;

  if p_patch ? 'workspace_id' then
    if nullif(btrim(p_patch->>'workspace_id'), '') is null then
      raise exception using errcode = '22023', message = 'WorkTodo workspace id is required';
    end if;
    begin
      v_workspace_id := (p_patch->>'workspace_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'WorkTodo workspace id is invalid';
    end;
    if not exists (
      select 1 from public.board_workspaces
      where id = v_workspace_id
        and application_scope = 'worktodo'
        and active = true
    ) then
      raise exception using errcode = 'P0002', message = 'Active WorkTodo workspace is unavailable';
    end if;
  elsif p_patch ? 'status' then
    select id into v_workspace_id
    from public.board_workspaces
    where application_scope = 'worktodo'
      and workspace_key = public.worktodo_workspace_key(v_status)
      and active = true;
  else
    v_workspace_id := v_old.workspace_id;
  end if;
  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active WorkTodo workspace is unavailable';
  end if;

  update public.board_tasks
  set title = case when p_patch ? 'title' then nullif(btrim(p_patch->>'title'), '') else title end,
      summary = case when p_patch ? 'summary' then nullif(btrim(coalesce(p_patch->>'summary', '')), '') else summary end,
      status = v_status,
      workspace_id = v_workspace_id,
      usage_scenario = case when p_patch ? 'usage_scenario' then nullif(btrim(coalesce(p_patch->>'usage_scenario', '')), '') else usage_scenario end,
      updated_at = now()
  where id = v_old.id
  returning * into v_task;

  if nullif(btrim(v_task.title), '') is null then
    raise exception using errcode = '22023', message = 'WorkTodo task title is required';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'worktodo_task_updated',
    jsonb_build_object('title', v_old.title, 'summary', v_old.summary, 'status', v_old.status, 'workspace_id', v_old.workspace_id, 'usage_scenario', v_old.usage_scenario),
    jsonb_build_object('title', v_task.title, 'summary', v_task.summary, 'status', v_task.status, 'workspace_id', v_task.workspace_id, 'usage_scenario', v_task.usage_scenario),
    'WorkTodo task updated through the authenticated owner path',
    v_user, 'human', 'QJC', 'system_activity'
  );

  return v_task;
end;
$function$;

create or replace function public.worktodo_add_task_progress_note(
  p_task_id uuid,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.engineering_activity_log;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'Progress note cannot be empty';
  end if;
  if not exists (
    select 1 from public.board_tasks
    where id = p_task_id
      and application_scope = 'worktodo'
      and owner_uuid = v_user
  ) then
    raise exception using errcode = '42501', message = 'WorkTodo task is not available to the current user';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'progress_note_created', btrim(p_note),
    v_user, 'human', 'QJC', 'human_progress_note'
  )
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.worktodo_create_workspace(text) from public, anon;
grant execute on function public.worktodo_create_workspace(text) to authenticated;
revoke all on function public.worktodo_create_task(text, text, text, text, uuid) from public, anon;
grant execute on function public.worktodo_create_task(text, text, text, text, uuid) to authenticated;
revoke all on function public.worktodo_update_task(uuid, jsonb) from public, anon;
grant execute on function public.worktodo_update_task(uuid, jsonb) to authenticated;
revoke all on function public.worktodo_add_task_progress_note(uuid, text) from public, anon;
grant execute on function public.worktodo_add_task_progress_note(uuid, text) to authenticated;

comment on function public.worktodo_create_workspace(text) is
  'Creator-only controlled creation of a shared WorkTodo workspace; defaults remain shared and non-deletable.';
comment on function public.worktodo_create_task(text, text, text, text, uuid) is
  'Authenticated WorkTodo owner task creation with optional active WorkTodo workspace selection.';
comment on function public.worktodo_update_task(uuid, jsonb) is
  'Authenticated WorkTodo owner update path; status and active WorkTodo workspace are explicit controlled fields.';

notify pgrst, 'reload schema';

commit;
