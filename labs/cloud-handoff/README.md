# Zhuge AI OS — Cloud Handoff v1 (Issue #51)

**Candidate component:** 0.9.0-alpha.9.50 / Build 20261015-1830.
**Status:** Isolated source and CI review only. Official GitHub @codex PM-approved read-only trigger verified separately; TaskFlow native live dispatch, runtime and Gemini connection NOT deployed or verified. Production remains .9.45. #45 .9.46 / Draft PR #50 remains on hold.

## Why this exists

During an earlier Codex Cloud Issue #45 run, Co exhausted the usage window with **four modified files visible only in its cloud worktree**. Historical first checkpoint GitHub PR #50 SHA: 199ea823af0692ca99e222b024ee3238cbc3a9fc. **This is a frozen negative test fixture, not current live state.** Co subsequently pushed SHA ca6559f981edaf8ceeb7822d0aaee4af53dfa7a9; PR #50 remains Draft. A new handoff must read the live HEAD and verify a fresh clean worktree / stop receipt. A second engineer MUST NOT assume they did.

The sample [examples/issue45-quota-blocked.json](examples/issue45-quota-blocked.json) is intentionally BLOCKED_CHECKPOINT, owner Co, dirty_files=4 and cannot launch Gem.

## Authoritative boundaries

- **TaskFlow / taskflow.issue**: task, project, human permissions and business status. NO changes to Production DB or native Run data in this candidate.
- **GitHub**: committed code, review branch, exact SHA, Draft PR, CI. Handoff manifest is *execution metadata*, NOT a shadow business Task.
- **Cloud Dispatcher**: a future authorized service must atomically assign exactly one writer per Task with a lease and revision, re-check live branch SHA and old worker stop receipt. This isolated JS module has test-only dependency-injected adapters, NOT cloud authentication.
- **Codex Cloud**: first engineer, existing published environment zhuge-ai-os. This does NOT equal a TaskFlow native Runtime (which has zero registered instances).
- **Gemini**: second engineer, whose eventual headless cloud runner requires Google-approved credentials, cost/quota consent, least privilege, and an ephemeral workspace. Personal Google AI subscription does not itself provide unattended API/CI credentials.
- **GPT/CTO**: committed code reviews and acceptance evidence. This ChatGPT conversation does NOT run unattended simply because it remains open.
- **PM**: prioritizes, authorizes intentional loss of unsaved changes, provider/cost setup, and Production release.

## Safe handoff lifecycle

    RUNNING (Co owns a lease)
      -> BLOCKED_CHECKPOINT (quota/outage; previous writer ownership retained)
      -> HANDOFF_READY (verified clean Git checkpoint and previous worker stopped)
      -> CLAIMED (Gem obtains unique lease through durable atomic CAS)
      -> RUNNING -> REVIEW_PENDING -> ACCEPTED (CTO gate)
                                     -> REWORK -> HANDOFF_READY

- Lease expiration alone does not prove a cloud worker has stopped. Never automatically replace a still-running or unknown-status writer.
- Use atomic compare-and-swap over a durable, authorized store; do not treat a new GitHub Issue comment, frontend flag or a plain task label as a lock.
- Provider launch failure *after* durable claim is ambiguous. Keep the claim and reconcile, never automatically spawn duplicate workers.
- One writer per task and development branch. Never force-push over another engineer's commit. Review names an exact SHA.
- No tokens, provider responses, private diffs or sensitive business data may be posted to public CI logs.

## Current Issue #45 — four uncommitted files

**Safe A (preferred):** when Co usage resets, resume the same Codex Cloud task. Co commits changes to its isolated review branch and reports clean worktree + exact GitHub SHA. Only after confirming Co stopped can Gem claim.

**Safe B (explicit PM only):** PM acknowledges discarding Co's four *uncommitted* edits, records the reason and confirms Co worker stopped. Gem may then use PR #50's last verified SHA. A quota warning does not authorize discarding work.

If neither condition holds, status remains BLOCKED_CHECKPOINT and Gem does not receive a fake handoff.

## Read-only validation and CI

    node --test tests/cloud-handoff-contract.test.mjs tests/cloud-handoff-dispatcher.test.mjs
    node labs/cloud-handoff/cli.mjs validate labs/cloud-handoff/examples/issue45-quota-blocked.json
    node labs/cloud-handoff/cli.mjs gate labs/cloud-handoff/examples/issue45-quota-blocked.json
    node labs/cloud-handoff/cli.mjs brief labs/cloud-handoff/examples/issue45-quota-blocked.json

