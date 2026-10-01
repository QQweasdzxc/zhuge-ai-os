-- STEP 8 Phase 2 / Item 1: retire the direct instance movement surface.
--
-- The function definition is retained for historical/maintenance evidence.
-- Formal application movement uses the authenticated Module C v2 decision
-- contract, which owns workflow, completion, audit, and idempotency behavior.

begin;

revoke all on function public.board_instance_move_task_workspace(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.board_instance_move_task_workspace(uuid, uuid, text)
  to service_role;

comment on function public.board_instance_move_task_workspace(uuid, uuid, text) is
  'STEP 8 Item 1 retired direct instance movement surface. Formal application roles must use board_c_reconcile_workspace_decision_v2; definition retained for historical/maintenance evidence.';

commit;
