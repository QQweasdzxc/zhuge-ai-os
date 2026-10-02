-- Module C shared workspace reorder repair.
--
-- Keep one instance-scoped ordering authority for every C consumer. WorkTodo's
-- workspace trigger continues to reject uncontrolled writes; this RPC opens
-- only its transaction-local sort-only guard after full-list and authorization
-- validation, then restores the caller's previous guard value.

begin;

create or replace function public.board_instance_reorder_workspaces(
  p_workspace_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_instance uuid;
  v_expected_count integer;
  v_supplied_count integer := coalesce(array_length(p_workspace_ids, 1), 0);
  v_distinct_count integer;
  v_workspace_id uuid;
  v_order integer := 10;
  v_updated_count integer := 0;
  v_worktodo_count integer := 0;
  v_previous_worktodo_guard text;
  v_worktodo_guard_set boolean := false;
  v_ordered_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Board workspace write authorization is required';
  end if;
  if p_workspace_ids is null or v_supplied_count = 0 then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace exactly once';
  end if;

  select workspace.board_instance_id
    into v_instance
  from public.board_workspaces workspace
  where workspace.id = p_workspace_ids[1]
    and workspace.active = true;

  if not found or v_instance is null then
    raise exception using errcode = '22023', message = 'Workspace order contains an inactive or unknown workspace';
  end if;
  if not public.board_instance_can_write(v_instance) then
    raise exception using errcode = '42501', message = 'Board workspace write authorization is required';
  end if;

  select count(*)
    into v_expected_count
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

  select count(distinct supplied.id)
    into v_distinct_count
  from unnest(p_workspace_ids) as supplied(id);

  if v_supplied_count <> v_expected_count
     or v_distinct_count <> v_expected_count
     or exists (
       select 1
       from unnest(p_workspace_ids) as supplied(id)
       left join public.board_workspaces workspace
         on workspace.id = supplied.id
        and workspace.board_instance_id = v_instance
        and workspace.active = true
       where workspace.id is null
     ) then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace in this board exactly once';
  end if;

  select count(*)
    into v_worktodo_count
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true
    and workspace.application_scope = 'worktodo';

  if v_worktodo_count > 0 then
    if v_worktodo_count <> v_expected_count then
      raise exception using errcode = '23514', message = 'Board workspace scope is inconsistent; ordering was not changed';
    end if;
    v_previous_worktodo_guard := current_setting('zhuge.worktodo_workspace_write', true);
    perform set_config('zhuge.worktodo_workspace_write', '1', true);
    v_worktodo_guard_set := true;
  end if;

  foreach v_workspace_id in array p_workspace_ids loop
    update public.board_workspaces
    set sort_order = v_order,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_workspace_id
      and board_instance_id = v_instance
      and active = true;

    if not found then
      raise exception using errcode = '40001', message = 'Workspace changed during reorder; ordering was not saved';
    end if;

    v_order := v_order + 10;
    v_updated_count := v_updated_count + 1;
    v_ordered_ids := v_ordered_ids || jsonb_build_array(v_workspace_id);
  end loop;

  if v_worktodo_guard_set then
    perform set_config(
      'zhuge.worktodo_workspace_write',
      coalesce(v_previous_worktodo_guard, ''),
      true
    );
  end if;

  return jsonb_build_object(
    'updated', v_updated_count,
    'board_instance_id', v_instance,
    'workspace_ids', v_ordered_ids
  );
end;
$function$;

revoke all on function public.board_instance_reorder_workspaces(uuid[])
  from public, anon, service_role;
grant execute on function public.board_instance_reorder_workspaces(uuid[])
  to authenticated;

comment on function public.board_instance_reorder_workspaces(uuid[]) is
  'Module C canonical full-order reorder for one authorized Board Instance; WorkTodo sort-only updates use a transaction-local guarded trigger context.';

notify pgrst, 'reload schema';

commit;
