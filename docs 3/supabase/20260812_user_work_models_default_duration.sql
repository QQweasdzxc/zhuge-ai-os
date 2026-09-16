-- Applied to the Zhuge AI OS Supabase project (lenpbbhwxyyfwgvjcozf).
-- One minimal schema extension: a per-work default duration used by WorkLog
-- suggestions. Existing work entries and authentication are unchanged.
ALTER TABLE public.user_work_models
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.user_work_models
  DROP CONSTRAINT IF EXISTS user_work_models_default_duration_minutes_check;

ALTER TABLE public.user_work_models
  ADD CONSTRAINT user_work_models_default_duration_minutes_check
  CHECK (default_duration_minutes BETWEEN 0 AND 1440);
