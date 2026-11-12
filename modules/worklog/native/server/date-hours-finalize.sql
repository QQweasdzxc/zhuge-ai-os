-- Stage 3/3: existing public owner. Remove installation-only trigger capability.
BEGIN;
REVOKE ALL ON FUNCTION public.worklog_task_dates_changed() FROM taskflow_migrator;
COMMIT;
