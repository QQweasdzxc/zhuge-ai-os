-- Synthetic fixtures for the disposable PostgreSQL integration service only.
-- Run as taskflow_migrator after the complete staged Multica migration set.
BEGIN;

INSERT INTO taskflow."user" (id, name, email) VALUES
    ('20000000-0000-4000-8000-000000000001', 'Issue 42 QA owner', 'issue42-owner@example.invalid');

INSERT INTO taskflow.workspace (id, name, slug, issue_prefix, issue_counter) VALUES
    ('10000000-0000-4000-8000-000000000001', 'Issue 42 QA Workspace A', 'issue42-qa-a', 'QA', 0),
    ('10000000-0000-4000-8000-000000000002', 'Issue 42 QA Workspace B', 'issue42-qa-b', 'Q2', 0);

INSERT INTO taskflow.member (workspace_id, user_id, role) VALUES
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner'),
    ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'owner');

INSERT INTO taskflow.project (id, workspace_id, title) VALUES
    ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Issue 42 Project A'),
    ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Issue 42 Project B'),
    ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Issue 42 Workspace B Project');

INSERT INTO taskflow.issue_status (workspace_id, key, name, description, category, color, is_system, position)
SELECT w.id, s.key, s.name, '', s.category, s.color, TRUE, s.position
  FROM taskflow.workspace AS w
 CROSS JOIN (VALUES
    ('backlog', 'Backlog', 'unstarted', '#6b7280', 0::DOUBLE PRECISION),
    ('todo', 'Todo', 'unstarted', '#6b7280', 1::DOUBLE PRECISION),
    ('in_progress', 'In Progress', 'started', '#f59e0b', 2::DOUBLE PRECISION),
    ('in_review', 'In Review', 'started', '#22c55e', 3::DOUBLE PRECISION),
    ('done', 'Done', 'done', '#3b82f6', 4::DOUBLE PRECISION),
    ('blocked', 'Blocked', 'started', '#ef4444', 5::DOUBLE PRECISION),
    ('cancelled', 'Cancelled', 'closed', '#6b7280', 6::DOUBLE PRECISION)
 ) AS s(key, name, category, color, position)
 WHERE w.id IN (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
 );

COMMIT;
