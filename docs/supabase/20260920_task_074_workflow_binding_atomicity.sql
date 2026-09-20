-- TASK-074 minimal workflow binding repair
--
-- Existing TASK-074 RPCs already move the canonical task through the
-- authoritative Module C workspaces.  They intentionally update the
-- lifecycle columns and workspace in one statement, but older callers do not
-- also populate the two workflow identity columns.  The existing invariant
-- correctly rejects that stale binding.  This migration keeps that invariant
-- fail-closed while using the same canonical resolver to complete an omitted
-- binding in the same BEFORE UPDATE/INSERT row mutation.
--
-- Explicit workflow identity is still validated, never trusted.  A caller
-- that supplies a wrong or partial binding continues to fail closed.

begin;

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

  -- Existing TASK-074 and canonical transition callers update the target
  -- workspace but leave the old binding columns untouched.  Treat that exact
  -- omission as a request to resolve the target workspace through the
  -- existing canonical resolver.  A caller that explicitly changes the
  -- binding is not repaired here; it is validated below and fails closed if
  -- it is not canonical.
  if tg_op = 'UPDATE' then
    if new.workflow_version_id is not distinct from old.workflow_version_id
       and new.current_workflow_step_id is not distinct from old.current_workflow_step_id
       and (
         new.workspace_id is distinct from old.workspace_id
         or old.workflow_version_id is null
       ) then
      v_bind_from_target_workspace := true;
    end if;
  elsif tg_op = 'INSERT'
        and new.workflow_version_id is null
        and new.current_workflow_step_id is null then
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
      raise exception using
        errcode = '55000',
        message = 'Module C published Workflow requires a canonical card binding';
    end if;
    new.workflow_version_id := v_expected.workflow_version_id;
    new.current_workflow_step_id := v_expected.current_workflow_step_id;
  end if;

  if (new.workflow_version_id is null) <> (new.current_workflow_step_id is null) then
    raise exception using
      errcode = '55000',
      message = 'Module C workflow binding is incomplete; card was not changed';
  end if;

  if new.workflow_version_id is null then
    if v_published then
      raise exception using
        errcode = '55000',
        message = 'Module C published Workflow requires a canonical card binding';
    end if;
    -- Workflow remains optional when no published workflow exists.
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
  'Module C invariant and canonical workflow binding: omitted target bindings are resolved atomically; explicit mismatches fail closed.';

revoke all on function public.enforce_module_c_workflow_invariant() from public, anon, authenticated, service_role;

commit;
