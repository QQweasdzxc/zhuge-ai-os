# TaskFlow PostgreSQL Connection Budget — Issue #40 Candidate

This is a non-secret inventory and a runtime guard contract. It does **not**
set a Production pool size or change Render/Supabase configuration.

## Evidence and limits

- The accepted RCA records a Supavisor `EMAXCONNSESSION` incident for
  `taskflow_runtime`, an observed `pool_size: 15`, API startup logs at
  `max_conns=25,min_conns=5`, and eight webhook-worker fatal attempts in the
  incident window. These observations establish a mismatch; they do not prove
  that every event record was a unique client request.
- The GPT/CTO read-only Render inventory saw one TaskFlow API instance and a
  separate Native Lab API instance. It did not establish every database URL,
  role, effective per-client pool setting, or concurrent operator client.
- A later `pg_stat_activity` aggregate returned no rows for the three named
  runtime/migrator roles at one instant. That is only a point-in-time sample,
  not an occupancy baseline or proof that other clients do not connect.
- No live connection cap, headroom, or safe Production pool size is inferred
  here. The current `pool_size=15` incident evidence is not a release-time
  configuration authorization.

## Consumer ledger

| Consumer | Connection source / behavior | Budget status |
| --- | --- | --- |
| TaskFlow API primary pool (`server/cmd/server/main.go` → `newDBPool`) | One pool per API process, using `DATABASE_MAX_CONNS` / `DATABASE_MIN_CONNS`, URL pool parameters, then pinned defaults `25/5`. Multiply by actual API instance count. | Guarded by this candidate; actual allocation must be explicitly measured and configured. |
| TaskFlow API optional replica pool (`newReplicaDBPool`) | One additional pool per API process when `DATABASE_REPLICA_URL` is present; `DATABASE_REPLICA_MAX_CONNS` / `_MIN_CONNS`, then pinned defaults `10/0`. | Guarded by this candidate; replica allocation is zero only when the optional pool is not budgeted/enabled. |
| Four webhook delivery workers | Share the API handler's existing `Queries` and primary pool. They do not each create a separate `pgxpool`; the previous fixed idle loop could issue up to four empty claims per second per API instance. | Included in the API primary-pool allocation; candidate applies bounded idle/error backoff with jitter and keeps notification wakeups. |
| TaskFlow migration process (`server/cmd/migrate`) | One-shot `taskflow_migrator`/controlled migration connection, separate from the long-running API runtime. | Must fit the external-session reserve and be serialized; no migration is run by this candidate. |
| TaskFlow maintenance/backfill executables in the API image | `maintenance`, `backfill_task_usage_hourly`, and `backfill_codex_usage_cache` can each open a pool when separately launched. | External-session reserve; run one controlled operation at a time and account for its process-specific pool before use. |
| Repository-only operational binaries (not copied into the current API image) | `backfill_issue_last_activity` and `backfill_delegated_failure_settled` also open pools from `DATABASE_URL` if an operator builds/runs them. | External-session reserve if used; no scheduled or live invocation was established. |
| Database-backed integration tests | Multiple Go integration tests can open pools/connections when `DATABASE_URL` is set. | Test-only consumers; run against isolated QA databases and include their parallelism in a QA budget. No such DB suite was run for this candidate. |
| Native Multica Lab API | Separate service and `multica_lab_runtime` identity per current architecture. It is not included in TaskFlow's guarded API pool; it may share the Supabase project/pooler infrastructure. | Independent consumer; effective pooler route and occupancy remain unverified here. Do not assume it is zero. |
| Other Zhuge / operator clients | Supabase platform APIs, administrative sessions, local tools, and any direct PostgreSQL clients may add project-level load. | Not attributed to the TaskFlow runtime role by assumption; aggregate headroom is not established. |

## Fail-closed contract in this candidate

Before creating either TaskFlow API pool, require these non-secret deployment
values:

