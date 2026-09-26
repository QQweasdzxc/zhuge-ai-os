# Developer Closure Handoff Package

Status: **payload-ready / not written to the Board**

This package prepares the legal evidence and transition payload for the
Developer-completable slices requested in the closure pass. It does not claim
that a GPT Review, Cloud migration, Edge deployment, provider activation, or
human Runtime QA has occurred.

## Canonical handoff rule

Each task must be claimed through the authenticated Co lifecycle first. The
payload is then submitted through the existing engineering-transition / review
path with the active canonical claim token. No task state, workspace, assignee,
claim, or activity row is written by this package.

Required evidence fields are:

```json
{
  "operation": "engineering_review",
  "review_state": "pending",
  "next_gate": "gpt",
  "evidence_note": "<bounded developer evidence summary>",
  "regression_note": "<targeted and full regression result>",
  "regression_ref": "<checked-in evidence path or candidate manifest>",
  "claim_token_source": "active_authenticated_co_claim"
}
```

The actual token is never stored in this file. The canonical runtime resolves
it from the active claim. A failed, expired, wrong-actor, or missing claim must
remain fail-closed.

## Task matrix

The machine-readable source is
`tools/governance/developer-completion-evidence.json`. It lists each task's
Developer status, evidence paths, remaining human-only gates, and legal
handoff shape for TASK-086, 087, 088, 093, 094, 097, 098, 099, and 100/101.

## Current shared gates

- Browser CI is now repeatable through `.github/workflows/browser-regression.yml`
  with Playwright Chromium and Desktop/Mobile coverage.
- Supabase security remediation is a conditional candidate only; it is not
  applied to Production. Cloud catalog/RLS/caller read-back remains required.
- Deployment readiness is dry-run by default. `--apply` fails closed and
  explicitly requires a human deployment gate.
- TASK-094 has no Edge entrypoint in this source slice; its protected server
  host and LINE credential injection remain a human runtime gate.
