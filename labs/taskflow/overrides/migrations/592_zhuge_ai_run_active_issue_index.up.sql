CREATE UNIQUE INDEX zhuge_ai_run_active_issue
    ON zhuge_ai_engineering_run(workspace_id, issue_id)
    WHERE state IN ('approved','dispatch_pending','provider_ack_pending','running');