- `TASKFLOW_DB_SESSION_BUDGET`: total sessions allocated to TaskFlow after
  reserving shared-project headroom for Native Lab, operators, and every other
  non-TaskFlow client. The release value must be derived from the actual
  Supavisor limit and measured shared consumers.
- `TASKFLOW_DB_PRIMARY_SESSION_BUDGET`: total primary-pool allocation across
  all API instances.
- `TASKFLOW_DB_REPLICA_SESSION_BUDGET`: total optional replica-pool allocation
  across all API instances (explicit `0` when disabled).
- `TASKFLOW_DB_EXTERNAL_SESSION_RESERVE`: sessions reserved inside the
  TaskFlow allocation for controlled migrations, maintenance/backfill
  processes, and other non-API database clients. This must be a measured,
  positive reservation; zero is rejected because the candidate must not assume
  non-API database occupancy is zero.
- `TASKFLOW_API_REPLICA_COUNT`: actual API instance count used for the
  deployment.

The guard rejects missing/malformed budgets, a zero external-session reserve,
`min > max`, and any computed
`pool max × API instance count` above its allocation. Primary + replica +
external reservations must fit the declared TaskFlow total. It logs only pool
counts and budget integers; it never logs a URL, password, or secret. The guard
does not dynamically discover Render scaling or external clients: scale changes
must update the non-secret replica-count/budget contract in the same controlled
deployment change.

Budget unit tests use an explicitly simulated `8-session` allocation only to
exercise the arithmetic. It is **not** a Production recommendation. A separate
ephemeral PostgreSQL 17 container test issued 48 concurrent read-only `SELECT`
requests through a local `pgxpool` configured with `max_conns=4,min_conns=0`:
48 succeeded, 0 failed, the pool ended at 4 connections, and wall time was
256 ms. The container and harness were stopped/removed after the test.

This local simulation verifies bounded client-pool behavior only. It does not
model Supavisor's session cap, Render replicas, Native Lab consumers, or
`EMAXCONNSESSION`. The live consumer ledger remains incomplete, so actual
Production budget values and any Render environment update are a separate
GPT/CTO + PM release gate. No Production load test was run.

## Recovery / risk

- No Production change is part of this review candidate. Before a later release,
  record the current Render deployment/image and existing `DATABASE_*` settings.
- Safe `.9.31` → `.9.32` rollout is conditional on an evidence-based budget
  ledger being approved first. Add the five non-secret budget settings while
  the `.9.31` image is still active; the pinned `.9.31` pool source does not
  read these names, so its existing pool configuration is unchanged. Then
  deploy the exact `.9.32` image. Its guard validates configuration before
  `pgxpool.NewWithConfig`, so missing or inconsistent values prevent the API
  from opening a pool. If startup fails, stop rollout and redeploy the recorded
  `.9.31` image; it ignores the new budget keys and requires no database
  rollback because this candidate adds no migration or data mutation. Do not
  pick the five values until the actual pooler limit, API replica count, Native
  Lab, and other database consumers have been measured.
- Too-small allocations can increase queue wait/timeout latency. The safe
  response is to stop deployment, remeasure all consumers, and revise the
  declared budget; do not raise a pool cap based solely on `EMAXCONNSESSION`.
- The webhook queue stays durable and its claim/delivery code is unchanged.
  Backoff only changes idle/error polling cadence. Successful work drains
  immediately; a queued notification interrupts the timer immediately.
- Automatic retries apply only to tagged fetch transport failures, HTTP 429,
  and HTTP 5xx, and stop after two retries. HTTP 4xx including 404 remain
  explicit. TanStack's request signal is forwarded; cancellation is not
  retried.

The remaining live gate is to reconcile the actual shared-project session
limit, API replica count, Native Lab and operator clients, and current pooler
occupancy before selecting Production budget values. Neither the local SQL
simulation nor the arithmetic unit tests establish that live headroom.
