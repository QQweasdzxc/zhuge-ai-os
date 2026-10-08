# Multica Lab — secure bind and first runtime

This file contains no credentials.

## 1. Backend secrets (Render)

Service: `zhuge-multica-lab-api`

The backend cannot become healthy until these two private values are set directly in Render:

- `DATABASE_URL`: a Supabase PostgreSQL connection string that authenticates a role whose `search_path` begins with `lab_multica,extensions,public`.
- `JWT_SECRET`: a strong random secret (Multica recommends a 32-byte / 64-hex value).

Recommended database role already provisioned in Supabase:
`multica_lab_runtime`

The role has no password yet by design. Set its password privately in Supabase SQL Editor or another secure administrative path, then use that credential only in Render's private environment variable UI. Never commit it and never paste it into chat.

The Lab schema is:
`lab_multica`

Production Zhuge tables are not the target of Multica migrations.

## 2. Native login bootstrap

For the first native Multica experience, keep Multica authentication unchanged.

If email/SMTP is not configured, Multica prints the one-time verification code in backend logs. This is acceptable only for this private Lab bootstrap. After the first account/workspace is created, close public signup again.

## 3. Connect a Zhuge-owned runtime

A real agent run requires a connected machine with the Multica daemon plus a supported coding CLI.

Recommended first runtime:
- Machine: Zhuge Mac mini
- Provider: Codex CLI

On that machine, after the backend is healthy:

```bash
brew install multica-ai/tap/multica
multica setup self-host \
  --server-url https://zhuge-multica-lab-api.onrender.com \
  --app-url https://zhuge-multica-lab.onrender.com
multica daemon status
```

The setup flow opens authentication in the browser. Do not copy provider credentials into Multica server environment variables; let the daemon use the coding CLI credentials already owned by the runtime machine.

## 4. Safety boundary

The initial experiment may read/change a Lab worktree or isolated Zhuge source copy, run tests, create commits and report diffs.

It must not:
- push `main` without Zhuge PM exact-SHA approval,
- use Production Supabase service credentials,
- deploy Production,
- mutate canonical Production data.

## 5. First experience acceptance

A successful first play session proves:

Issue → Assign Agent → Run queued → Runtime claims → Codex executes → progress appears → result/comment returns → Blocked/Retry can be observed → another agent can be mentioned/woken.

Only after this native experience do we decide what to REUSE / ADAPT / REBUILD inside Zhuge Board 2.0.
