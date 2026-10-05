-- Universal Board Contract completion
--
-- The first Universal Board migration added the registry, immutable instance
-- columns, additive read policies, and the initial compatibility backfill.
-- This migration completes the minimum write contract without touching
-- existing business rows.  Legacy application_scope values remain readable
-- compatibility metadata; new generic-board rows use a registry instance and
-- a NULL application_scope.

begin;

alter table public.board_tasks
  drop constraint if exists board_tasks_application_scope_ck;
alter table public.board_tasks
  add constraint board_tasks_application_scope_ck
  check (application_scope is null or application_scope in ('ai_board', 'worktodo'));

alter table public.board_workspaces
  drop constraint if exists board_workspaces_application_scope_ck;
alter table public.board_workspaces
  add constraint board_workspaces_application_scope_ck
  check (application_scope is null or application_scope in ('ai_board', 'worktodo'));

-- Work-code allocation is now registry-aware.  The compatibility branches
-- preserve the historical TASK/WLTK behavior for rows that still use the
-- legacy application_scope field.
create or replace function public.allocate_board_task_work_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_next integer;
begin
  if new.board_instance_id is not null then
    select upper(task_code_prefix)
      into v_prefix
    from public.board_instances
    where id = new.board_instance_id
      and active = true;
    if v_prefix is null then
      raise exception using errcode = '23503', message = 'Active board instance is required';
    end if;

    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code.instance:' || new.board_instance_id::text));
      update public.board_instances
      set next_task_number = next_task_number + 1,
          updated_at = now()
      where id = new.board_instance_id
      returning next_task_number into v_next;
      new.work_code := v_prefix || '-' || lpad(v_next::text, 3, '0');
    elsif new.work_code !~ ('^' || v_prefix || '-[0-9]{3,}$') then
      raise exception using errcode = '22023',
        message = format('Board work_code must use canonical %s-NNN format', v_prefix);
    end if;
    return new;
  end if;

  if new.application_scope = 'worktodo' then
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code.worktodo'));
      select nextval('public.worktodo_wltk_seq') into v_next;
      new.work_code := 'WLTK-' || lpad(v_next::text, 3, '0');
    elsif new.work_code !~ '^WLTK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'WorkTodo work_code must use canonical WLTK-NNN format';
    end if;
  else
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code.ai_board'));
      select coalesce(max((substring(work_code from 'TASK-([0-9]+)'))::int), 0) + 1
        into v_next
      from public.board_tasks
      where application_scope = 'ai_board'
        and work_code ~ '^TASK-[0-9]+$';
      new.work_code := 'TASK-' || lpad(v_next::text, 3, '0');
    elsif new.work_code !~ '^TASK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'AI Board work_code must use canonical TASK-NNN format';
    end if;
  end if;
  return new;
end;
$$;

-- The registry is the authorization source for generic rows.  The two
-- legacy scope branches intentionally retain the existing engineering/owner
-- rules so old WorkTodo and AI Board writes remain compatible.
create or replace function public.enforce_board_task_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_instance public.board_instances;
begin
  if new.board_instance_id is null then
    raise exception using errcode = '23502', message = 'board_instance_id is required';
  end if;

  select * into v_instance
  from public.board_instances
  where id = new.board_instance_id
    and active = true;
  if not found then
    raise exception using errcode = '23503', message = 'Active board instance is required';
  end if;

  if tg_op = 'INSERT' then
    if new.application_scope = 'worktodo' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif new.application_scope = 'ai_board' then
      if new.owner_uuid is not null then
        raise exception using errcode = '42501', message = 'AI Board task owner must be null';
      end if;
    elsif v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
    end if;
    return new;
  end if;

  if old.board_instance_id is distinct from new.board_instance_id then
    raise exception using errcode = '22023', message = 'board_instance_id is immutable';
  end if;
  if old.application_scope is distinct from new.application_scope
     or old.owner_uuid is distinct from new.owner_uuid then
    raise exception using errcode = '22023', message = 'Task board identity is immutable';
  end if;

  if tg_op = 'DELETE' then
    if old.application_scope = 'worktodo' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif old.application_scope is null and v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif old.application_scope is null
      and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
    end if;
    return old;
  end if;

  if new.application_scope = 'worktodo'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'owner'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'Board owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'engineering'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'Engineering board authorization is required';
  end if;
  return new;
end;
$$;

-- Existing AI Board create contract: preserve its signature and checklist
-- initialization, while assigning the established AI Board instance.
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
    usage_scenario, priority, status, assignee, workspace_id,
    created_by, created_at, updated_at
  ) values (
    instance_row.id, 'ai_board', null, trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''), 'ready', 'Co',
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

