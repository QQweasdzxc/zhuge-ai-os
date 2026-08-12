-- TASK-021 approved minimal migration.
-- The existing board_transition_task() writes entity_type = 'board_task'.
-- No RPC, RLS, Auth, actor-token, or other schema behavior is changed.
alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type in ('knowledge', 'feature', 'work_item', 'qa', 'member', 'board_task'));
