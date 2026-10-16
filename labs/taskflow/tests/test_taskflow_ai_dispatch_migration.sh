#!/usr/bin/env bash
set -euo pipefail

: "${TASKFLOW_TEST_DATABASE_URL:?A disposable PostgreSQL URL is required}"
MIGRATION_DIR="${TASKFLOW_AI_MIGRATIONS:-$(dirname "$0")/../overrides/migrations}"

python3 - "$TASKFLOW_TEST_DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlparse

host = urlparse(sys.argv[1]).hostname
if host not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("migration test refuses non-loopback database hosts")
PY

psql "$TASKFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE taskflow_migrator LOGIN;
CREATE ROLE taskflow_runtime LOGIN;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
CREATE SCHEMA extensions;
CREATE SCHEMA lab_multica;
GRANT USAGE ON SCHEMA extensions TO taskflow_migrator, taskflow_runtime;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
ALTER ROLE taskflow_migrator SET search_path = taskflow, extensions;
ALTER ROLE taskflow_runtime SET search_path = taskflow, extensions;
CREATE TABLE public.migration_fence(id integer PRIMARY KEY);
CREATE TABLE lab_multica.migration_fence(id integer PRIMARY KEY);
SET ROLE taskflow_migrator;
CREATE TABLE taskflow.workspace(id uuid PRIMARY KEY);
CREATE TABLE taskflow.project(id uuid PRIMARY KEY);
CREATE TABLE taskflow.issue(id uuid PRIMARY KEY);
RESET ROLE;
SQL

MIGRATOR_URL="${TASKFLOW_TEST_DATABASE_URL/postgres@/taskflow_migrator@}"
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'migration smoke must use the actual taskflow_migrator login';
    END IF;
    IF current_schema() <> 'taskflow'
       OR current_schemas(false) <> ARRAY['taskflow', 'extensions']::name[] THEN
        RAISE EXCEPTION 'unexpected migrator search_path: %', current_schemas(false);
    END IF;
END
$$;
SQL

for migration in \
    591_zhuge_ai_engineering_run.up.sql \
    592_zhuge_ai_run_active_issue_index.up.sql \
    593_zhuge_ai_run_idempotency_index.up.sql \
    594_zhuge_ai_event_delivery_once_index.up.sql \
    595_zhuge_ai_run_issue_history_index.up.sql \
    596_zhuge_ai_event_run_index.up.sql \
    597_zhuge_ai_settings.up.sql \
    598_zhuge_ai_codex_dispatch.up.sql; do
    psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/$migration"
done

psql "$TASKFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO taskflow.workspace VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO taskflow.project VALUES ('00000000-0000-0000-0000-000000000002');
INSERT INTO taskflow.issue VALUES ('00000000-0000-0000-0000-000000000003');
DO $$
DECLARE owned_count integer;
BEGIN
    SELECT count(*) INTO owned_count
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='taskflow'
       AND c.relname IN ('zhuge_ai_engineering_run','zhuge_ai_engineering_event','github_webhook_delivery',
                         'zhuge_ai_project_setting','zhuge_ai_issue_setting')
       AND c.relowner='taskflow_migrator'::regrole;
    IF owned_count <> 5 THEN RAISE EXCEPTION 'migration tables are not migrator-owned'; END IF;
    IF NOT has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','SELECT')
       OR NOT has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','INSERT')
       OR has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','UPDATE')
       OR has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','DELETE')
       OR has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_event','UPDATE')
       OR has_table_privilege('taskflow_runtime','taskflow.github_webhook_delivery','DELETE') THEN
        RAISE EXCEPTION 'runtime table grants are incorrect';
    END IF;
    IF NOT has_column_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','state','UPDATE')
       OR NOT has_column_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','provider_thread_id','UPDATE')
       OR has_column_privilege('taskflow_runtime','taskflow.zhuge_ai_engineering_run','requested_by','UPDATE')
       OR NOT has_column_privilege('taskflow_runtime','taskflow.github_webhook_delivery','processing_state','UPDATE') THEN
        RAISE EXCEPTION 'runtime column-level update grants are incorrect';
    END IF;
    IF has_table_privilege('taskflow_runtime','public.migration_fence','SELECT')
       OR has_table_privilege('taskflow_runtime','lab_multica.migration_fence','INSERT') THEN
        RAISE EXCEPTION 'runtime can access a protected schema table';
    END IF;
    IF has_schema_privilege('taskflow_runtime','public','CREATE')
       OR has_schema_privilege('taskflow_runtime','lab_multica','CREATE') THEN
        RAISE EXCEPTION 'runtime can create in a protected schema';
    END IF;
    IF NOT has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_project_setting','SELECT')
       OR NOT has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_project_setting','INSERT')
       OR has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_project_setting','DELETE')
       OR NOT has_column_privilege('taskflow_runtime','taskflow.zhuge_ai_project_setting','enabled','UPDATE')
       OR has_column_privilege('taskflow_runtime','taskflow.zhuge_ai_project_setting','project_id','UPDATE')
       OR has_table_privilege('taskflow_runtime','taskflow.zhuge_ai_issue_setting','DELETE') THEN
        RAISE EXCEPTION 'AI settings runtime grants are incorrect';
    END IF;
