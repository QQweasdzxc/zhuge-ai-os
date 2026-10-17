-- Additive TaskFlow-owned Run evidence. Native taskflow.issue remains the task SSOT.
-- This migration is applied only by the controlled TaskFlow migrator.
CREATE TABLE zhuge_ai_engineering_run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE RESTRICT,
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    task_identifier text NOT NULL CHECK (task_identifier ~ '^[A-Z0-9]{1,10}-[1-9][0-9]*$'),
    requested_by uuid NOT NULL,
    engineer text NOT NULL CHECK (engineer = 'co'),
    issue_revision bigint NOT NULL CHECK (issue_revision > 0),
    github_repo text NOT NULL CHECK (github_repo = 'QQweasdzxc/zhuge-ai-os'),
    idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{32}$'),
    state text NOT NULL DEFAULT 'approved' CHECK (state IN (
        'approved','dispatch_pending','provider_ack_pending','running','blocked',
        'review_pending','completed','failed','cancelled','expired'
    )),
    approval_expires_at timestamptz NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    provider_thread_id text,
    provider_receipt_id text,
    last_evidence_sha text CHECK (last_evidence_sha IS NULL OR last_evidence_sha ~ '^[a-f0-9]{40}$'),
    last_error_code text,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE zhuge_ai_engineering_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES zhuge_ai_engineering_run(id) ON DELETE RESTRICT,
    state text NOT NULL,
    event_kind text NOT NULL CHECK (event_kind IN (
        'pm_approved','approval_expired','dispatch_blocked','provider_pending','provider_ack',
        'progress','review','completed','failed','cancelled',
        'github_pr_updated','github_pr_merged'
    )),
    source_delivery_id text,
    github_sha text CHECK (github_sha IS NULL OR github_sha ~ '^[a-f0-9]{40}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- GitHub delivery receipt for pull_request events. A committed receipt is
-- distinct from a persisted mirror/link: failed processing remains retryable.
CREATE TABLE github_webhook_delivery (
    delivery_id text PRIMARY KEY CHECK (delivery_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
    event_type text NOT NULL CHECK (event_type = 'pull_request'),
    action text NOT NULL,
    repo_owner text NOT NULL,
    repo_name text NOT NULL,
    pr_number integer NOT NULL CHECK (pr_number > 0),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    processing_state text NOT NULL CHECK (processing_state IN ('received','processing','persisted','failed','ignored')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    mirror_rows integer NOT NULL DEFAULT 0 CHECK (mirror_rows >= 0),
    linked_issue_rows integer NOT NULL DEFAULT 0 CHECK (linked_issue_rows >= 0),
    last_error_code text,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep access local to TaskFlow's runtime identity. Do not grant shared roles.
REVOKE ALL ON TABLE zhuge_ai_engineering_run, zhuge_ai_engineering_event, github_webhook_delivery FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE zhuge_ai_engineering_run TO taskflow_runtime;
GRANT UPDATE (state, revision, updated_at) ON TABLE zhuge_ai_engineering_run TO taskflow_runtime;
GRANT SELECT, INSERT ON TABLE zhuge_ai_engineering_event TO taskflow_runtime;
GRANT SELECT, INSERT ON TABLE github_webhook_delivery TO taskflow_runtime;
GRANT UPDATE (processing_state, attempt_count, mirror_rows, linked_issue_rows,
              last_error_code, processed_at, updated_at)
    ON TABLE github_webhook_delivery TO taskflow_runtime;
