-- Module C workspace reorder audit/readback closure.
-- Keep the existing board-instance RPC and sort_order SSOT; add a canonical,
-- append-only audit event visible only to members allowed to read that board.

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
  v_before_workspaces jsonb := '[]'::jsonb;
  v_after_workspaces jsonb := '[]'::jsonb;
  v_audit_id bigint;
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

  -- Serialize concurrent reorders of the current active set before taking the
  -- audit snapshot. sort_order remains the only ordering SSOT.
  perform workspace.id
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true
  order by workspace.id
  for update;

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

  if v_worktodo_count > 0 and v_worktodo_count <> v_expected_count then
    raise exception using errcode = '23514', message = 'Board workspace scope is inconsistent; ordering was not changed';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace.id,
        'workspace_key', workspace.workspace_key,
        'name', workspace.name,
        'sort_order', workspace.sort_order
      ) order by workspace.sort_order nulls last, workspace.created_at, workspace.id
    ),
    '[]'::jsonb
  )
    into v_before_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

  if v_worktodo_count > 0 then
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace.id,
        'workspace_key', workspace.workspace_key,
        'name', workspace.name,
        'sort_order', workspace.sort_order
      ) order by workspace.sort_order nulls last, workspace.created_at, workspace.id
    ),
    '[]'::jsonb
  )
    into v_after_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance
    and workspace.active = true;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type
  ) values (
    'board_instance',
    v_instance::text,
    'workspace_order_changed',
    jsonb_build_object('board_instance_id', v_instance, 'workspaces', v_before_workspaces),
    jsonb_build_object('board_instance_id', v_instance, 'workspace_ids', v_ordered_ids, 'workspaces', v_after_workspaces),
    'Module C Workspace Ordering Authority',
    auth.uid(),
    'human',
    'QJC',
    'system_activity'
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'updated', v_updated_count,
    'board_instance_id', v_instance,
    'workspace_ids', v_ordered_ids,
    'audit_id', v_audit_id
  );
end;
$function$;

revoke all on function public.board_instance_reorder_workspaces(uuid[])
  from public, anon, service_role;
grant execute on function public.board_instance_reorder_workspaces(uuid[])
  to authenticated;

comment on function public.board_instance_reorder_workspaces(uuid[]) is
  'Module C canonical full-order reorder for one authorized Board Instance; validates and normalizes sort_order, permits WorkTodo sort-only guarded updates, and appends one board_instance audit event.';

-- Preserve the existing activity visibility policy and add only a scoped read
-- path for board-instance ordering events. The canonical authorization
-- predicate covers both engineering and owner-mode boards.
drop policy if exists engineering_activity_board_instance_read
  on public.engineering_activity_log;
create policy engineering_activity_board_instance_read
on public.engineering_activity_log for select to authenticated
using (
  entity_type = 'board_instance'
  and case
    when entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.board_instance_can_read(entity_id::uuid)
    else false
  end
);

notify pgrst, 'reload schema';

commit;
