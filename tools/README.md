# Controlled Engineering Tool Path

`engineering-transition.js` is a server/tool-side adapter for the approved
`board_transition_task` RPC. It is not browser code and must not be bundled by
GitHub Pages or any module.

The tool requires these environment variables in a protected execution
environment:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret, never committed>
```

The service-role key is read at runtime only. It must not be placed in source,
ZIP artifacts, HTML, JavaScript served to browsers, or client configuration.

## Read-only inspection

```bash
node tools/engineering-transition.js inspect --task TASK-001
```

## Dry-run validation

Omit `--confirm` to validate the current status and approved transition without
writing to Supabase:

```bash
node tools/engineering-transition.js transition \
  --task TASK-001 \
  --actor Co \
  --expected-status ready \
  --target-status inprogress \
  --target-assignee Co
```

## Controlled write

Only run this from the protected Engineering Tool environment:

```bash
node tools/engineering-transition.js transition \
  --task TASK-001 \
  --actor Co \
  --expected-status ready \
  --target-status inprogress \
  --target-assignee Co \
  --confirm
```

The database RPC remains the authority for transition validation, RLS boundary,
Status/Assignee update, and `engineering_activity_log` audit. Direct DML and
anonymous CRUD are not supported.
