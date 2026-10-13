-- Execute as the isolated, read-only Connector role `postgres` after the
-- final candidate SQL and synthetic fixtures have been installed.
DO $issue42_assertions$
DECLARE
    v_created RECORD;
    v_replay RECORD;
    v_project_b RECORD;
    v_blocker RECORD;
    v_updated RECORD;
    v_count BIGINT;
    v_activity_count BIGINT;
    v_failed BOOLEAN;
BEGIN
    IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
        RAISE EXCEPTION 'connector assertions must run as the isolated postgres login';
    END IF;
    IF has_table_privilege('postgres', 'taskflow.issue', 'INSERT')
       OR has_table_privilege('postgres', 'taskflow.issue', 'UPDATE')
       OR has_table_privilege('postgres', 'taskflow.workspace', 'UPDATE')
       OR has_table_privilege('postgres', 'taskflow.activity_log', 'INSERT')
       OR has_table_privilege('postgres', 'taskflow.issue_subscriber', 'INSERT') THEN
        RAISE EXCEPTION 'Connector unexpectedly has direct TaskFlow DML';
    END IF;

    SELECT * INTO v_created
      FROM taskflow.sb_connector_create_issue(
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'Issue42 create path', 'Synthetic full-migration QA', 'todo', 'medium', NULL, NULL
      );
    IF v_created.issue_id IS NULL OR v_created.issue_number <> 1
       OR v_created.issue_identifier <> 'QA-1'
       OR v_created.workspace_id <> '10000000-0000-4000-8000-000000000001'
       OR v_created.project_id <> '30000000-0000-4000-8000-000000000001'
       OR v_created.status <> 'todo' OR v_created.revision <> 1 OR v_created.replayed THEN
        RAISE EXCEPTION 'create returned an unexpected canonical TaskFlow row: %', row_to_json(v_created);
    END IF;
    SELECT count(*) INTO v_count FROM taskflow.issue WHERE id = v_created.issue_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'native TaskFlow issue readback failed'; END IF;
    SELECT count(*) INTO v_count FROM taskflow.issue_subscriber
     WHERE issue_id = v_created.issue_id AND user_type = 'member'
       AND user_id = '20000000-0000-4000-8000-000000000001' AND reason = 'creator';
    IF v_count <> 1 THEN RAISE EXCEPTION 'creator subscription was not written'; END IF;
    SELECT count(*) INTO v_count FROM taskflow.activity_log
     WHERE issue_id = v_created.issue_id AND action = 'created'
       AND details ->> 'request_id' = '40000000-0000-4000-8000-000000000001';
    IF v_count <> 1 THEN RAISE EXCEPTION 'create activity record missing'; END IF;

    SELECT * INTO v_replay
      FROM taskflow.sb_connector_create_issue(
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'Issue42 create path', 'Synthetic full-migration QA', 'todo', 'medium', NULL, NULL
      );
    IF v_replay.issue_id <> v_created.issue_id OR NOT v_replay.replayed THEN
        RAISE EXCEPTION 'same create request did not return the original issue';
    END IF;
    SELECT count(*) INTO v_count FROM taskflow.issue
     WHERE workspace_id = '10000000-0000-4000-8000-000000000001';
    IF v_count <> 1 THEN RAISE EXCEPTION 'idempotent create produced a duplicate issue'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_create_issue(
          '40000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          'Changed payload', NULL, 'todo', 'none', NULL, NULL
        );
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'reusing a request id with a new payload was accepted'; END IF;

    -- Same title is valid in a different Project; the guard is Project-scoped.
    SELECT * INTO v_project_b
      FROM taskflow.sb_connector_create_issue(
        '40000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002',
        'Issue42 create path', NULL, 'todo', 'none', NULL, NULL
      );
    IF v_project_b.issue_identifier <> 'QA-2'
       OR v_project_b.project_id <> '30000000-0000-4000-8000-000000000002' THEN
        RAISE EXCEPTION 'Project-scoped same-title create or workspace numbering failed';
    END IF;

    SELECT * INTO v_blocker
      FROM taskflow.sb_connector_create_issue(
        '40000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000001',
        'Reserved Issue42 title', NULL, 'todo', 'low', NULL, NULL
      );
    IF v_blocker.issue_identifier <> 'QA-3' THEN
        RAISE EXCEPTION 'workspace allocator did not return sequential ZG-style identifiers';
    END IF;

    -- The same connector operation can target another Workspace and derives
    -- that Workspace from Project; it never accepts a caller-supplied workspace.
    SELECT * INTO v_replay
      FROM taskflow.sb_connector_create_issue(
        '40000000-0000-4000-8000-000000000007',
        '30000000-0000-4000-8000-000000000003',
        'Workspace-derived issue', NULL, 'todo', 'none', NULL, NULL
      );
    IF v_replay.issue_identifier <> 'Q2-1'
       OR v_replay.workspace_id <> '10000000-0000-4000-8000-000000000002' THEN
        RAISE EXCEPTION 'Project did not determine its own Workspace/number route';
    END IF;

    -- A Project ID mismatch is rejected even when both Projects share a
    -- Workspace; a second Project in another Workspace is rejected as well.
    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000008',
          '30000000-0000-4000-8000-000000000002', v_created.issue_id, v_created.revision,
          'Wrong project', NULL, 'todo', 'none', NULL, NULL
        );
    EXCEPTION WHEN raise_exception THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'same-workspace Project mismatch was accepted'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000009',
          '30000000-0000-4000-8000-000000000003', v_created.issue_id, v_created.revision,
          'Wrong workspace', NULL, 'todo', 'none', NULL, NULL
        );
    EXCEPTION WHEN raise_exception THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'cross-workspace Project mismatch was accepted'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000010',
          '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
          'Invalid status', NULL, 'not_a_status', 'none', NULL, NULL
        );
    EXCEPTION WHEN raise_exception THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'inactive status was accepted'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000011',
          '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
          'Reserved Issue42 title', NULL, 'in_progress', 'high', NULL, NULL
        );
    EXCEPTION WHEN SQLSTATE '23505' THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'update title duplicate guard did not reject the active duplicate'; END IF;
    IF NOT EXISTS (SELECT 1 FROM taskflow.issue WHERE id = v_created.issue_id AND title = 'Issue42 create path' AND revision = v_created.revision) THEN
        RAISE EXCEPTION 'rejected duplicate update changed the issue';
    END IF;

    SELECT count(*) INTO v_activity_count FROM taskflow.activity_log WHERE issue_id = v_created.issue_id;
    SELECT * INTO v_updated
      FROM taskflow.sb_connector_update_issue(
        '40000000-0000-4000-8000-000000000004',
        '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
        'Issue42 updated path', 'Updated synthetic description', 'in_progress', 'high',
        DATE '2026-10-13', DATE '2026-10-20'
      );
    IF v_updated.issue_id <> v_created.issue_id OR v_updated.issue_identifier <> 'QA-1'
       OR v_updated.status <> 'in_progress' OR v_updated.revision <> v_created.revision + 1
       OR v_updated.replayed THEN
        RAISE EXCEPTION 'update did not persist the expected new TaskFlow revision: %', row_to_json(v_updated);
    END IF;
    SELECT count(*) INTO v_count FROM taskflow.issue
     WHERE id = v_created.issue_id AND project_id = '30000000-0000-4000-8000-000000000001'
       AND title = 'Issue42 updated path' AND status = 'in_progress'
       AND description = 'Updated synthetic description' AND priority = 'high'
       AND start_date = DATE '2026-10-13' AND due_date = DATE '2026-10-20';
    IF v_count <> 1 THEN RAISE EXCEPTION 'updated TaskFlow row readback failed'; END IF;

    SELECT * INTO v_replay
      FROM taskflow.sb_connector_update_issue(
        '40000000-0000-4000-8000-000000000004',
        '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
        'Issue42 updated path', 'Updated synthetic description', 'in_progress', 'high',
        DATE '2026-10-13', DATE '2026-10-20'
      );
    IF v_replay.issue_id <> v_created.issue_id OR NOT v_replay.replayed THEN
        RAISE EXCEPTION 'same update request did not return the original issue';
    END IF;
    SELECT count(*) INTO v_count FROM taskflow.activity_log WHERE issue_id = v_created.issue_id;
    IF v_count <> v_activity_count + 6 THEN
        RAISE EXCEPTION 'update replay generated unexpected duplicate activity (before %, after %)', v_activity_count, v_count;
    END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000012',
          '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
          'Stale write', 'stale', 'todo', 'none', NULL, NULL
        );
    EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'stale revision update was accepted'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM * FROM taskflow.sb_connector_update_issue(
          '40000000-0000-4000-8000-000000000004',
          '30000000-0000-4000-8000-000000000001', v_created.issue_id, v_created.revision,
          'Different replay payload', 'Updated synthetic description', 'in_progress', 'high',
          DATE '2026-10-13', DATE '2026-10-20'
        );
    EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'update request id reuse with different payload was accepted'; END IF;

    RAISE NOTICE 'ISSUE42_POSTGRES_ASSERTIONS=PASS created=% identifier=% updated_revision=% project_b=%',
      v_created.issue_id, v_created.issue_identifier, v_updated.revision, v_project_b.project_id;
END
$issue42_assertions$;
