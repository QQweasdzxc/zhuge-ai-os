-- Module C shared Create authority: resolve a selected workspace through the
-- Board Instance's published workflow before writing a new card.  This is an
-- additive contract repair: it changes no existing rows and keeps workflow
-- optional for C consumers without a published workflow.

begin;

create or replace function private.board_c_resolve_workflow_create_state(
  p_board_instance_id uuid,
  p_workspace_id uuid,
  p_workflow_version_id uuid default null
)
returns table (
  workflow_version_id uuid,
  current_workflow_step_id uuid,
  workflow_status text,
  workflow_assignee text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_step public.board_workflow_steps%rowtype;
  v_matching_steps integer;
  v_workflow_version_id uuid := p_workflow_version_id;
begin
  if p_board_instance_id is null or p_workspace_id is null then
    raise exception using
      errcode = '22023',
      message = 'Module C workflow context requires a Board Instance and workspace';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = p_board_instance_id
     and active = true
     and template_key = 'c';
  if not found then
    -- Non-C callers do not participate in this helper.  Their existing
    -- contracts remain unchanged.
    return;
  end if;

  if not exists (
    select 1
      from public.board_workspaces workspace
     where workspace.id = p_workspace_id
       and workspace.board_instance_id = p_board_instance_id
       and workspace.active = true
       and workspace.archived_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'Module C workspace is not active or does not belong to this Board Instance';
  end if;

  if v_workflow_version_id is null then
    select *
      into v_state
      from public.board_instance_workflow_state
     where board_instance_id = p_board_instance_id;

    if not found or v_state.published_workflow_version_id is null then
      -- Workflow is optional.  No published state means the caller uses the
      -- normal C non-workflow Create contract.
      return;
    end if;
    v_workflow_version_id := v_state.published_workflow_version_id;
  end if;

  select *
    into v_definition
    from public.board_workflow_definitions
   where id = v_workflow_version_id
     and board_instance_id = p_board_instance_id
     and status in ('published', 'retired');
  if not found
     or (p_workflow_version_id is null and v_definition.status <> 'published') then
    raise exception using
      errcode = '55000',
      message = 'Module C Published Workflow cannot be verified for this Board Instance';
  end if;

  select count(*)
    into v_matching_steps
    from public.board_workflow_steps step
   where step.workflow_version_id = v_definition.id
     and step.workspace_id = p_workspace_id;
  if v_matching_steps <> 1 then
    raise exception using
      errcode = '55000',
      message = 'Module C workspace does not have exactly one Workflow Step binding';
  end if;

  select *
    into v_step
    from public.board_workflow_steps step
   where step.workflow_version_id = v_definition.id
     and step.workspace_id = p_workspace_id;

  if nullif(btrim(coalesce(v_step.status_key, '')), '') is null then
    raise exception using
      errcode = '55000',
      message = 'Module C Workflow Step has no canonical status';
  end if;

  workflow_version_id := v_definition.id;
  current_workflow_step_id := v_step.id;
  workflow_status := lower(btrim(v_step.status_key));
  workflow_assignee := private.board_workflow_role_label(v_step.role_key);
  return next;
end;
$function$;

comment on function private.board_c_resolve_workflow_create_state(uuid, uuid, uuid) is
  'Module C shared Create resolver: Board Instance + selected workspace + published Workflow Step; no consumer inference.';

revoke all on function private.board_c_resolve_workflow_create_state(uuid, uuid, uuid) from public, anon, authenticated, service_role;

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
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
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

  -- A configured Workflow owns initial status/assignee.  With no published
  -- Workflow, keep the existing optional non-workflow Create semantics.
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

comment on function public.board_instance_create_task(uuid, text, text, text, text, uuid) is
  'Module C shared Create authority; configured Workflow initial state is resolved from the Board Instance and selected workspace.';

revoke all on function public.board_instance_create_task(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.board_instance_create_task(uuid, text, text, text, text, uuid) to authenticated;

create or replace function public.enforce_module_c_workflow_invariant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_expected record;
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

  if (new.workflow_version_id is null) <> (new.current_workflow_step_id is null) then
    raise exception using
      errcode = '55000',
      message = 'Module C workflow binding is incomplete; card was not changed';
  end if;

  if new.workflow_version_id is null then
    -- Workflow remains optional.  A published Workflow, however, must not
    -- be bypassed by a direct C insert/update with an unbound card.
    if exists (
      select 1
        from public.board_instance_workflow_state state
       where state.board_instance_id = new.board_instance_id
         and state.published_workflow_version_id is not null
    ) then
      select * into v_expected
        from private.board_c_resolve_workflow_create_state(
          new.board_instance_id,
          new.workspace_id,
          null
        );
      if not found then
        raise exception using
          errcode = '55000',
          message = 'Module C published Workflow requires a canonical card binding';
      end if;
      raise exception using
        errcode = '55000',
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
    raise exception using
      errcode = '55000',
      message = 'Module C Workflow state does not match the bound workspace; card was not changed';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_module_c_workflow_invariant() is
  'Module C generic workflow invariant; validates Published Workflow truth and never embeds Consumer lifecycle mappings.';

revoke all on function public.enforce_module_c_workflow_invariant() from public, anon, authenticated, service_role;

drop trigger if exists trg_ai_board_lifecycle_workspace_consistency on public.board_tasks;
drop trigger if exists trg_module_c_workflow_invariant on public.board_tasks;
create trigger trg_module_c_workflow_invariant
before insert or update of status, assignee, workspace_id, workflow_version_id, current_workflow_step_id on public.board_tasks
for each row
execute function public.enforce_module_c_workflow_invariant();

comment on trigger trg_module_c_workflow_invariant on public.board_tasks is
  'Module C shared invariant; workflow binding trigger runs first by trigger name, then this validates the canonical result.';

-- The former AI-only trigger is retained as historical rollback evidence but
-- has no runtime trigger and no application-role execute surface.
revoke all on function public.enforce_ai_board_lifecycle_workspace_consistency() from public, anon, authenticated, service_role;

commit;
