-- Module C shared Workspace Delete: populated workspaces fail closed.
--
-- The approved Empty Workspace contract is preserved exactly: an empty active
-- workspace can be soft-deactivated without resolving a card destination.
-- A populated workspace must be moved through the canonical C movement
-- contract before deletion. This function intentionally does not perform a
-- direct board_tasks.workspace_id update.

begin;

create or replace function public.board_instance_delete_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
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

  -- Populated deletion is intentionally fail-closed. Cards must be moved
  -- through the canonical C movement contract before Workspace deletion.
  raise exception using
    errcode = '55000',
    message = 'Workspace 內仍有卡片，必須先移動／清空卡片，才能刪除 Workspace';
end;
$function$;

comment on function public.board_instance_delete_workspace(uuid) is
  'Module C shared Workspace Delete: empty rows soft-deactivate; populated rows fail closed and require cards to be moved or cleared through the canonical C movement contract first.';

revoke all on function public.board_instance_delete_workspace(uuid) from public, anon;
grant execute on function public.board_instance_delete_workspace(uuid) to authenticated;

commit;
