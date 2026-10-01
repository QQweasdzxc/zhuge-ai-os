-- TASK-18: close the retired WorkTodo-specific task-create authority.
--
-- Current WorkTodo creation must use the shared C
-- board_instance_create_task(uuid, text, text, text, text, uuid) contract.
-- The old function is retained for historical/rollback inspection, but no
-- application or service role may execute it.

begin;

revoke all on function public.worktodo_create_task(text, text, text, text, uuid)
  from public, anon, authenticated, service_role;

comment on function public.worktodo_create_task(text, text, text, text, uuid) is
  'TASK-18 retired WorkTodo-specific create route. Current WorkTodo creation uses board_instance_create_task; retained only for historical/owner-controlled rollback inspection and not callable by application roles.';

commit;
