-- TASK-064 / Step 3: close the unused Legacy -> C board migration writer.
--
-- No current formal runtime calls this route.  It can copy a legacy
-- user_tasks row into board_tasks, so retaining application Execute would
-- leave an alternate C-owned WorkTodo writer.  Keep the definition for
-- historical inspection/rollback, but close it to application roles.

begin;

revoke all on function public.worktodo_migrate_task(text)
  from public, anon, authenticated, service_role;

comment on function public.worktodo_migrate_task(text) is
  'TASK-064 Step 3: retired Legacy WorkTodo to C-board migration writer. No current formal caller; definition retained for historical inspection only and application Execute revoked.';

commit;
