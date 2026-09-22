-- Module C Workflow audit compatibility correction.
-- The approved v2 Draft/Publish/Adoption RPCs audit their own canonical
-- resources.  Extend the legacy entity allow-list without rewriting rows or
-- changing the authorization boundary.

begin;

alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type = any (array[
    'knowledge'::text,
    'feature'::text,
    'work_item'::text,
    'qa'::text,
    'member'::text,
    'board_task'::text,
    'engineering_checklist_item'::text,
    'engineering_governance_authorization'::text,
    'engineering_artifact'::text,
    'board_workspace'::text,
    'board_instance'::text,
    'board_workflow_definition'::text,
    'board_workflow_adoption'::text
  ]));

commit;
