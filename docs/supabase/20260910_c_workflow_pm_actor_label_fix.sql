-- Compatibility correction for the approved Module C Workflow contract.
-- PM is a formal V1/V2 role and must be representable in the shared audit
-- log.  This changes only the allowed audit label set; no rows are rewritten.

begin;

alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_actor_label_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_actor_label_check
  check (actor_label = any (array['QJC'::text, 'GPT'::text, 'Co'::text, 'PM'::text, 'System'::text, 'Legacy'::text]));

commit;
