-- TASK-101 rollback gate — manual PM/DBA approval only.
--
-- The historical workflow definitions are immutable.  This rollback disables
-- application execution of the new restore RPC without deleting definitions or
-- workflow history.  Restoring an older function body requires the exact prior
-- approved migration/source checkpoint and is intentionally not guessed here.

begin;

revoke all on function public.board_c_workflow_restore_version(uuid, uuid, uuid, text)
  from public, anon, authenticated;

commit;
