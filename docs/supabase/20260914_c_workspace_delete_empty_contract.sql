-- Module C shared Workspace Delete repair.
--
-- Empty Workspace deletion does not need a card destination.  Resolve the
-- Board Instance and card count first, then soft-deactivate an empty row
-- without inferring a default workspace from task_code_prefix.  The existing
-- populated-workspace path remains fail-closed until its target and Workflow
-- reconciliation contract receive a separate product decision.

begin;

create or replace function public.board_instance_delete_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_target uuid;
  v_ids uuid[];
  v_count integer := 0;
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
    update public.board_workspaces
       set active = false,
           archived_at = now(),
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_workspace_id;

    return jsonb_build_object(
      'workspace_id', p_workspace_id,
      'deleted', true,
      'moved_task_count', 0,
      'moved_task_ids', '[]'::jsonb,
      'target_workspace_id', null,
      'empty_workspace', true
    );
  end if;

  -- Populated deletion keeps the existing safe boundary.  It still requires
  -- an existing same-Instance target; its Workflow reconciliation contract is
  -- intentionally outside this approved empty-workspace repair.
  if v_workspace.workspace_key = lower((select task_code_prefix
                                          from public.board_instances
                                         where id = v_workspace.board_instance_id)) || '-todo' then
    raise exception using
      errcode = '42501',
      message = 'Canonical default workspace cannot be deleted';
  end if;

  select id
    into v_target
    from public.board_workspaces
   where board_instance_id = v_workspace.board_instance_id
     and workspace_key = lower((select task_code_prefix
                                   from public.board_instances
                                  where id = v_workspace.board_instance_id)) || '-todo'
     and active = true;

  if v_target is null then
    raise exception using
      errcode = 'P0002',
      message = 'Canonical default workspace is missing';
  end if;

  select array_agg(id order by created_at)
    into v_ids
    from public.board_tasks
   where workspace_id = p_workspace_id;

  update public.board_tasks
     set workspace_id = v_target,
         updated_at = now()
   where workspace_id = p_workspace_id;

  get diagnostics v_count = row_count;

  update public.board_workspaces
     set active = false,
         archived_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_workspace_id;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'deleted', true,
    'moved_task_count', v_count,
    'moved_task_ids', coalesce(to_jsonb(v_ids), '[]'::jsonb),
    'target_workspace_id', v_target,
    'empty_workspace', false
  );
end;
$function$;

comment on function public.board_instance_delete_workspace(uuid) is
  'Module C shared Workspace Delete: empty rows soft-deactivate without default inference; populated rows remain fail-closed pending a separate target and Workflow reconciliation contract.';

revoke all on function public.board_instance_delete_workspace(uuid) from public, anon;
grant execute on function public.board_instance_delete_workspace(uuid) to authenticated;

commit;