END
$$;
SQL

RUNTIME_URL="${TASKFLOW_TEST_DATABASE_URL/postgres@/taskflow_runtime@}"
psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF session_user <> 'taskflow_runtime' OR current_user <> 'taskflow_runtime' THEN
        RAISE EXCEPTION 'runtime smoke must use the actual taskflow_runtime login';
    END IF;
    IF current_schemas(false) <> ARRAY['taskflow', 'extensions']::name[] THEN
        RAISE EXCEPTION 'unexpected runtime search_path: %', current_schemas(false);
    END IF;
END
$$;
INSERT INTO taskflow.zhuge_ai_engineering_run
    (workspace_id,issue_id,project_id,task_identifier,requested_by,engineer,issue_revision,
     github_repo,idempotency_key,state,approval_expires_at)
VALUES
    ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',
     '00000000-0000-0000-0000-000000000002','ZG-1','00000000-0000-0000-0000-000000000004',
     'co',1,'QQweasdzxc/zhuge-ai-os','0123456789abcdef0123456789abcdef','approved',now()+interval '5 minutes');
INSERT INTO taskflow.zhuge_ai_engineering_run
    (workspace_id,issue_id,project_id,task_identifier,requested_by,engineer,issue_revision,
     github_repo,idempotency_key,state,approval_expires_at)
VALUES
    ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',
     '00000000-0000-0000-0000-000000000002','ZG-1','00000000-0000-0000-0000-000000000004',
     'co',1,'QQweasdzxc/zhuge-ai-os','fedcba9876543210fedcba9876543210','approved',now()+interval '5 minutes')
ON CONFLICT DO NOTHING;
INSERT INTO taskflow.zhuge_ai_engineering_run
    (workspace_id,issue_id,project_id,task_identifier,requested_by,engineer,issue_revision,
     github_repo,idempotency_key,state,approval_expires_at)
VALUES
    ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',
     '00000000-0000-0000-0000-000000000002','ZG-1','00000000-0000-0000-0000-000000000004',
     'co',1,'QQweasdzxc/zhuge-ai-os','0123456789abcdef0123456789abcdef','approved',now()+interval '5 minutes')
ON CONFLICT DO NOTHING;
UPDATE taskflow.zhuge_ai_engineering_run
   SET state='dispatch_pending',provider_dispatch_id='00000000-0000-0000-0000-000000000005',
       github_pr_number=60,github_dispatch_head_sha=repeat('a',40)
 WHERE id=(SELECT id FROM taskflow.zhuge_ai_engineering_run ORDER BY created_at LIMIT 1);
UPDATE taskflow.zhuge_ai_engineering_run
   SET state='provider_ack_pending',github_dispatch_comment_id=6188874242,
       github_dispatch_comment_url='https://github.com/QQweasdzxc/zhuge-ai-os/pull/60#issuecomment-6188874242'
 WHERE provider_dispatch_id='00000000-0000-0000-0000-000000000005';
UPDATE taskflow.zhuge_ai_engineering_run
   SET state='running',provider_thread_id='00000000-0000-0000-0000-000000000006'
 WHERE provider_dispatch_id='00000000-0000-0000-0000-000000000005';
UPDATE taskflow.zhuge_ai_engineering_run
   SET state='review_pending',last_evidence_sha=repeat('b',40),result_summary='Isolated result verified'
 WHERE provider_dispatch_id='00000000-0000-0000-0000-000000000005';
