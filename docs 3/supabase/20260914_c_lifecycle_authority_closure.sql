-- TASK-064 / STEP 4: close the application-reachable v1 lifecycle writers.
--
-- The functions remain in the database as historical/rollback evidence.  Only
-- the service role retains execution for controlled maintenance; application
-- roles must use the instance-scoped C v2 workflow/lifecycle contracts.

revoke all on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text)
  to service_role;
comment on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) is
  'RETIRED application route. Historical evidence only; application roles must use Module C v2 workspace/lifecycle authority.';

revoke all on function public.board_c_reconcile_workspace_decision(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.board_c_reconcile_workspace_decision(uuid, uuid, text)
  to service_role;
comment on function public.board_c_reconcile_workspace_decision(uuid, uuid, text) is
  'RETIRED application writer. Historical evidence only; application roles must use board_c_reconcile_workspace_decision_v2.';
