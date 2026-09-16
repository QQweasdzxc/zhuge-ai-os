-- Module C Workflow v2 private-helper security hardening.
-- Private helpers are callable only from the canonical RPC/trigger paths;
-- browser roles must not execute them directly.

begin;

revoke all on function private.board_workflow_bind_new_task() from public, anon, authenticated;
revoke all on function private.board_workflow_role_label(text) from public, anon, authenticated;
revoke all on function private.board_workflow_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.board_workflow_validate(uuid) from public, anon, authenticated;

commit;
