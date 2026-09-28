-- TASK-067: scope the existing AI Board workspace reorder contract to one board instance.
-- This repairs the validation boundary only; it does not create, delete, or
-- rewrite any workspace data outside the submitted instance.
create or replace function public.board_reorder_workspaces(
  p_workspace_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  supplied_count integer := coalesce(array_length(p_workspace_ids, 1), 0);
  distinct_count integer;
  board_instance_id_value uuid;
  workspace_id_value uuid;
  position_value integer := 0;
  ordered_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_ids is null or supplied_count = 0 then
    raise exception using errcode = '22023', message = 'Workspace order is required';
  end if;

  select board_instance_id
    into board_instance_id_value
  from public.board_workspaces
  where id = p_workspace_ids[1]
    and active = true;
  if board_instance_id_value is null then
    raise exception using errcode = '22023', message = 'Workspace order must start with an active workspace';
  end if;

  select count(*)
    into expected_count
  from public.board_workspaces
  where board_instance_id = board_instance_id_value
    and active = true;

  select count(distinct id)
    into distinct_count
  from unnest(p_workspace_ids) as supplied(id);

  if supplied_count <> expected_count
     or distinct_count <> expected_count
     or exists (
       select 1
       from unnest(p_workspace_ids) as supplied(id)
       left join public.board_workspaces workspace
         on workspace.id = supplied.id
        and workspace.board_instance_id = board_instance_id_value
       where workspace.id is null
          or workspace.active = false
     ) then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace in this board instance exactly once';
  end if;

  foreach workspace_id_value in array p_workspace_ids loop
    position_value := position_value + 10;
    update public.board_workspaces
    set sort_order = position_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = workspace_id_value
      and board_instance_id = board_instance_id_value;
    ordered_ids := ordered_ids || jsonb_build_array(workspace_id_value);
  end loop;

  return jsonb_build_object('success', true, 'workspace_ids', ordered_ids);
end;
$$;