The dedicated GitHub Actions workflow tests the native TaskFlow read-only bridge and GitHub @codex transport using mocked HTTP, and generates a read-only handoff brief and gate result artifact. It calls NO AI providers and stores NO new credentials.

## Further gates — NOT yet implemented

1. Approve & implement actual CAS/lease backend using TaskFlow's authorization, or isolated GitHub refs (never a second Task database). This candidate's injected CAS is only a mock/test.
2. Verify documented Codex Cloud programmatic create/monitor/resume for the *actual* published zhuge-ai-os environment; environment ID catalogs can differ between CLI and the Codex app. Never scrape internal web session endpoints or deploy ChatGPT cookies/tokens.
3. Verify Gemini CLI headless with separately approved, cost-bounded and secure cloud identity. A Google subscription does not guarantee a zero-cost API quota.
4. Wire native TaskFlow Issue/Agent/Run UX via the proper app-owned API boundary, not direct public-schema DML or a pretend registered Runtime.
5. Run a real cloud E2E with permission checks, competing writers, quota exhaustion, checkpoint, stale revision, rollback and provider revocation; only then seek separate Production GO.

This Review branch has NOT started any cloud AI job, moved main, enabled paid services, installed Schema/Daemon or deployed Production.

## GitHub CAS adapter — candidate, not connected to Production

The server-only [github-cas.mjs](github-cas.mjs) can read an isolated handoff JSON object from a dedicated review ledger branch and propose an atomic GitHub Contents compare-and-swap (old blob SHA). Before PUT it rechecks the live *code branch* SHA; a lost race (409/422) never launches another provider. The transport takes a short-lived server GitHub token only, which must never be embedded in browser code or stored in the manifest. A separate cloud authorization layer still must verify the claimed actor, ledger branch identity and worker-stop receipt. CI uses simulated GitHub HTTP responses only and never writes a live lease. This is an opt-in backend adapter, not a new GitHub Actions bot with write privileges.

## Phase 2 slice: TaskFlow → GitHub → Codex (Review-only, .9.49)

**Actual verified entry:** PM created a legacy Codex Cloud environment in the official UI named `zhuge-ai-os-github`, bound to `QQweasdzxc/zhuge-ai-os`. One authorized GitHub `@codex` PR comment on Draft PR #52 started an actual Codex Cloud read-only task, thread `01a13ee3-8cb4-7e81-9cac-b26a6cebf570`. Provider returned correct PR HEAD SHA `738690a3d19d453d250470aa5a60c02184b64989`; worktree clean. Evidence: https://github.com/QQweasdzxc/zhuge-ai-os/pull/52#issuecomment-6188911571 . Actual environment ID/name not exposed; GitHub CLI in the provider job was unauthenticated, Issue #51 complete body could not be directly read. **These are known limits, not guessed away.**

### This candidate actually adds source and offline tests

- [taskflow-bridge.mjs](taskflow-bridge.mjs) performs read-only `GET /api/issues/{uuid}/?workspace_id={uuid}` through TaskFlow's **existing workspace-authenticated endpoint**, using an already-authorized server-side bearer principal, not direct SQL. Checks exact native UUID, project, workspace, revision and non-terminal issue status/category. Rejects missing native map and duplicate.
- [taskflow-codex-dispatch.mjs](taskflow-codex-dispatch.mjs) requires the native TaskFlow Issue to exist, approved server-side PM scope, and exact issue revision before running existing single-writer, old-agent-stop, Git HEAD and CAS protocol. **No TF API write is implemented** — do not claim native Run/Agent registration.
- [codex-github-mention.mjs](codex-github-mention.mjs) builds a bounded `@codex` PR comment payload and transports it through the official GitHub Issues comments API using a server-only authorized GitHub token. **writeEnabled defaults OFF**; the CI test simulates POST and never actually writes GitHub or invokes AI. It rechecks PM approval and exact live PR HEAD.
- A GitHub 201 comment is **PENDING_PROVIDER_ACK**, not RUNNING or a verified Codex task ID. The dispatcher remains CLAIMED, does not auto-retry, and needs a separately verified bot thread ID/receipt before an actual TF Run status update. A bot Issue-comment near the triggering comment is not by itself cryptographically linked to a dispatch request; exact secure reconciliation design remains open.
- [tests/cloud-handoff-taskflow-codex.test.mjs](../../tests/cloud-handoff-taskflow-codex.test.mjs) covers native TaskFlow GET path, auth, wrong workspace/project, stale revision, custom unresolved statuses, PM denial, safe comment payload, CAS race, disabled transport, PR SHA drift and ambiguous failure.

