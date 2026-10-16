DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM zhuge_ai_engineering_run WHERE provider_dispatch_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM github_webhook_delivery WHERE event_type='issue_comment') THEN
        RAISE EXCEPTION 'Codex dispatch evidence exists; archive TaskFlow AI Run data before rollback';
    END IF;
END
$$;

REVOKE UPDATE (provider_dispatch_id, github_pr_number, github_dispatch_head_sha,
               github_dispatch_comment_id, github_dispatch_comment_url,
               provider_receipt_id, provider_thread_id, last_evidence_sha,
               result_summary, last_error_code)
    ON TABLE zhuge_ai_engineering_run FROM taskflow_runtime;

DROP INDEX zhuge_ai_run_github_dispatch_comment;
DROP INDEX zhuge_ai_run_provider_dispatch_id;

ALTER TABLE github_webhook_delivery
    DROP CONSTRAINT github_webhook_delivery_event_type_check,
    ADD CONSTRAINT github_webhook_delivery_event_type_check CHECK (event_type='pull_request');

ALTER TABLE zhuge_ai_engineering_run
    DROP CONSTRAINT zhuge_ai_run_pr_number_positive,
    DROP CONSTRAINT zhuge_ai_run_dispatch_sha_valid,
    DROP CONSTRAINT zhuge_ai_run_dispatch_url_bounded,
    DROP CONSTRAINT zhuge_ai_run_result_summary_bounded,
    DROP COLUMN provider_dispatch_id,
    DROP COLUMN github_pr_number,
    DROP COLUMN github_dispatch_head_sha,
    DROP COLUMN github_dispatch_comment_id,
    DROP COLUMN github_dispatch_comment_url,
    DROP COLUMN result_summary;
