-- TASK-011 / Template operation parity.
--
-- AI Board remains the only C presentation Golden Master.  WorkTodo uses the
-- same shared Runtime, but its system workspaces need their own controlled
-- Cloud write path because the original scope guard intentionally rejected
-- generic AI Board workspace RPCs.

begin;

create or replace function public.enforce_worktodo_workspace_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and old.application_scope = 'worktodo' then
    raise exception using errcode = '42501', message = 'WorkTodo system workspaces are not deletable';
  end if;

  if tg_op = 'UPDATE' and old.application_scope = 'worktodo' then
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

create or replace function public.worktodo_rename_workspace(
  p_workspace_id uuid,
  p_name text
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  name_value text := btrim(coalesce(p_name, ''));
  saved_workspace public.board_workspaces;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or length(name_value) = 0 then
    raise exception using errcode = '22023', message = 'WorkTodo workspace id and name are required';
  end if;

  perform set_config('zhuge.worktodo_workspace_write', '1', true);
  update public.board_workspaces
  set name = name_value,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_workspace_id
    and application_scope = 'worktodo'
    and active = true
  returning * into saved_workspace;

  if not found then
    raise exception using errcode = 'P0002', message = 'Active WorkTodo workspace not found';
  end if;
  return saved_workspace;
end;
$function$;

create or replace function public.worktodo_reorder_workspaces(
  p_workspace_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  expected_count integer;
  supplied_count integer := coalesce(array_length(p_workspace_ids, 1), 0);
  distinct_count integer;
  workspace_id_value uuid;
  position_value integer := 0;
  ordered_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_ids is null or supplied_count = 0 then
    raise exception using errcode = '22023', message = 'WorkTodo workspace order is required';
  end if;

  select count(*) into expected_count
  from public.board_workspaces
  where active = true and application_scope = 'worktodo';

  select count(distinct id) into distinct_count
  from unnest(p_workspace_ids) as supplied(id);

  if supplied_count <> expected_count or distinct_count <> expected_count
     or exists (
       select 1
       from unnest(p_workspace_ids) as supplied(id)
       left join public.board_workspaces workspace
         on workspace.id = supplied.id
        and workspace.active = true
        and workspace.application_scope = 'worktodo'
       where workspace.id is null
     ) then
    raise exception using errcode = '22023', message = 'WorkTodo workspace order must include every active WorkTodo workspace exactly once';
  end if;

  perform set_config('zhuge.worktodo_workspace_write', '1', true);
  foreach workspace_id_value in array p_workspace_ids loop
    position_value := position_value + 10;
    update public.board_workspaces
    set sort_order = position_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = workspace_id_value
      and active = true
      and application_scope = 'worktodo';
    ordered_ids := ordered_ids || jsonb_build_array(workspace_id_value);
  end loop;

  return jsonb_build_object('success', true, 'workspace_ids', ordered_ids);
end;
$function$;

revoke all on function public.worktodo_rename_workspace(uuid, text) from public, anon;
grant execute on function public.worktodo_rename_workspace(uuid, text) to authenticated;
revoke all on function public.worktodo_reorder_workspaces(uuid[]) from public, anon;
grant execute on function public.worktodo_reorder_workspaces(uuid[]) to authenticated;

comment on function public.worktodo_rename_workspace(uuid, text) is
  'Creator-only controlled rename for the shared WorkTodo system workspace set.';
comment on function public.worktodo_reorder_workspaces(uuid[]) is
  'Creator-only controlled reorder for the shared WorkTodo system workspace set.';

notify pgrst, 'reload schema';

commit;
