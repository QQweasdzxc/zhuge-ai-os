ALTER TABLE public.user_work_models
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.user_work_models
  DROP CONSTRAINT IF EXISTS user_work_models_default_duration_minutes_check;

ALTER TABLE public.user_work_models
  ADD CONSTRAINT user_work_models_default_duration_minutes_check
  CHECK (default_duration_minutes BETWEEN 0 AND 1440);