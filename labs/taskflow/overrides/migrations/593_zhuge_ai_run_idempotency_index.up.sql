CREATE UNIQUE INDEX zhuge_ai_run_idempotency
    ON zhuge_ai_engineering_run(workspace_id, issue_id, requested_by, idempotency_key);
