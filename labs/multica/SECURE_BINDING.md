# Multica Lab — Zhuge identity and first runtime

This file contains no credentials.

## 1. Identity

There is no Multica-native human registration flow in Zhuge Lab.

Entry contract:

```
Zhuge authenticated session
  → /auth/zhuge
  → verify Supabase user + Zhuge app access
  → reuse the same Zhuge user UUID
  → create a Multica-local session
  → enter the Zhuge-created Lab workspace
```

Email OTP, Google login inside Multica, native workspace signup, invitations and share-link membership are disabled.

## 2. Database

Backend service: `zhuge-multica-lab-api`

Database: Zhuge Supabase project, isolated schema `lab_multica`.

Runtime database role: `multica_lab_runtime`.

`DATABASE_URL` and `JWT_SECRET` are stored only in Render private environment configuration. Production Zhuge canonical tables are not migration targets.

## 3. Connect a Zhuge-owned runtime

A real agent run requires a connected machine with the Multica daemon plus a supported coding CLI.

Recommended first runtime:
- Machine: Zhuge Mac mini
- Provider: Codex CLI

On that machine:

```bash
brew install multica-ai/tap/multica
multica setup self-host \
  --server-url https://zhuge-multica-lab-api.onrender.com \
  --app-url https://zhuge-multica-lab.onrender.com
multica daemon status
```

The browser handoff must use the already-bound Zhuge identity. Provider credentials stay on the runtime machine; do not place Codex credentials in Multica server environment variables.

## 4. Safety boundary

The experiment may read/change a Lab worktree or isolated Zhuge source copy, run tests, create Lab commits and report diffs.

It must not:
- push `main` without Zhuge PM exact-SHA approval,
- use Production Supabase service credentials,
- deploy Zhuge Production,
- mutate canonical Production data.

## 5. First experience acceptance

A successful first play session proves:

Issue → Assign Agent → Run queued → Runtime claims → Codex executes → progress appears → result/comment returns → Blocked/Retry can be observed → another agent can be mentioned/woken.

Only after this native experience do we decide what to REUSE / ADAPT / REBUILD inside Zhuge Board 2.0.
