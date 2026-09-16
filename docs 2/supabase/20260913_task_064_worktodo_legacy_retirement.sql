-- TASK-064 final WorkTodo legacy retirement.
--
-- This is a reversible authority cutover.  Historical user_tasks,
-- work_journal_entries, legacy functions, and rollback evidence are retained.
-- Only the retired WorkTodo lifecycle trigger and callable legacy lifecycle
-- routes are disabled for the ordinary application roles.

begin;

alter table public.user_tasks
  disable trigger worktodo_completion_lifecycle_before_write;

revoke all on function public.worktodo_apply_completion_lifecycle()
  from public, anon, authenticated;
revoke all on function public.worktodo_reconcile_completion_lifecycle()
  from public, anon, authenticated;
revoke all on function public.board_reconcile_completion_lifecycle()
  from public, anon, authenticated;
revoke all on function public.board_reconcile_pm_acceptance_lifecycle(uuid, text)
  from public, anon, authenticated;

comment on function public.worktodo_apply_completion_lifecycle() is
  'TASK-064 retired legacy lifecycle trigger function. Retained for rollback/history; not a current WorkTodo authority.';
comment on function public.worktodo_reconcile_completion_lifecycle() is
  'TASK-064 retired legacy WorkTodo reconciler. Retained for rollback/history; not callable by application roles.';
comment on function public.board_reconcile_completion_lifecycle() is
  'TASK-064 retired global lifecycle route. Retained for rollback/history; not callable by application roles.';
comment on function public.board_reconcile_pm_acceptance_lifecycle(uuid, text) is
  'TASK-064 retired PM acceptance lifecycle route. Retained for rollback/history; not callable by application roles.';

commit;
