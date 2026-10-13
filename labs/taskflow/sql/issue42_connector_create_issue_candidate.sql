-- Candidate only — do not apply to Production without a separate PM GO.
--
-- Purpose: a narrow, idempotent card-create operation for the trusted,
-- single-operator Supabase SQL Connector. It does not grant table DML to the
-- Connector role or any application role. The Connector already uses the
-- privileged `postgres` identity; that remains an explicit operator trust
-- boundary and is not an end-user identity proof.
--
-- Preconditions:
--   * TaskFlow schema and current Multica migrations are already installed.
--   * taskflow_runtime exists and remains the restricted API role.
--   * A target Project belongs to exactly one Workspace with exactly one
--     `owner` member. The sole owner is recorded as the human creator.
--   * The selected status key is active in that Workspace.
--
-- Native EventBus limitations are documented in docs/ISSUE_42... This
-- function creates the issue, number, creator subscription and activity row
-- in one DB transaction, but cannot emit in-process realtime/plugin/analytics
-- events or enforce Cloud entitlement limits.

BEGIN;

CREATE TABLE IF NOT EXISTS taskflow.sb_connector_issue_request (
    request_id UUID PRIMARY KEY,
    payload JSONB NOT NULL,
    issue_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE taskflow.sb_connector_issue_request IS
    'Idempotency ledger for trusted SB Connector TaskFlow issue creates; do not delete records while retries may occur.';

CREATE OR REPLACE FUNCTION taskflow.sb_connector_create_issue(
    p_request_id UUID,
    p_project_id UUID,
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_status TEXT DEFAULT 'todo',
    p_priority TEXT DEFAULT 'none',
    p_start_date DATE DEFAULT NULL,
    p_due_date DATE DEFAULT NULL
)
RETURNS TABLE (
    issue_id UUID,
    issue_number INTEGER,
    issue_identifier TEXT,
    workspace_id UUID,
    project_id UUID,
    status TEXT,
    revision BIGINT,
    replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, taskflow, extensions, pg_temp
AS $function$
DECLARE
    v_title TEXT := btrim(p_title);
    v_description TEXT := p_description;
    v_status TEXT := COALESCE(NULLIF(btrim(p_status), ''), 'todo');
    v_priority TEXT := COALESCE(NULLIF(btrim(p_priority), ''), 'none');
    v_workspace_id UUID;
    v_actor_id UUID;
    v_owner_count BIGINT;
    v_prefix TEXT;
    v_number INTEGER;
    v_position DOUBLE PRECISION;
    v_status_category TEXT;
    v_payload JSONB;
    v_saved_payload JSONB;
    v_saved_issue_id UUID;
    v_duplicate_id UUID;
BEGIN
    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_project_id IS NULL THEN
        RAISE EXCEPTION 'project_id is required' USING ERRCODE = '22023';
    END IF;
    IF v_title IS NULL OR v_title = '' THEN
        RAISE EXCEPTION 'title is required' USING ERRCODE = '22023';
    END IF;
    IF v_priority NOT IN ('urgent', 'high', 'medium', 'low', 'none') THEN
        RAISE EXCEPTION 'unsupported priority: %', v_priority USING ERRCODE = '22023';
    END IF;

    v_payload := pg_catalog.jsonb_build_object(
        'operation', 'create',
        'project_id', p_project_id,
        'title', v_title,
        'description', v_description,
        'status', v_status,
        'priority', v_priority,
        'start_date', p_start_date,
        'due_date', p_due_date
    );

    -- Serialize connector retries for the same idempotency key.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('taskflow.sb_connector_create_issue:' || p_request_id::TEXT, 0)
    );

    SELECT r.payload, r.issue_id
      INTO v_saved_payload, v_saved_issue_id
      FROM taskflow.sb_connector_issue_request AS r
     WHERE r.request_id = p_request_id;
    IF FOUND THEN
        IF v_saved_payload <> v_payload THEN
            RAISE EXCEPTION 'request_id was already used with a different payload' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY
        SELECT i.id, i.number, w.issue_prefix || '-' || i.number::TEXT,
               i.workspace_id, i.project_id, i.status, i.revision, TRUE
          FROM taskflow.issue AS i
          JOIN taskflow.workspace AS w ON w.id = i.workspace_id
         WHERE i.id = v_saved_issue_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'request_id was already consumed but the issue no longer exists';
        END IF;
        RETURN;
    END IF;

    SELECT p.workspace_id, w.issue_prefix
      INTO v_workspace_id, v_prefix
      FROM taskflow.project AS p
      JOIN taskflow.workspace AS w ON w.id = p.workspace_id
     WHERE p.id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'project not found';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_owner_count
      FROM taskflow.member AS m
     WHERE m.workspace_id = v_workspace_id
       AND m.role = 'owner';
    IF v_owner_count <> 1 THEN
        RAISE EXCEPTION 'workspace must have exactly one owner for connector attribution';
    END IF;
    SELECT m.user_id
      INTO v_actor_id
      FROM taskflow.member AS m
     WHERE m.workspace_id = v_workspace_id
       AND m.role = 'owner'
     LIMIT 1;

    SELECT s.category
      INTO v_status_category
      FROM taskflow.issue_status AS s
     WHERE s.workspace_id = v_workspace_id
       AND s.key = v_status
       AND s.archived_at IS NULL
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'status is not active in the target workspace: %', v_status;
    END IF;

    -- Serialize same-title connector requests and mirror the native active
    -- duplicate rule for this Project/no-parent create path. The native rule
    -- excludes terminal status keys and items still waiting in Triage. Reuse
    -- issueguard.lockKey so native API and Connector creates cannot pass the
    -- duplicate check concurrently.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'issue-active-duplicate|' || v_workspace_id::TEXT || '|' ||
            p_project_id::TEXT || '||' ||
            pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(v_title, '[[:space:]]+', ' ', 'g'))),
            0
        )
    );
    SELECT i.id
      INTO v_duplicate_id
      FROM taskflow.issue AS i
     WHERE i.workspace_id = v_workspace_id
       AND i.project_id = p_project_id
       AND i.parent_issue_id IS NULL
       AND i.triage_state IS NULL
       AND NOT (i.status = ANY (
           ARRAY(
               SELECT s.key
                 FROM taskflow.issue_status AS s
                WHERE s.workspace_id = v_workspace_id
                  AND s.category IN ('done', 'closed')
           )
       ))
       AND pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(i.title, '[[:space:]]+', ' ', 'g'))) =
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(v_title, '[[:space:]]+', ' ', 'g')))
     ORDER BY i.created_at ASC
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'active duplicate issue exists: %', v_duplicate_id USING ERRCODE = '23505';
    END IF;

    -- Native AllocateIssueNumber serializes on the Workspace row. This update
    -- preserves that monotonic allocator and rolls back if any later insert
    -- fails.
    UPDATE taskflow.workspace AS w
       SET issue_counter = w.issue_counter + 1
     WHERE w.id = v_workspace_id
     RETURNING w.issue_counter, w.issue_prefix INTO v_number, v_prefix;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace disappeared while allocating issue number';
    END IF;

    SELECT COALESCE(pg_catalog.min(i.position), 0) - 1
      INTO v_position
      FROM taskflow.issue AS i
     WHERE i.workspace_id = v_workspace_id
       AND i.status = v_status;

    INSERT INTO taskflow.issue (
        workspace_id, title, description, status, priority,
        assignee_type, assignee_id, creator_type, creator_id,
        parent_issue_id, position, start_date, due_date, number, project_id,
        stage, properties, last_activity_at, id
    ) VALUES (
        v_workspace_id, v_title, v_description, v_status, v_priority,
        NULL, NULL, 'member', v_actor_id,
        NULL, v_position, p_start_date, p_due_date, v_number, p_project_id,
        NULL, '{}'::JSONB, pg_catalog.now(), pg_catalog.gen_random_uuid()
    ) RETURNING id INTO v_saved_issue_id;

    INSERT INTO taskflow.issue_subscriber (issue_id, user_type, user_id, reason)
    VALUES (v_saved_issue_id, 'member', v_actor_id, 'creator')
    ON CONFLICT ON CONSTRAINT issue_subscriber_pkey DO NOTHING;

    INSERT INTO taskflow.activity_log (
        workspace_id, issue_id, actor_type, actor_id, action, details
    ) VALUES (
        v_workspace_id,
        v_saved_issue_id,
        'member',
        v_actor_id,
        'created',
        pg_catalog.jsonb_build_object('source', 'supabase_connector', 'request_id', p_request_id::TEXT)
    );

    INSERT INTO taskflow.sb_connector_issue_request (request_id, payload, issue_id)
    VALUES (p_request_id, v_payload, v_saved_issue_id);

    RETURN QUERY
    SELECT i.id, i.number, v_prefix || '-' || i.number::TEXT,
           i.workspace_id, i.project_id, i.status, i.revision, FALSE
      FROM taskflow.issue AS i
     WHERE i.id = v_saved_issue_id;
