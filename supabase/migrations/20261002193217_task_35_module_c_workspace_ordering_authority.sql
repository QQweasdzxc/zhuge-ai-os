-- TASK-35 Module C Workspace Ordering Authority.
--
-- Keep sort_order and the existing board-instance audit/read contract as the
-- canonical persistence boundary. The ordering guard is transaction-local and
-- permits only sort_order plus update metadata for WorkTodo rows.
--
-- Source migration only in this Co round; do not apply to Cloud here.

begin;

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

create or replace function public.module_c_workspace_ordering_authority(
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
  v_previous_module_guard text;
  v_module_guard_set boolean := false;
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
    v_previous_module_guard := current_setting('zhuge.module_c_workspace_ordering', true);
    perform set_config('zhuge.module_c_workspace_ordering', '1', true);
    v_module_guard_set := true;
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

  if v_module_guard_set then
    perform set_config(
      'zhuge.module_c_workspace_ordering',
      coalesce(v_previous_module_guard, ''),
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

-- Keep the historical RPC names as thin compatibility wrappers. There is one
-- implementation, one complete-order validation path, one sort_order writer,
-- and one audit writer for every Module C consumer.
create or replace function public.board_instance_reorder_workspaces(p_workspace_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.module_c_workspace_ordering_authority(p_workspace_ids);
$function$;

create or replace function public.board_reorder_workspaces(p_workspace_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.module_c_workspace_ordering_authority(p_workspace_ids);
$function$;

revoke all on function public.module_c_workspace_ordering_authority(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.board_instance_reorder_workspaces(uuid[])
  from public, anon, service_role;
revoke all on function public.board_reorder_workspaces(uuid[])
  from public, anon, service_role;
grant execute on function public.board_instance_reorder_workspaces(uuid[])
  to authenticated;
grant execute on function public.board_reorder_workspaces(uuid[])
  to authenticated;

comment on function public.module_c_workspace_ordering_authority(uuid[]) is
  'Module C canonical full-order reorder authority; preserves sort_order SSOT, WorkTodo sort-only guard, board-instance authorization, and canonical audit.';

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
