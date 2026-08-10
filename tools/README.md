# Controlled Engineering Tool Path

`engineering-transition.js` is a server/tool-side adapter for the approved
`board_transition_task` RPC. It is not browser code and must not be bundled by
GitHub Pages or any module. `engineering-actor-broker.js` only issues short-lived
Co/GPT actor tokens; it never calls Supabase or writes Board data.

The tool requires these environment variables in a protected execution
environment:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
ENGINEERING_ACTOR_TOKEN=<short-lived protected token>
ENGINEERING_ACTOR_PRIVATE_JWK=<protected broker-only P-256 private JWK>
```

The Supabase service-role key remains only in the Edge Function runtime. It is
never placed in source, ZIP artifacts, HTML, JavaScript served to browsers, or
this tool's environment.

## Actor token issuance (protected broker runtime)

```bash
ENGINEERING_ACTOR_PRIVATE_JWK='…' node tools/engineering-actor-broker.js issue --actor Co
```

The token is short-lived (maximum five minutes), scoped to `board:transition`,
and must never be placed in browser code, a ZIP, source control, or chat.

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
