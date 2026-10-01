-- TASK-021 approved minimal migration.
-- board_update_checklist_item() already writes an audit row with
-- entity_type = 'engineering_checklist_item'. The prior constraint allowed
-- board_task but not the existing checklist audit entity, causing the
-- checklist transaction to roll back. No RPC, RLS, Auth, or other schema
-- objects are changed here.

alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (
    entity_type = any (
      array[
        'knowledge'::text,
        'feature'::text,
        'work_item'::text,
        'qa'::text,
        'member'::text,
        'board_task'::text,
        'engineering_checklist_item'::text
      ]
    )
  );
