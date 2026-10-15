# Zhuge AI OS — Cloud Handoff v1 (Issue #51)

**Candidate component:** 0.9.0-alpha.9.47 / Build 20261015-1402.
**Status:** Isolated source and CI review only. NOT TaskFlow native Runtime, NOT deployed, and NOT a Codex/Gemini connection. Production remains .9.45. #45 .9.46 / Draft PR #50 remains on hold.

## Why this exists

At the end of Codex Cloud Issue #45, Co exhausted the usage window with **four modified files visible only in its cloud worktree**. Last verified GitHub PR #50 SHA: 199ea823af0692ca99e222b024ee3238cbc3a9fc. There is NO proof the later four edits reached GitHub. A second engineer MUST NOT assume they did.

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

The dedicated GitHub Actions workflow generates a read-only handoff brief and gate result artifact. It calls NO AI providers and stores NO new credentials.

## Further gates — NOT yet implemented

1. Approve & implement actual CAS/lease backend using TaskFlow's authorization, or isolated GitHub refs (never a second Task database). This candidate's injected CAS is only a mock/test.
2. Verify documented Codex Cloud programmatic create/monitor/resume for the *actual* published zhuge-ai-os environment; environment ID catalogs can differ between CLI and the Codex app. Never scrape internal web session endpoints or deploy ChatGPT cookies/tokens.
3. Verify Gemini CLI headless with separately approved, cost-bounded and secure cloud identity. A Google subscription does not guarantee a zero-cost API quota.
4. Wire native TaskFlow Issue/Agent/Run UX via the proper app-owned API boundary, not direct public-schema DML or a pretend registered Runtime.
5. Run a real cloud E2E with permission checks, competing writers, quota exhaustion, checkpoint, stale revision, rollback and provider revocation; only then seek separate Production GO.

This Review branch has NOT started any cloud AI job, moved main, enabled paid services, installed Schema/Daemon or deployed Production.
