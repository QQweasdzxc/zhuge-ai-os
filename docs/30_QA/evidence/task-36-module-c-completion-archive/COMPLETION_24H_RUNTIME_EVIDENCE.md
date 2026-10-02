# Completion 24h Runtime Evidence

Status: **Source/Developer QA evidence; no Cloud mutation and no PM runtime acceptance**

This evidence package proves the repository contract and executable local test coverage. It intentionally does not fabricate Cloud rows, scheduler runs, activity records, or browser screenshots for a live Supabase environment.

## Test artifact

Added:

`tests/module-c-completion-auto-archive.test.js`

The test reads the existing C migrations and shared runtime/service source and exercises the shared service through an injected gateway. It does not call production Cloud or write product data.

## Contract cases

| Case | Expected | Result |
| --- | --- | --- |
| A: completion age 23h59m | Not archive-eligible | PASS |
| B: completion age >= 24h / due time passed | Archive-eligible | PASS |
| C: completed then moved out after 12h | Active due time cleared; not eligible | PASS |
| D: moved out then completed again | Fresh timestamp/due time; old window not reused | PASS |
| E: already archived and scheduler re-runs | Read-only archived state; no duplicate transition | PASS |
| F: WorkTodo, AI Board, GAS/Procurement, C Mother | Same C RPC and 86400 policy contract | PASS |

Additional source assertions cover:

- `clock_timestamp()` as the completion-entry time;
- no calculation from `created_at` or `updated_at`;
- `FOR UPDATE SKIP LOCKED` and `archived_at is null` idempotency;
- archive-only update fields;
- `engineering_activity_log` activity with `task_auto_archived` and `System` actor taxonomy;
- no task delete in the C archive migrations;
- one `pg_cron` job at five-minute cadence;
- advisory locking and transaction-local trigger authorization;
- WorkTodo legacy lifecycle trigger/RPC retirement;
- shared C runtime enablement for the relevant adopters.

## Local QA commands and results

### New targeted contract

```text
node --test tests/module-c-completion-auto-archive.test.js
6 pass / 0 fail / 0 skipped
```

### Expanded Module C targeted set

```text
node --test \
  tests/c-consumer-lifecycle-final.test.js \
  tests/task-064-board-adoption.test.js \
  tests/task-064-instance-scope.test.js \
  tests/task-064-shared-policy.test.js \
  tests/c-completion-archive-actor-label.test.js \
  tests/ai-board-completion-lifecycle.test.js \
  tests/task-039-final-closing.test.js \
  tests/module-c-completion-auto-archive.test.js \
  tests/module-c-workspace-reorder.test.js \
  tests/worktodo-c-writer-authority-closure.test.js \
  tests/ai-board-lifecycle-authority-closure.test.js \
  tests/c-operational-motherboard.test.js \
  tests/c-composition-movement-regression.test.js
76 pass / 0 fail / 0 skipped
```

This set includes the existing workspace reorder and movement regression coverage; no reorder or card drag contract was changed by TASK-36.

### Full Regression

Executed with the installed local Chrome binary available to browser-aware Node tests:

```text
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/*.test.js
804 pass / 0 fail / 0 skipped
```

### Browser Regression

Executed with:

```text
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

Results:

- browser test suite: `19 pass / 0 fail / 0 skipped`;
- standalone browser scripts: all completed successfully;
- final runner status: `PASS`;
- browser executable: `Google Chrome`.

The first no-environment invocation was intentionally not used as the final result because the runner requires an explicit CI Chromium path. The local Chrome path above is the reproducible QA invocation.

### Static checks

```text
node --check tests/module-c-completion-auto-archive.test.js  PASS
git diff --check                                      PASS
```

## Runtime evidence boundary

The source contains a server-side `pg_cron` migration and a private scheduler/core path. This local run did not:

- apply any Supabase migration;
- query the current Cloud `cron.job` or scheduler run table;
- insert or update a real `board_tasks` row;
- create a real `engineering_activity_log` archive event;
- capture a PM Cloud runtime screenshot;
- deploy, push, or create a PR.

Therefore the evidence status is:

```text
SOURCE_AUTHORITY       = VERIFIED
LOCAL_DEVELOPER_QA     = PASS
LIVE_CLOUD_SCHEDULER   = NOT_REVERIFIED / PM GATE PENDING
PM_RUNTIME_ACCEPTANCE  = NOT STARTED
```

Historical QA documents in `docs/30_QA/` describe earlier Cloud read-back, but they are not substituted for a current read-back in this task.

## Required next gate

Stop here for GPT Review. Only after PM authorization should Cloud migration/read-back and live runtime samples be performed. No Taiwan, Investment, Lab, UI redesign, deployment, or Cloud data work belongs to this task.
