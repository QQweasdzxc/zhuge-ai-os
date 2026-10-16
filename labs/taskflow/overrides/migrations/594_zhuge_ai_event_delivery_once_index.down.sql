DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM taskflow.zhuge_ai_engineering_run LIMIT 1)
       OR EXISTS (SELECT 1 FROM taskflow.zhuge_ai_engineering_event LIMIT 1)
       OR EXISTS (SELECT 1 FROM taskflow.github_webhook_delivery LIMIT 1) THEN
        RAISE EXCEPTION 'TaskFlow AI Run evidence exists; index rollback is refused';
    END IF;
END
$$;
DROP INDEX IF EXISTS zhuge_ai_event_delivery_once;
