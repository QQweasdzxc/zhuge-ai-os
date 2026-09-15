-- STEP 8 / Item 5: retire application authority for the historical
-- Module C legacy-card reconciliation bridge.
--
-- Keep the function definition and historical migration behavior intact as
-- evidence.  Only the application Execute surface is closed; service_role is
-- retained temporarily for explicitly controlled maintenance/migration work.
begin;

revoke all on function public.board_c_workflow_reconcile_legacy_card_v2(
  uuid, text, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.board_c_workflow_reconcile_legacy_card_v2(
  uuid, text, uuid, uuid, jsonb, text, text
) to service_role;

comment on function public.board_c_workflow_reconcile_legacy_card_v2(
  uuid, text, uuid, uuid, jsonb, text, text
) is
  'Historical/migration evidence only. Application Execute is retired; service_role is temporarily retained for explicitly controlled maintenance.';

commit;