create or replace function public.board_create_workspace(p_name text)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  name_value text := btrim(coalesce(p_name, ''));
  instance_row public.board_instances;
  next_order integer;
  saved_workspace public.board_workspaces;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if length(name_value) = 0 then
    raise exception using errcode = '22023', message = 'Workspace name is required';
  end if;
  select * into instance_row from public.board_instances
  where legacy_application_scope = 'ai_board' and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'AI Board registry is unavailable';
  end if;
  select coalesce(max(sort_order), 0) + 10 into next_order
  from public.board_workspaces where board_instance_id = instance_row.id and active = true;
  insert into public.board_workspaces (
    board_instance_id, application_scope, owner_uuid, name, sort_order, active,
    created_by, updated_by, created_at, updated_at
  ) values (
    instance_row.id, 'ai_board', null, name_value, next_order, true,
    auth.uid(), auth.uid(), now(), now()
  ) returning * into saved_workspace;
  return saved_workspace;
end;
$$;

-- Existing WorkTodo create contracts retain their public signatures and owner
-- semantics; only the registry foreign key is added to their inserts.
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
as $$
declare
  v_user uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'not_started')));
  v_workspace_id uuid;
  v_workspace_key text;
  v_instance public.board_instances;
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
  select * into v_instance from public.board_instances
  where legacy_application_scope = 'worktodo' and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'WorkTodo registry is unavailable';
  end if;
  if p_workspace_id is null then
    select id into v_workspace_id from public.board_workspaces
    where board_instance_id = v_instance.id and application_scope = 'worktodo'
      and workspace_key = v_workspace_key and active = true;
  else
    select id into v_workspace_id from public.board_workspaces
    where id = p_workspace_id and board_instance_id = v_instance.id
      and application_scope = 'worktodo' and active = true;
  end if;
  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active WorkTodo workspace is unavailable';
  end if;
  insert into public.board_tasks (
    board_instance_id, application_scope, owner_uuid, title, summary, status,
    workspace_id, source_workspace, domain, usage_scenario, created_by, created_at, updated_at
  ) values (
    v_instance.id, 'worktodo', v_user, btrim(p_title),
    nullif(btrim(coalesce(p_summary, '')), ''), v_status, v_workspace_id,
    'worktodo', 'worktodo', nullif(btrim(coalesce(p_usage_scenario, '')), ''),
    v_user, now(), now()
  ) returning * into v_task;
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
$$;

create or replace function public.worktodo_create_workspace(p_name text)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  name_value text := btrim(coalesce(p_name, ''));
  workspace_id_value uuid := gen_random_uuid();
  workspace_key_value text := 'worktodo-custom-' || replace(workspace_id_value::text, '-', '');
  v_instance public.board_instances;
  sort_order_value integer;
  saved_workspace public.board_workspaces;
begin
  if v_user is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if length(name_value) = 0 or length(name_value) > 80 then
    raise exception using errcode = '22023', message = 'WorkTodo workspace name is invalid';
  end if;
  select * into v_instance from public.board_instances
  where legacy_application_scope = 'worktodo' and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'WorkTodo registry is unavailable';
  end if;
  select coalesce(max(sort_order), 0) + 10 into sort_order_value
  from public.board_workspaces where board_instance_id = v_instance.id and active = true;
  insert into public.board_workspaces (
    id, board_instance_id, workspace_key, name, sort_order, active,
    created_by, updated_by, application_scope, owner_uuid
  ) values (
    workspace_id_value, v_instance.id, workspace_key_value, name_value, sort_order_value, true,
    v_user, v_user, 'worktodo', null
  ) returning * into saved_workspace;
  return saved_workspace;
end;
$$;