END;
$function$;

-- Controlled snapshot update. The caller first reads the current row, then
-- supplies every editable field plus its observed revision. The transaction
-- rejects stale snapshots instead of silently overwriting a newer change.
CREATE OR REPLACE FUNCTION taskflow.sb_connector_update_issue(
    p_request_id UUID,
    p_project_id UUID,
    p_issue_id UUID,
    p_expected_revision BIGINT,
    p_title TEXT,
    p_description TEXT,
    p_status TEXT,
    p_priority TEXT,
    p_start_date DATE,
    p_due_date DATE
)
RETURNS TABLE (
    issue_id UUID,
    issue_number INTEGER,
    issue_identifier TEXT,
    workspace_id UUID,
    project_id UUID,
    status TEXT,
    revision BIGINT,
    replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, taskflow, extensions, pg_temp
AS $function$
DECLARE
    v_title TEXT := btrim(p_title);
    v_status TEXT := COALESCE(NULLIF(btrim(p_status), ''), 'todo');
    v_priority TEXT := COALESCE(NULLIF(btrim(p_priority), ''), 'none');
    v_workspace_id UUID;
    v_actor_id UUID;
    v_owner_count BIGINT;
    v_prefix TEXT;
    v_number INTEGER;
    v_old_title TEXT;
    v_old_description TEXT;
    v_old_status TEXT;
    v_old_priority TEXT;
    v_old_start_date DATE;
    v_old_due_date DATE;
    v_old_position DOUBLE PRECISION;
    v_old_revision BIGINT;
    v_position DOUBLE PRECISION;
    v_status_category TEXT;
    v_payload JSONB;
    v_saved_payload JSONB;
    v_saved_issue_id UUID;
BEGIN
    IF p_request_id IS NULL OR p_project_id IS NULL OR p_issue_id IS NULL THEN
        RAISE EXCEPTION 'request_id, project_id and issue_id are required' USING ERRCODE = '22023';
    END IF;
    IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
        RAISE EXCEPTION 'expected_revision is required' USING ERRCODE = '22023';
    END IF;
    IF v_title IS NULL OR v_title = '' THEN
        RAISE EXCEPTION 'title is required' USING ERRCODE = '22023';
    END IF;
    IF v_priority NOT IN ('urgent', 'high', 'medium', 'low', 'none') THEN
        RAISE EXCEPTION 'unsupported priority: %', v_priority USING ERRCODE = '22023';
    END IF;

    v_payload := pg_catalog.jsonb_build_object(
        'operation', 'update',
        'project_id', p_project_id,
        'issue_id', p_issue_id,
        'expected_revision', p_expected_revision,
        'title', v_title,
        'description', p_description,
        'status', v_status,
        'priority', v_priority,
        'start_date', p_start_date,
        'due_date', p_due_date
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('taskflow.sb_connector_create_issue:' || p_request_id::TEXT, 0)
    );
    SELECT r.payload, r.issue_id
      INTO v_saved_payload, v_saved_issue_id
      FROM taskflow.sb_connector_issue_request AS r
     WHERE r.request_id = p_request_id;
    IF FOUND THEN
        IF v_saved_payload <> v_payload THEN
            RAISE EXCEPTION 'request_id was already used with a different payload' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY
        SELECT i.id, i.number, w.issue_prefix || '-' || i.number::TEXT,
               i.workspace_id, i.project_id, i.status, i.revision, TRUE
          FROM taskflow.issue AS i
          JOIN taskflow.workspace AS w ON w.id = i.workspace_id
         WHERE i.id = v_saved_issue_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'request_id was already consumed but the issue no longer exists';
        END IF;
        RETURN;
    END IF;

    SELECT i.workspace_id, i.number, i.title, i.description, i.status,
           i.priority, i.start_date, i.due_date, i.position, i.revision,
           w.issue_prefix
      INTO v_workspace_id, v_number, v_old_title, v_old_description,
           v_old_status, v_old_priority, v_old_start_date, v_old_due_date,
           v_old_position, v_old_revision, v_prefix
      FROM taskflow.issue AS i
      JOIN taskflow.project AS p ON p.id = i.project_id AND p.workspace_id = i.workspace_id
      JOIN taskflow.workspace AS w ON w.id = i.workspace_id
     WHERE i.id = p_issue_id
       AND i.project_id = p_project_id
     FOR UPDATE OF i;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'issue not found in the supplied Project';
    END IF;
    IF v_old_revision <> p_expected_revision THEN
        RAISE EXCEPTION 'issue revision conflict: expected %, current %', p_expected_revision, v_old_revision USING ERRCODE = '40001';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_owner_count
      FROM taskflow.member AS m
     WHERE m.workspace_id = v_workspace_id
       AND m.role = 'owner';
    IF v_owner_count <> 1 THEN
        RAISE EXCEPTION 'workspace must have exactly one owner for connector attribution';
    END IF;
    SELECT m.user_id
      INTO v_actor_id
      FROM taskflow.member AS m
     WHERE m.workspace_id = v_workspace_id
       AND m.role = 'owner'
     LIMIT 1;

    SELECT s.category
      INTO v_status_category
      FROM taskflow.issue_status AS s
     WHERE s.workspace_id = v_workspace_id
       AND s.key = v_status
       AND s.archived_at IS NULL
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'status is not active in the target workspace: %', v_status;
    END IF;

    IF v_status IS DISTINCT FROM v_old_status THEN
        SELECT COALESCE(pg_catalog.min(i.position), 0) - 1
          INTO v_position
          FROM taskflow.issue AS i
         WHERE i.workspace_id = v_workspace_id
           AND i.status = v_status;
    ELSE
        v_position := v_old_position;
    END IF;

    UPDATE taskflow.issue AS i
       SET title = v_title,
           description = p_description,
           status = v_status,
           priority = v_priority,
           start_date = p_start_date,
           due_date = p_due_date,
           position = v_position,
           revision = i.revision + CASE WHEN
               ROW(i.title, i.description, i.status, i.priority, i.start_date, i.due_date, i.position)
               IS DISTINCT FROM ROW(v_title, p_description, v_status, v_priority, p_start_date, p_due_date, v_position)
               THEN 1 ELSE 0 END,
           last_activity_at = CASE WHEN
               ROW(i.title, i.description, i.status, i.priority, i.start_date, i.due_date)
               IS DISTINCT FROM ROW(v_title, p_description, v_status, v_priority, p_start_date, p_due_date)
               THEN GREATEST(COALESCE(i.last_activity_at, i.updated_at), pg_catalog.now())
               ELSE i.last_activity_at END,
           updated_at = CASE WHEN
               ROW(i.title, i.description, i.status, i.priority, i.start_date, i.due_date, i.position)
               IS DISTINCT FROM ROW(v_title, p_description, v_status, v_priority, p_start_date, p_due_date, v_position)
               THEN pg_catalog.now() ELSE i.updated_at END
     WHERE i.id = p_issue_id
       AND i.revision = p_expected_revision;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'issue revision conflict during update' USING ERRCODE = '40001';
    END IF;

    INSERT INTO taskflow.activity_log (workspace_id, issue_id, actor_type, actor_id, action, details)
    SELECT v_workspace_id, p_issue_id, 'member', v_actor_id, change.action, change.details
      FROM (VALUES
        ('title_changed'::TEXT, v_old_title IS DISTINCT FROM v_title, pg_catalog.jsonb_build_object('from', v_old_title, 'to', v_title)),
        ('description_updated'::TEXT, v_old_description IS DISTINCT FROM p_description, '{}'::JSONB),
        ('status_changed'::TEXT, v_old_status IS DISTINCT FROM v_status, pg_catalog.jsonb_build_object('from', v_old_status, 'to', v_status)),
        ('priority_changed'::TEXT, v_old_priority IS DISTINCT FROM v_priority, pg_catalog.jsonb_build_object('from', v_old_priority, 'to', v_priority)),
        ('start_date_changed'::TEXT, v_old_start_date IS DISTINCT FROM p_start_date, pg_catalog.jsonb_build_object('from', v_old_start_date, 'to', p_start_date)),
        ('due_date_changed'::TEXT, v_old_due_date IS DISTINCT FROM p_due_date, pg_catalog.jsonb_build_object('from', v_old_due_date, 'to', p_due_date))
      ) AS change(action, changed, details)
     WHERE change.changed;

    INSERT INTO taskflow.sb_connector_issue_request (request_id, payload, issue_id)
    VALUES (p_request_id, v_payload, p_issue_id);

    RETURN QUERY
    SELECT i.id, i.number, v_prefix || '-' || i.number::TEXT,
           i.workspace_id, i.project_id, i.status, i.revision, FALSE
      FROM taskflow.issue AS i
     WHERE i.id = p_issue_id;
END;
$function$;

-- New functions grant EXECUTE to PUBLIC by default. Keep this operation
-- callable only from the already trusted Supabase Connector role. No table
-- privileges are granted to application roles by this candidate.
REVOKE ALL ON FUNCTION taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM anon, authenticated, service_role, taskflow_runtime;
GRANT EXECUTE ON FUNCTION taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO postgres;
REVOKE ALL ON FUNCTION taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM anon, authenticated, service_role, taskflow_runtime;
GRANT EXECUTE ON FUNCTION taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO postgres;

COMMIT;