DO $$
DECLARE run_count integer; v_run_id uuid;
BEGIN
    SELECT count(*) INTO run_count FROM taskflow.zhuge_ai_engineering_run;
    IF run_count <> 1 THEN RAISE EXCEPTION 'active Run or idempotency unique guard failed'; END IF;
    SELECT r.id INTO v_run_id FROM taskflow.zhuge_ai_engineering_run AS r LIMIT 1;
    INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind,source_delivery_id,github_sha)
    VALUES(v_run_id,'approved','github_pr_updated','2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42',repeat('a',40))
    ON CONFLICT (run_id,source_delivery_id) WHERE source_delivery_id IS NOT NULL DO NOTHING;
    INSERT INTO taskflow.zhuge_ai_engineering_event(run_id,state,event_kind,source_delivery_id,github_sha)
    VALUES(v_run_id,'approved','github_pr_updated','2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42',repeat('a',40))
    ON CONFLICT (run_id,source_delivery_id) WHERE source_delivery_id IS NOT NULL DO NOTHING;
    IF (SELECT count(*) FROM taskflow.zhuge_ai_engineering_event AS e WHERE e.run_id=v_run_id) <> 1 THEN
       RAISE EXCEPTION 'duplicate GitHub delivery created duplicate Run events';
    END IF;
    INSERT INTO taskflow.github_webhook_delivery
        (delivery_id,event_type,action,repo_owner,repo_name,pr_number,payload_sha256,processing_state,mirror_rows,linked_issue_rows)
    VALUES ('2f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42','pull_request','opened','QQweasdzxc',
        'zhuge-ai-os',1,repeat('b',64),'persisted',1,1);
    INSERT INTO taskflow.github_webhook_delivery
        (delivery_id,event_type,action,repo_owner,repo_name,pr_number,payload_sha256,processing_state,mirror_rows,linked_issue_rows)
    VALUES ('3f7d9c65-9a5f-4a22-bf8c-0fbb4f61cd42','issue_comment','created','QQweasdzxc',
        'zhuge-ai-os',60,repeat('c',64),'persisted',1,1);
    INSERT INTO taskflow.zhuge_ai_project_setting(workspace_id,project_id,enabled,updated_by)
    VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true,
            '00000000-0000-0000-0000-000000000004');
    INSERT INTO taskflow.zhuge_ai_issue_setting(workspace_id,issue_id,enabled,engineer,updated_by)
    VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',true,'co',
            '00000000-0000-0000-0000-000000000004');
    UPDATE taskflow.zhuge_ai_issue_setting SET engineer='gem'
      WHERE workspace_id='00000000-0000-0000-0000-000000000001'
        AND issue_id='00000000-0000-0000-0000-000000000003';
END
$$;
SQL

if psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -c "UPDATE taskflow.zhuge_ai_issue_setting SET engineer='unknown'" \
    >/dev/null 2>/dev/null; then
    echo "unsupported AI engineer value was accepted" >&2
    exit 1
fi

psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -Atc \
    "SELECT enabled::text || ':' || engineer FROM taskflow.zhuge_ai_issue_setting" | grep -qx 'true:gem'

if psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/597_zhuge_ai_settings.down.sql" \
    >/dev/null 2>/dev/null; then
    echo "settings rollback guard unexpectedly allowed dropping saved settings" >&2
    exit 1
fi

if psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/598_zhuge_ai_codex_dispatch.down.sql" \
    >/dev/null 2>/dev/null; then
    echo "Codex rollback guard unexpectedly allowed dropping dispatch evidence" >&2
    exit 1
fi

if psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/596_zhuge_ai_event_run_index.down.sql" \
    >/dev/null 2>/dev/null; then
    echo "rollback guard unexpectedly allowed dropping indexes while Run evidence exists" >&2
    exit 1
fi
psql "$TASKFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
    "SELECT CASE WHEN to_regclass('taskflow.zhuge_ai_event_run') IS NOT NULL THEN 'rollback-guard-pass' ELSE 'rollback-guard-fail' END" \
    | grep -Fx rollback-guard-pass
echo "TaskFlow AI migration integration: PASS (isolated PostgreSQL, migrator install, runtime ACL, idempotency, settings persistence, rollback guard)"