-- Generic C / future-board creation.  The registry determines owner versus
-- engineering authorization and the prefix determines the human work code.
create or replace function public.board_instance_create_workspace(
  p_board_instance_id uuid,
  p_name text,
  p_workspace_key text default null
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  where id = p_board_instance_id and active = true;
  if not found then raise exception using errcode = 'P0002', message = 'Active board instance not found'; end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception using errcode = '22023', message = 'Workspace name is invalid';
  end if;
  v_key := nullif(btrim(coalesce(p_workspace_key, '')), '');
  if v_key is null then
    v_key := lower(v_instance.task_code_prefix) || '-custom-' || replace(gen_random_uuid()::text, '-', '');
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
  return v_row;
end;
$$;

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
as $$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_owner uuid;
  v_status text := lower(btrim(coalesce(p_status, 'not_started')));
  v_default_key text;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then raise exception using errcode = '22023', message = 'Task title is required'; end if;
  select * into v_instance from public.board_instances where id = p_board_instance_id and active = true;
  if not found then raise exception using errcode = 'P0002', message = 'Active board instance not found'; end if;
  v_default_key := lower(v_instance.task_code_prefix) || '-todo';
  if p_workspace_id is null then
    select * into v_workspace from public.board_workspaces
    where board_instance_id = p_board_instance_id and workspace_key = v_default_key and active = true
    order by sort_order limit 1;
  else
    select * into v_workspace from public.board_workspaces
    where id = p_workspace_id and board_instance_id = p_board_instance_id and active = true;
  end if;
  if not found then raise exception using errcode = 'P0002', message = 'Active board workspace is required'; end if;
  v_owner := case when v_instance.authorization_mode = 'owner' then v_user else null end;
  insert into public.board_tasks (
    board_instance_id, workspace_id, title, summary, status, usage_scenario,
    application_scope, owner_uuid, created_by
  ) values (
    p_board_instance_id, v_workspace.id, v_title, nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(nullif(v_status, ''), 'not_started'), nullif(btrim(coalesce(p_usage_scenario, '')), ''),
    null, v_owner, v_user
  ) returning * into v_row;
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
$$;

-- Generic workspace and task operations used by the C motherboard.  Each
-- operation resolves authorization through the immutable registry id.
create or replace function public.board_instance_rename_workspace(p_workspace_id uuid, p_name text)
returns public.board_workspaces
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.board_workspaces;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Authentication required'; end if;
  select * into v_row from public.board_workspaces where id=p_workspace_id and active=true for update;
  if not found or not public.board_instance_can_write(v_row.board_instance_id) then
    raise exception using errcode='42501', message='Board workspace write authorization is required';
  end if;
  if length(btrim(coalesce(p_name,'')))=0 or length(btrim(p_name))>80 then
    raise exception using errcode='22023', message='Workspace name is invalid';
  end if;
  update public.board_workspaces set name=btrim(p_name), updated_by=auth.uid(), updated_at=now()
  where id=p_workspace_id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.board_instance_reorder_workspaces(p_workspace_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public, pg_temp
as $$
declare v_instance uuid; v_id uuid; v_order integer:=10; v_count integer:=0;
begin
  if coalesce(array_length(p_workspace_ids,1),0)=0 then return jsonb_build_object('updated',0); end if;
  select board_instance_id into v_instance from public.board_workspaces where id=p_workspace_ids[1] and active=true;
  if v_instance is null or not public.board_instance_can_write(v_instance) then
    raise exception using errcode='42501', message='Board workspace write authorization is required';
  end if;
  foreach v_id in array p_workspace_ids loop
    if not exists(select 1 from public.board_workspaces where id=v_id and board_instance_id=v_instance and active=true) then
      raise exception using errcode='22023', message='Workspace list crosses board instances';
    end if;
    update public.board_workspaces set sort_order=v_order, updated_by=auth.uid(), updated_at=now() where id=v_id;
    v_order:=v_order+10; v_count:=v_count+1;
  end loop;
  return jsonb_build_object('updated',v_count,'board_instance_id',v_instance);
end; $$;

create or replace function public.board_instance_move_task_workspace(p_task_id uuid, p_workspace_id uuid, p_reason text default null)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$
declare v_task public.board_tasks; v_workspace public.board_workspaces; v_before jsonb;
begin
  select * into v_task from public.board_tasks where id=p_task_id for update;
  if not found or not public.board_task_can_write(p_task_id) then raise exception using errcode='42501', message='Board task write authorization is required'; end if;
  select * into v_workspace from public.board_workspaces where id=p_workspace_id and board_instance_id=v_task.board_instance_id and active=true;
  if not found then raise exception using errcode='22023', message='Target workspace is invalid'; end if;
  v_before:=to_jsonb(v_task);
  update public.board_tasks set workspace_id=p_workspace_id, updated_at=now() where id=p_task_id returning * into v_task;
  insert into public.engineering_activity_log(entity_type,entity_id,action,before_data,after_data,note,actor_id,actor_type,actor_label,activity_type)
  values('board_task',p_task_id::text,'task_workspace_moved',v_before,to_jsonb(v_task),nullif(btrim(coalesce(p_reason,'')),''),auth.uid(),'human','QJC','system_activity');
  return v_task;
end; $$;

-- Generic status/workspace transition used by the C motherboard and future
-- registered boards.  The registry prefix determines the canonical workspace
-- keys; no consumer-specific status RPC is introduced.
create or replace function public.board_instance_transition_task(
  p_task_id uuid,
  p_target_status text,
  p_target_assignee text default null,
  p_note text default null
)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$
declare
  v_task public.board_tasks;
  v_before jsonb;
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_status text := lower(regexp_replace(btrim(coalesce(p_target_status, '')), '[\\s_-]+', '_', 'g'));
  v_workspace_key text;
begin
  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode='42501', message='Board task write authorization is required';
  end if;
  if v_status = '' then
    raise exception using errcode='22023', message='Task status is required';
  end if;
  select * into v_instance from public.board_instances
  where id = v_task.board_instance_id and active = true;
  if not found then
    raise exception using errcode='P0002', message='Active board instance not found';
  end if;
  v_workspace_key := lower(v_instance.task_code_prefix) || case
    when v_status in ('ready','todo','backlog','inbox','not_started') then '-todo'
    when v_status in ('in_progress','inprogress','doing','progress') then '-in-progress'
    when v_status in ('vendor_reply','waiting_vendor','waiting_for_vendor') then '-vendor-reply'
    when v_status in ('qa','review','waiting_acceptance','acceptance') then '-qa'
    when v_status in ('done','completed','complete','finished') then '-completed'
    else null
  end;
  if v_workspace_key is null then
    raise exception using errcode='22023', message='Unsupported board task status';
  end if;
  select * into v_workspace from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and workspace_key = v_workspace_key
    and active = true;
  if not found then
    raise exception using errcode='P0002', message='Canonical status workspace is missing';
  end if;
  v_before := to_jsonb(v_task);
  update public.board_tasks
  set workspace_id = v_workspace.id,
      status = case
        when v_status in ('todo','backlog','inbox','not_started') then 'not_started'
        when v_status in ('inprogress','doing','progress') then 'in_progress'
        when v_status in ('waiting_vendor','waiting_for_vendor') then 'vendor_reply'
        when v_status in ('review','waiting_acceptance','acceptance') then 'qa'
        when v_status in ('completed','complete','finished') then 'done'
        else v_status
      end,
      assignee = coalesce(nullif(btrim(coalesce(p_target_assignee, '')), ''), assignee),
      updated_at = now()
  where id = p_task_id
  returning * into v_task;
  insert into public.engineering_activity_log(
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values(
    'board_task', p_task_id::text, 'task_status_changed', v_before,
    to_jsonb(v_task), nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid(), 'human', 'QJC', 'system_activity'
  );
  return v_task;
end; $$;

create or replace function public.board_instance_update_task_title(p_task_id uuid, p_title text)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_tasks; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  if length(btrim(coalesce(p_title,'')))=0 then raise exception using errcode='22023',message='Task title is required'; end if;
  update public.board_tasks set title=btrim(p_title),updated_at=now() where id=p_task_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_update_task_content(p_task_id uuid, p_summary text default null, p_usage_scenario text default null)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_tasks; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  update public.board_tasks set summary=nullif(btrim(coalesce(p_summary,'')),''),usage_scenario=nullif(btrim(coalesce(p_usage_scenario,'')),''),updated_at=now() where id=p_task_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_update_task_due_date(p_task_id uuid, p_due_date date)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_tasks; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  update public.board_tasks set due_date=p_due_date,updated_at=now() where id=p_task_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_set_agreement_schedule(p_task_id uuid, p_mode text, p_start_date date, p_end_date date)
returns public.board_tasks language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_tasks; v_mode text:=nullif(lower(btrim(coalesce(p_mode,''))),''); begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  if v_mode is not null and v_mode not in ('single','period') then raise exception using errcode='22023',message='Agreement mode is invalid'; end if;
  if v_mode='single' and (p_start_date is null or p_end_date is not null) then raise exception using errcode='22023',message='Single agreement date is invalid'; end if;
  if v_mode='period' and (p_start_date is null or p_end_date is null or p_end_date<p_start_date) then raise exception using errcode='22023',message='Agreement period is invalid'; end if;
  update public.board_tasks set agreement_mode=v_mode,agreement_start_date=case when v_mode is null then null else p_start_date end,agreement_end_date=case when v_mode='period' then p_end_date else null end,updated_at=now() where id=p_task_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_delete_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_task public.board_tasks; begin
  select * into v_task from public.board_tasks where id=p_task_id for update;
  if not found or not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  delete from public.board_tasks where id=p_task_id;
  return jsonb_build_object('task_id',p_task_id,'deleted',true);
end; $$;

-- Generic task checklist contract.
create or replace function public.board_instance_add_task_checklist_item(p_task_id uuid, p_label text, p_sort_order integer default 0)
returns public.board_task_checklist_items language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_checklist_items; v_user uuid:=auth.uid(); begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board task write authorization is required'; end if;
  if length(btrim(coalesce(p_label,'')))=0 then raise exception using errcode='22023',message='Checklist label is required'; end if;
  insert into public.board_task_checklist_items(task_id,label,sort_order,created_by,updated_by) values(p_task_id,btrim(p_label),greatest(coalesce(p_sort_order,0),0),v_user,v_user) returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_update_task_checklist_item(p_item_id uuid, p_label text, p_completed boolean, p_sort_order integer default 0)
returns public.board_task_checklist_items language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_checklist_items; v_task uuid; begin
  select task_id into v_task from public.board_task_checklist_items where id=p_item_id;
  if v_task is null or not public.board_task_can_write(v_task) then raise exception using errcode='42501',message='Board checklist write authorization is required'; end if;
  if length(btrim(coalesce(p_label,'')))=0 then raise exception using errcode='22023',message='Checklist label is required'; end if;
  update public.board_task_checklist_items set label=btrim(p_label),completed=coalesce(p_completed,false),sort_order=greatest(coalesce(p_sort_order,0),0),updated_by=auth.uid(),updated_at=now() where id=p_item_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_delete_task_checklist_item(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_task uuid; begin
  select task_id into v_task from public.board_task_checklist_items where id=p_item_id;
  if v_task is null or not public.board_task_can_write(v_task) then raise exception using errcode='42501',message='Board checklist write authorization is required'; end if;
  delete from public.board_task_checklist_items where id=p_item_id; return jsonb_build_object('item_id',p_item_id,'deleted',true);
end; $$;

create or replace function public.board_instance_create_governance_checklist_item(p_task_id uuid, p_checklist_type text, p_stage text, p_item_key text, p_label text, p_required boolean default true, p_sort_order integer default 0)
returns public.engineering_checklist_items language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.engineering_checklist_items; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board checklist write authorization is required'; end if;
  insert into public.engineering_checklist_items(task_id,checklist_type,stage,item_key,label,required,sort_order) values(p_task_id,p_checklist_type,p_stage,btrim(p_item_key),btrim(p_label),coalesce(p_required,true),greatest(coalesce(p_sort_order,0),0)) returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_update_governance_checklist_item(p_item_id uuid, p_state text, p_evidence_note text default null, p_evidence_ref text default null)
returns public.engineering_checklist_items language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.engineering_checklist_items; v_task uuid; begin
  select task_id into v_task from public.engineering_checklist_items where id=p_item_id;
  if v_task is null or not public.board_task_can_write(v_task) then raise exception using errcode='42501',message='Board checklist write authorization is required'; end if;
  update public.engineering_checklist_items set state=lower(btrim(p_state)),evidence_note=nullif(btrim(coalesce(p_evidence_note,'')),''),evidence_ref=nullif(btrim(coalesce(p_evidence_ref,'')),''),checked_by=case when lower(btrim(p_state))='not_verified' then null else auth.uid() end,checked_at=case when lower(btrim(p_state))='not_verified' then null else now() end,updated_at=now() where id=p_item_id returning * into v_row; return v_row;
end; $$;

-- Generic append-only Progress / Activity contract.
create or replace function public.board_instance_add_progress_note(p_task_id uuid, p_note text)
returns public.engineering_activity_log language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.engineering_activity_log; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board progress write authorization is required'; end if;
  if length(btrim(coalesce(p_note,'')))=0 then raise exception using errcode='22023',message='Progress note is required'; end if;
  insert into public.engineering_activity_log(entity_type,entity_id,action,note,actor_id,actor_type,actor_label,activity_type) values('board_task',p_task_id::text,'progress_note_created',btrim(p_note),auth.uid(),'human','QJC','human_progress_note') returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_edit_progress_note(p_activity_id bigint, p_note text)
returns public.engineering_activity_log language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_old public.engineering_activity_log; v_row public.engineering_activity_log; v_task uuid; begin
  select * into v_old from public.engineering_activity_log where id=p_activity_id and activity_type='human_progress_note' and action in ('progress_note_created','progress_note_edited') for update;
  if not found then raise exception using errcode='P0002',message='Editable Progress Note not found'; end if;
  v_task:=v_old.entity_id::uuid; if not public.board_task_can_write(v_task) then raise exception using errcode='42501',message='Board progress write authorization is required'; end if;
  if exists(select 1 from public.engineering_activity_log where revision_of=p_activity_id or tombstone_of=p_activity_id) then raise exception using errcode='55000',message='Progress Note already has a newer lifecycle event'; end if;
  if length(btrim(coalesce(p_note,'')))=0 then raise exception using errcode='22023',message='Progress note is required'; end if;
  insert into public.engineering_activity_log(entity_type,entity_id,action,before_data,after_data,note,actor_id,actor_type,actor_label,activity_type,revision_of) values('board_task',v_old.entity_id,'progress_note_edited',jsonb_build_object('activity_id',v_old.id,'note',v_old.note),jsonb_build_object('activity_id',v_old.id,'note',btrim(p_note)),btrim(p_note),auth.uid(),'human','QJC','human_progress_note',p_activity_id) returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_delete_progress_note(p_activity_id bigint)
returns public.engineering_activity_log language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_old public.engineering_activity_log; v_row public.engineering_activity_log; v_task uuid; begin
  select * into v_old from public.engineering_activity_log where id=p_activity_id and activity_type='human_progress_note' and action in ('progress_note_created','progress_note_edited') for update;
  if not found then raise exception using errcode='P0002',message='Deletable Progress Note not found'; end if;
  v_task:=v_old.entity_id::uuid; if not public.board_task_can_write(v_task) then raise exception using errcode='42501',message='Board progress write authorization is required'; end if;
  if exists(select 1 from public.engineering_activity_log where revision_of=p_activity_id or tombstone_of=p_activity_id) then raise exception using errcode='55000',message='Progress Note already has a newer lifecycle event'; end if;
  insert into public.engineering_activity_log(entity_type,entity_id,action,before_data,after_data,note,actor_id,actor_type,actor_label,activity_type,tombstone_of) values('board_task',v_old.entity_id,'progress_note_deleted',jsonb_build_object('activity_id',v_old.id,'note',v_old.note),jsonb_build_object('activity_id',v_old.id,'deleted',true),'Progress Note withdrawn through the universal append-only tombstone path',auth.uid(),'human','QJC','system_activity',p_activity_id) returning * into v_row; return v_row;
end; $$;

-- Generic attachment metadata lifecycle.  Storage operations remain in the
-- existing shared gateway and existing board-task-attachments bucket.
create or replace function public.board_instance_prepare_task_attachment(p_task_id uuid, p_filename text, p_mime_type text, p_byte_size bigint, p_activity_id bigint default null)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_attachments; v_id uuid:=gen_random_uuid(); v_name text:=btrim(coalesce(p_filename,'')); v_path text; begin
  if not public.board_task_can_write(p_task_id) then raise exception using errcode='42501',message='Board attachment write authorization is required'; end if;
  if length(v_name)=0 or p_byte_size<=0 or p_byte_size>26214400 then raise exception using errcode='22023',message='Attachment metadata is invalid'; end if;
  v_path:=p_task_id::text||'/'||v_id::text||'/'||regexp_replace(v_name,'[^A-Za-z0-9._-]+','_','g');
  insert into public.board_task_attachments(id,task_id,attachment_scope,filename,mime_type,byte_size,storage_bucket,storage_path,upload_status,created_by) values(v_id,p_task_id,'task',v_name,btrim(coalesce(p_mime_type,'application/octet-stream')),p_byte_size,'board-task-attachments',v_path,'uploading',auth.uid()) returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_prepare_progress_attachment(p_activity_id bigint, p_filename text, p_mime_type text, p_byte_size bigint)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_activity public.engineering_activity_log; v_row public.board_task_attachments; v_id uuid:=gen_random_uuid(); v_name text:=btrim(coalesce(p_filename,'')); v_path text; begin
  select * into v_activity from public.engineering_activity_log where id=p_activity_id and activity_type='human_progress_note';
  if not found or not public.board_task_can_write(v_activity.entity_id::uuid) then raise exception using errcode='42501',message='Board progress attachment authorization is required'; end if;
  if length(v_name)=0 or p_byte_size<=0 or p_byte_size>26214400 then raise exception using errcode='22023',message='Attachment metadata is invalid'; end if;
  v_path:=v_activity.entity_id||'/'||v_id::text||'/'||regexp_replace(v_name,'[^A-Za-z0-9._-]+','_','g');
  insert into public.board_task_attachments(id,task_id,activity_id,attachment_scope,filename,mime_type,byte_size,storage_bucket,storage_path,upload_status,created_by) values(v_id,v_activity.entity_id::uuid,p_activity_id,'progress_note',v_name,btrim(coalesce(p_mime_type,'application/octet-stream')),p_byte_size,'board-task-attachments',v_path,'uploading',auth.uid()) returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_complete_attachment(p_attachment_id uuid)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_attachments; begin
  select * into v_row from public.board_task_attachments where id=p_attachment_id for update;
  if not found or not public.board_task_can_write(v_row.task_id) then raise exception using errcode='42501',message='Board attachment write authorization is required'; end if;
  update public.board_task_attachments set upload_status='ready',completed_at=now() where id=p_attachment_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_request_attachment_delete(p_attachment_id uuid)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_attachments; begin
  select * into v_row from public.board_task_attachments where id=p_attachment_id and deletion_status='active' for update;
  if not found or not public.board_task_can_write(v_row.task_id) then raise exception using errcode='42501',message='Board attachment delete authorization is required'; end if;
  update public.board_task_attachments set deletion_status='deleting' where id=p_attachment_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_finalize_attachment_delete(p_attachment_id uuid)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_attachments; begin
  select * into v_row from public.board_task_attachments where id=p_attachment_id and deletion_status in ('active','deleting') for update;
  if not found or not public.board_task_can_write(v_row.task_id) then raise exception using errcode='42501',message='Board attachment delete authorization is required'; end if;
  update public.board_task_attachments set deletion_status='deleted',deleted_at=now(),deleted_by=auth.uid() where id=p_attachment_id returning * into v_row; return v_row;
end; $$;

create or replace function public.board_instance_cancel_attachment_delete(p_attachment_id uuid)
returns public.board_task_attachments language plpgsql security definer set search_path=public, pg_temp
as $$ declare v_row public.board_task_attachments; begin
  select * into v_row from public.board_task_attachments where id=p_attachment_id for update;
  if not found or not public.board_task_can_write(v_row.task_id) then raise exception using errcode='42501',message='Board attachment write authorization is required'; end if;
  update public.board_task_attachments set deletion_status='active' where id=p_attachment_id and deletion_status='deleting' returning * into v_row; return v_row;
end; $$;

-- Generic workspace delete is intentionally a soft deactivation of the
-- workspace classification.  Tasks and children remain in place.
create or replace function public.board_instance_delete_workspace(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public, pg_temp
as $$
declare v_workspace public.board_workspaces; v_target uuid; v_ids uuid[]; v_count integer:=0;
begin
  select * into v_workspace from public.board_workspaces where id=p_workspace_id and active=true for update;
  if not found or not public.board_instance_can_write(v_workspace.board_instance_id) then raise exception using errcode='42501',message='Board workspace delete authorization is required'; end if;
  if v_workspace.workspace_key = lower((select task_code_prefix from public.board_instances where id=v_workspace.board_instance_id))||'-todo' then raise exception using errcode='42501',message='Canonical default workspace cannot be deleted'; end if;
  select id into v_target from public.board_workspaces where board_instance_id=v_workspace.board_instance_id and workspace_key=lower((select task_code_prefix from public.board_instances where id=v_workspace.board_instance_id))||'-todo' and active=true;
  if v_target is null then raise exception using errcode='P0002',message='Canonical default workspace is missing'; end if;
  select array_agg(id order by created_at) into v_ids from public.board_tasks where workspace_id=p_workspace_id;
  update public.board_tasks set workspace_id=v_target,updated_at=now() where workspace_id=p_workspace_id;
  get diagnostics v_count = row_count;
  update public.board_workspaces set active=false,archived_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_workspace_id;
  return jsonb_build_object('workspace_id',p_workspace_id,'deleted',true,'moved_task_count',v_count,'moved_task_ids',coalesce(to_jsonb(v_ids),'[]'::jsonb));
end; $$;

-- Engineering checklist rows are a child of a generic board task too.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='engineering_checklist_items' and policyname='engineering_checklist_generic_board_task_select') then
    create policy engineering_checklist_generic_board_task_select on public.engineering_checklist_items for select to authenticated using (public.board_task_can_read(task_id));
  end if;
end $$;

-- Existing storage write policies are kept intact.  Add only the generic
-- instance path when an environment does not already have equivalent policy.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='board_task_attachment_storage_generic_insert') then
    create policy board_task_attachment_storage_generic_insert on storage.objects for insert to authenticated with check (bucket_id='board-task-attachments' and exists(select 1 from public.board_task_attachments a where a.storage_bucket=bucket_id and a.storage_path=name and public.board_task_can_write(a.task_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='board_task_attachment_storage_generic_update') then
    create policy board_task_attachment_storage_generic_update on storage.objects for update to authenticated using (bucket_id='board-task-attachments' and exists(select 1 from public.board_task_attachments a where a.storage_bucket=bucket_id and a.storage_path=name and public.board_task_can_write(a.task_id))) with check (bucket_id='board-task-attachments');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='board_task_attachment_storage_generic_delete') then
    create policy board_task_attachment_storage_generic_delete on storage.objects for delete to authenticated using (bucket_id='board-task-attachments' and exists(select 1 from public.board_task_attachments a where a.storage_bucket=bucket_id and a.storage_path=name and public.board_task_can_write(a.task_id)));
  end if;
end $$;

revoke all on function public.board_instance_create_workspace(uuid,text,text) from public;
revoke all on function public.board_instance_create_task(uuid,text,text,text,text,uuid) from public;
revoke all on function public.board_instance_rename_workspace(uuid,text) from public;
revoke all on function public.board_instance_reorder_workspaces(uuid[]) from public;
revoke all on function public.board_instance_move_task_workspace(uuid,uuid,text) from public;
revoke all on function public.board_instance_transition_task(uuid,text,text,text) from public;
revoke all on function public.board_instance_update_task_title(uuid,text) from public;
revoke all on function public.board_instance_update_task_content(uuid,text,text) from public;
revoke all on function public.board_instance_update_task_due_date(uuid,date) from public;
revoke all on function public.board_instance_set_agreement_schedule(uuid,text,date,date) from public;
revoke all on function public.board_instance_delete_task(uuid) from public;
revoke all on function public.board_instance_add_task_checklist_item(uuid,text,integer) from public;
revoke all on function public.board_instance_update_task_checklist_item(uuid,text,boolean,integer) from public;
revoke all on function public.board_instance_delete_task_checklist_item(uuid) from public;
revoke all on function public.board_instance_create_governance_checklist_item(uuid,text,text,text,text,boolean,integer) from public;
revoke all on function public.board_instance_update_governance_checklist_item(uuid,text,text,text) from public;
revoke all on function public.board_instance_add_progress_note(uuid,text) from public;
revoke all on function public.board_instance_edit_progress_note(bigint,text) from public;
revoke all on function public.board_instance_delete_progress_note(bigint) from public;
revoke all on function public.board_instance_prepare_task_attachment(uuid,text,text,bigint,bigint) from public;
revoke all on function public.board_instance_prepare_progress_attachment(bigint,text,text,bigint) from public;
revoke all on function public.board_instance_complete_attachment(uuid) from public;
revoke all on function public.board_instance_request_attachment_delete(uuid) from public;
revoke all on function public.board_instance_finalize_attachment_delete(uuid) from public;
revoke all on function public.board_instance_cancel_attachment_delete(uuid) from public;
revoke all on function public.board_instance_delete_workspace(uuid) from public;

grant execute on function public.board_instance_create_workspace(uuid,text,text) to authenticated;
grant execute on function public.board_instance_create_task(uuid,text,text,text,text,uuid) to authenticated;
grant execute on function public.board_instance_rename_workspace(uuid,text) to authenticated;
grant execute on function public.board_instance_reorder_workspaces(uuid[]) to authenticated;
grant execute on function public.board_instance_move_task_workspace(uuid,uuid,text) to authenticated;
grant execute on function public.board_instance_transition_task(uuid,text,text,text) to authenticated;
grant execute on function public.board_instance_update_task_title(uuid,text) to authenticated;
grant execute on function public.board_instance_update_task_content(uuid,text,text) to authenticated;
grant execute on function public.board_instance_update_task_due_date(uuid,date) to authenticated;
grant execute on function public.board_instance_set_agreement_schedule(uuid,text,date,date) to authenticated;
grant execute on function public.board_instance_delete_task(uuid) to authenticated;
grant execute on function public.board_instance_add_task_checklist_item(uuid,text,integer) to authenticated;
grant execute on function public.board_instance_update_task_checklist_item(uuid,text,boolean,integer) to authenticated;
grant execute on function public.board_instance_delete_task_checklist_item(uuid) to authenticated;
grant execute on function public.board_instance_create_governance_checklist_item(uuid,text,text,text,text,boolean,integer) to authenticated;
grant execute on function public.board_instance_update_governance_checklist_item(uuid,text,text,text) to authenticated;
grant execute on function public.board_instance_add_progress_note(uuid,text) to authenticated;
grant execute on function public.board_instance_edit_progress_note(bigint,text) to authenticated;
grant execute on function public.board_instance_delete_progress_note(bigint) to authenticated;
grant execute on function public.board_instance_prepare_task_attachment(uuid,text,text,bigint,bigint) to authenticated;
grant execute on function public.board_instance_prepare_progress_attachment(bigint,text,text,bigint) to authenticated;
grant execute on function public.board_instance_complete_attachment(uuid) to authenticated;
grant execute on function public.board_instance_request_attachment_delete(uuid) to authenticated;
grant execute on function public.board_instance_finalize_attachment_delete(uuid) to authenticated;
grant execute on function public.board_instance_cancel_attachment_delete(uuid) to authenticated;
grant execute on function public.board_instance_delete_workspace(uuid) to authenticated;

commit;
