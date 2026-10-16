-- Explicit rollback only; no runtime auto-drop. Refuse deletion if any evidence exists.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM zhuge_ai_engineering_event LIMIT 1)
    OR EXISTS(SELECT 1 FROM zhuge_ai_engineering_run LIMIT 1) THEN
   RAISE EXCEPTION 'Zhuge AI runs exist: explicit PM archival required before rollback';
 END IF;
END
$$;
DROP TABLE zhuge_ai_engineering_event;
DROP TABLE zhuge_ai_engineering_run;
