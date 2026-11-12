-- Future owner-confirmed TF deletes only. No UPDATE, backfill or event write.
BEGIN;
ALTER TABLE public.work_entries ADD COLUMN IF NOT EXISTS google_delete_requested_at timestamptz;
COMMENT ON COLUMN public.work_entries.google_delete_requested_at IS 'New TF owner-confirmed soft deletion requests removal of this entry exact bound Google event only. NULL historical deletes never cascade.';
COMMIT;