### Remaining mandatory gates before any TaskFlow auto-dispatch

1. Native TF human PM session / delegated service permission verified against TaskFlow's real workspace role. The read bridge must run only as a backend and obtain identity through TaskFlow's existing Auth; never stash human bearer in a public frontend or GitHub workflow.
2. A real durable, access-controlled CAS ledger + seeded TaskFlow Issue mapping + secure lease generation and stop evidence; current GitHub CAS adapter is only HTTP-mocked. A GitHub comment MUST NOT fire before CAS commits.
3. Explicit per-task PM approval, authorized GitHub App installation identity and non-Production dry-run with isolated tasks; do not reuse this ChatGPT connector's private credentials or assume an app token is automatically available inside TaskFlow.
4. Correlate official Codex bot ACK to the exact dispatch receipt/approved SHA/task and update TF native Run via sanctioned API only. The prior bot returned a task/thread ID but no environment ID; verify provider status and prevent duplicate writes. No default re-dispatch on silent timeout.
5. Gemini requires its own separate cloud runner identity/usage ceiling and a complete cancellation/rollback E2E. No Gemini token or new service is installed here.

**Nothing in .9.49 is deployed or calls the live TaskFlow API or Codex provider.** GitHub CI uses fake HTTP responses and no provider/billing secrets. Production and main remain untouched.

## Phase 3 candidate — official Codex ACK correlation (.9.50)

**The official GitHub mention succeeded on a previous real, single-authorized PM run** (see PR #52 bot proof above), but the bot did not provide a machine-verifiable dispatch nonce in its report. Historical evidence CANNOT be retroactively treated as a fully correlated acknowledgement.

This candidate adds a **future dispatch protocol** without launching any new agent:

- **Durable 128-bit dispatch ID:** a trusted coordinator must securely generate a unique lower-case 32-character random hex value. It is written into the existing durable GitHub/TaskFlow CAS manifest in the `CLAIMED` revision **before** posting a PR comment; no process-local-only nonce and no reuse for Gem. CI uses a deterministic fake ID; Production entropy generation and dedicated CAS ledger remain a release gate.
- **Explicit reply contract:** `codex-github-mention.mjs` includes the nonce plus the exact Git SHA and asks the official Codex bot to begin its response with a strict `ZHUGE_CODEX_ACK_V1` structured HTML comment. If Codex does not echo the marker, the status remains `PENDING_PROVIDER_ACK`; never hallucinate a thread ID.
- **Authenticated, read-only reconciliation:** `codex-ack-reconciler.mjs` GETs the originally posted comment, the entire bounded GitHub PR comment history, and the current PR through the official GitHub REST API using a **server-only read credential**. It rejects any altered request receipt, wrong PR, wrong actor (`chatgpt-codex-connector[bot]` must have GitHub `Bot` identity), stale timestamp, unmatched nonce, wrong checkpoint SHA, duplicate claims, incomplete pagination, or changed PR HEAD. No webhook body by itself is trusted.
- **Status semantics:** a unique match returns `PROVIDER_ACK_OBSERVED` or `PROVIDER_BLOCKED_OBSERVED`, *not* `RUNNING`. The text is a **bot-reported statement**, not cryptographic proof of provider activity, and may not mark TaskFlow Run started until a separate trusted native API write + durable revision/lease + provider verification gate. Conflicting evidence stays quarantined. This code does not invoke an external AI.
- New negative / adversarial tests cover spoofed bots, same nonce with wrong SHA, duplicate valid replies, 403, 500-comment pagination cap, wrong scope, missing marker, forged request, and PR SHA drift. No secrets, extra subscriptions, or production changes.

**Open authorization requirements:** do not enable GitHub comment writes automatically. Need legitimate TaskFlow server identity and workspace permission, PM task-scoped approval, server GitHub App installation credential with least privilege, confirmed durable CAS + receipt persistence, bot report polling policy/rate bound, native Run update contract, provider status validation and cancellation handling. GitHub PR comments are not a substitute for TaskFlow authority. No auto-dispatch/auto-failover until an explicitly approved live isolated E2E.
