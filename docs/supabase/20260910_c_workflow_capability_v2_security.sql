-- Security correction for the additive Module C Workflow foundation.
-- Workflow writes remain available only through the authenticated canonical
-- RPCs; browser roles receive read-only table access.

begin;

revoke all on public.board_workflow_definitions from authenticated;
revoke all on public.board_instance_workflow_state from authenticated;
revoke all on public.board_workflow_steps from authenticated;
revoke all on public.board_workflow_transitions from authenticated;
revoke all on public.board_workflow_gates from authenticated;
revoke all on public.board_workflow_evidence_requirements from authenticated;
revoke all on public.board_workflow_adoptions from authenticated;
revoke all on public.board_workflow_step_mappings from authenticated;

grant select on public.board_workflow_definitions to authenticated;
grant select on public.board_instance_workflow_state to authenticated;
grant select on public.board_workflow_steps to authenticated;
grant select on public.board_workflow_transitions to authenticated;
grant select on public.board_workflow_gates to authenticated;
grant select on public.board_workflow_evidence_requirements to authenticated;
grant select on public.board_workflow_adoptions to authenticated;
grant select on public.board_workflow_step_mappings to authenticated;

commit;
