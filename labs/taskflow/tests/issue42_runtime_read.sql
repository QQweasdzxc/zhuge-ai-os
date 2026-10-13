-- Run after the connector assertions using the isolated taskflow_runtime role.
SELECT i.id, w.issue_prefix || '-' || i.number::TEXT AS identifier,
       i.workspace_id, i.project_id, i.title, i.status, i.revision
  FROM taskflow.issue AS i
  JOIN taskflow.workspace AS w ON w.id = i.workspace_id
 WHERE i.project_id = '30000000-0000-4000-8000-000000000001'
   AND i.title = 'Issue42 updated path';
