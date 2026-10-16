-- Durable, opt-in handoff through GitHub's documented @codex comment workflow.
-- No provider API credentials or Codex result data are stored in webhook receipts.
ALTER TABLE zhuge_ai_engineering_run
    ADD COLUMN provider_dispatch_id uuid,
    ADD COLUMN github_pr_number integer,
    ADD COLUMN github_dispatch_head_sha text,
    ADD COLUMN github_dispatch_comment_id bigint,
    ADD COLUMN github_dispatch_comment_url text,
    ADD COLUMN result_summary text;

ALTER TABLE zhuge_ai_engineering_run
    ADD CONSTRAINT zhuge_ai_run_pr_number_positive
        CHECK (github_pr_number IS NULL OR github_pr_number > 0),
    ADD CONSTRAINT zhuge_ai_run_dispatch_sha_valid
        CHECK (github_dispatch_head_sha IS NULL OR github_dispatch_head_sha ~ '^[a-f0-9]{40}$'),
    ADD CONSTRAINT zhuge_ai_run_dispatch_url_bounded
        CHECK (github_dispatch_comment_url IS NULL OR length(github_dispatch_comment_url) <= 512),
    ADD CONSTRAINT zhuge_ai_run_result_summary_bounded
        CHECK (result_summary IS NULL OR length(result_summary) <= 4000);

CREATE UNIQUE INDEX zhuge_ai_run_provider_dispatch_id
    ON zhuge_ai_engineering_run(provider_dispatch_id)
    WHERE provider_dispatch_id IS NOT NULL;
CREATE UNIQUE INDEX zhuge_ai_run_github_dispatch_comment
    ON zhuge_ai_engineering_run(github_dispatch_comment_id)
    WHERE github_dispatch_comment_id IS NOT NULL;

ALTER TABLE github_webhook_delivery
    DROP CONSTRAINT github_webhook_delivery_event_type_check,
    ADD CONSTRAINT github_webhook_delivery_event_type_check
        CHECK (event_type IN ('pull_request', 'issue_comment'));

-- Column-scoped only: Runtime can persist the dispatch receipt and verified
-- provider output, but cannot rewrite task/run identity or approval authority.
GRANT UPDATE (provider_dispatch_id, github_pr_number, github_dispatch_head_sha,
              github_dispatch_comment_id, github_dispatch_comment_url,
              provider_receipt_id, provider_thread_id, last_evidence_sha,
              result_summary, last_error_code)
    ON TABLE zhuge_ai_engineering_run TO taskflow_runtime;
