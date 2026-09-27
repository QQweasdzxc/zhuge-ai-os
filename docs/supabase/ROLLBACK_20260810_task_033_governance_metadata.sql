-- TASK-033 rollback notes (execute only with explicit PM approval).
-- Do not run automatically: dropping metadata would destroy the new governance
-- contract and could orphan audit interpretation.
drop function if exists public.board_governance_action(uuid, text, uuid, text);
drop index if exists public.board_tasks_resolution_action_idx;
drop index if exists public.board_tasks_merged_into_idx;
drop index if exists public.board_tasks_linked_to_idx;
alter table public.board_tasks drop constraint if exists board_tasks_resolution_reason_check;
alter table public.board_tasks drop constraint if exists board_tasks_resolution_target_check;
alter table public.board_tasks drop constraint if exists board_tasks_resolved_by_fkey;
alter table public.board_tasks drop constraint if exists board_tasks_linked_to_fkey;
alter table public.board_tasks drop constraint if exists board_tasks_merged_into_fkey;
alter table public.board_tasks drop constraint if exists board_tasks_resolution_action_check;
alter table public.board_tasks
  drop column if exists resolved_by,
  drop column if exists resolved_at,
  drop column if exists resolution_reason,
  drop column if exists linked_to,
  drop column if exists merged_into,
  drop column if exists resolution_action;
