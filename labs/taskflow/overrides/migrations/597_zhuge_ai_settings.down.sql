-- Settings are user configuration, so rollback must not discard saved choices.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM zhuge_ai_issue_setting LIMIT 1)
       OR EXISTS (SELECT 1 FROM zhuge_ai_project_setting LIMIT 1) THEN
        RAISE EXCEPTION 'AI engineering settings exist: preserve or archive them before rollback';
    END IF;
END
$$;

DROP TABLE zhuge_ai_issue_setting;
DROP TABLE zhuge_ai_project_setting;
