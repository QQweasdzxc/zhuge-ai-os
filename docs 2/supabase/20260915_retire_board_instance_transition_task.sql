-- STEP 8 / Item 6: retire the generic instance transition application surface.
--
-- The historical function definition remains in the earlier universal board
-- contract migration.  Only the application Execute surface is closed here;
-- service_role remains available temporarily for explicitly controlled
-- maintenance evidence.  Formal C movement uses
-- board_c_reconcile_workspace_decision_v2.

begin;

revoke all on function public.board_instance_transition_task(
  uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.board_instance_transition_task(
  uuid, text, text, text
) to service_role;

comment on function public.board_instance_transition_task(
  uuid, text, text, text
) is
  'STEP 8 Item 6 retired application transition surface. Historical definition retained; service_role is temporarily limited to controlled maintenance. Formal C movement uses board_c_reconcile_workspace_decision_v2.';

commit;
