CREATE INDEX zhuge_ai_run_issue_history
    ON zhuge_ai_engineering_run(workspace_id, issue_id, created_at DESC);
