-- Zhuge AI engineering run metadata ONLY; native taskflow.issue stays the task SSOT.
-- Migration to be applied by taskflow_migrator after approval, never through the shared Supabase schema.
CREATE TABLE zhuge_ai_engineering_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
 issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL,
 engineer text NOT NULL CHECK (engineer IN ('co','gem')),
 issue_revision bigint NOT NULL CHECK (issue_revision > 0),
 github_repo text NOT NULL CHECK (github_repo = 'QQweasdzxc/zhuge-ai-os'),
 github_pr integer NOT NULL CHECK (github_pr > 0),
 checkpoint_sha text NOT NULL CHECK (checkpoint_sha ~ '^[a-f0-9]{40}$'),
 idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{32}$'),
 state text NOT NULL DEFAULT 'approved' CHECK (state IN (
   'approved','claim_pending','provider_ack_pending','running','blocked',
   'review_pending','completed','failed','cancelled'
 )),
 approval_expires_at timestamptz NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 provider_thread_id text,
 provider_receipt_id text,
 last_evidence_sha text,
 last_error_code text,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 UNIQUE(workspace_id, issue_id, requested_by, idempotency_key)
);
-- One active cloud writer request per native TaskFlow issue.
CREATE UNIQUE INDEX zhuge_ai_run_active_issue
ON zhuge_ai_engineering_run(workspace_id, issue_id)
WHERE state IN ('approved','claim_pending','provider_ack_pending','running');
CREATE INDEX zhuge_ai_run_issue_history
ON zhuge_ai_engineering_run(workspace_id, issue_id, created_at DESC);

CREATE TABLE zhuge_ai_engineering_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES zhuge_ai_engineering_run(id) ON DELETE RESTRICT,
 state text NOT NULL,
 event_kind text NOT NULL CHECK (event_kind IN ('pm_approved','writer_claimed','provider_pending','provider_ack','provider_blocked','progress','review','completed','failed','cancelled')),
 github_sha text CHECK (github_sha IS NULL OR github_sha ~ '^[a-f0-9]{40}$'),
 evidence_ref text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zhuge_ai_event_run ON zhuge_ai_engineering_event(run_id, id ASC);
-- Runtime service account receives access through the existing schema/connection
-- identity, not Supabase public service-role or client-side access.
