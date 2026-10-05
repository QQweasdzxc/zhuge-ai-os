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