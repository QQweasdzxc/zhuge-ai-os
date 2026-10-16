# Cloud Handoff v1 — TaskFlow Co/Gem

Read [PRODUCTION_AUTHORITY.md](PRODUCTION_AUTHORITY.md) first. This internal source does not create a second customer-facing website or start any cloud agent.

## Source components
- `contract.mjs`: audit state machine, exact SHA, one writer, stop/recovery gate.
- `taskflow-bridge.mjs`: authenticated native TaskFlow issue/revision reader.
- `github-cas.mjs`: durable GitHub checkpoint claim adapter, server-side only.
- `taskflow-codex-dispatch.mjs`: trusted-orchestrator envelope, not a public HTTP route.
- `codex-github-mention.mjs`: Codex PR mention transport, disabled by default.
- `codex-ack-reconciler.mjs`: read-only official bot correlation (NOT a verified TaskFlow Run).
- `production-readiness.mjs`: read-only eligibility inspection; never flips dispatchEnabled to true.

## Verify
```sh
node --test tests/cloud-handoff-*.test.mjs
node labs/cloud-handoff/cli.mjs gate labs/cloud-handoff/examples/issue45-quota-blocked.json
```

**Release rule**: The only official TaskFlow site is `https://zhuge-taskflow-web.onrender.com`. The current .9.54 visible panel remains non-dispatching. A future provider switch needs TaskFlow authenticated service authority, durable Run/CAS, exact per-task PM approval, scoped credentials, cost approval and a new formal Production GO. Existing #45 uncommitted work cannot be silently discarded. Never claim a GitHub comment proves Co has started.
