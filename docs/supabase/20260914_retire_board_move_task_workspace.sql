-- STEP 8 Phase 2 / Item 2: retire the generic application movement writer.
--
-- Keep the function definition for historical/maintenance evidence.  Formal
-- C movement uses board_c_reconcile_workspace_decision_v2; service_role stays
-- available temporarily for maintenance policy review.

begin;

revoke all on function public.board_move_task_workspace(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.board_move_task_workspace(uuid, uuid, text)
  to service_role;

comment on function public.board_move_task_workspace(uuid, uuid, text) is
  'STEP 8 Item 2 retired application movement surface. Formal application roles must use board_c_reconcile_workspace_decision_v2; definition retained for historical/maintenance evidence.';

commit;
