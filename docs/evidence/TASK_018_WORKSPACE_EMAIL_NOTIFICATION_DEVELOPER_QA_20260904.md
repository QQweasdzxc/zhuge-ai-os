# TASK-18｜Module C Workspace Email Notification v1 — Developer QA Evidence

## Release checkpoint

- Product Version: `0.9.0-alpha.9.13`
- Runtime Build: `20260904-2351`
- QA date: `2026-09-04` (Asia/Taipei)
- Cloud project: `QQ's Project` (`lenpbbhwxyyfwgvjcozf`)
- Board Instance: `38d8d4b1-6d01-4d58-835b-b2beb61fc6b9`
- Test card: `GAS-001` (`a670ecfc-a2f8-4a0e-9f01-7893e89b13f4`)
- Test recipient: `qq.1025@gmail.com` (PM's Resend account email)

This is Developer QA evidence only. PM QA and Product Acceptance remain downstream
gates.

## Cloud and Runtime E2E

1. **Workspace Settings Save / Read-back — PASS**
   - The existing C workspace settings RPC persisted `進行中` notification settings.
   - `enabled=true`, assignee/reporter notification disabled, one custom recipient,
     and the approved subject/body templates were read back from Cloud.
2. **Reload / Re-login — PASS**
   - The authenticated Google session was re-established in the local formal-source
     runtime, and reload retained the logged-in state, existing C board, and GAS-001.
   - No localStorage settings fallback was used.
3. **Workspace Move — PASS**
   - `GAS-001` moved from `待辦` to `進行中` through the existing C board drag and
     controlled board-instance RPC path.
   - Cloud read-back: workspace `3cd2d6cd-75e6-4132-b7d9-c9d55c852aa7` (`進行中`).
   - Board Instance ID and card ID remained unchanged.
4. **Email Send — PASS**
   - `workspace-email-notification` returned HTTP 200.
   - Audit row `808` recorded `state=sent`, `recipient_count=1`, and Resend provider
     id `1ab4862d-e11a-4810-94d0-6a68b10ccd28`.
   - Idempotency key: `workspace-email-v1:807`.
5. **Audit — PASS**
   - Movement audit row `807` records the authoritative `待辦 → 進行中` transition.
   - Notification audit row `808` is linked to movement row `807` and retains the
     delivery result; no provider secret or token was exposed to the client.
6. **Idempotency — PASS**
   - A second call with the same `task_id` and target `workspace_id` returned
     `already_processed` with `delivery_id=808`.
   - No second notification audit row or second provider delivery was created.
7. **Data boundary — PASS**
   - No new card, board, workspace, Investment record, Opening Position, or
     Transaction was created or modified by this QA flow.

## Automated verification

- TASK-18 / shared C targeted suite: **18 passed / 0 failed**.
- Full Node regression: **365 passed / 0 failed / 6 skipped**. The six skips are
  browser-runner tests that require a configured Chrome executable; the authenticated
  C Runtime QA above covered the exercised browser path.
- Edge Function log: the move request and idempotency retry both returned HTTP 200
  on deployed Function version 3.
- Syntax checks and `git diff --check`: PASS at Product Completion review.

## Gate state

- Developer QA: **PASS**
- Product Completion review: **PASS**
- Release Identity Alignment: recorded in the Candidate Manifest.
- Candidate ZIP / SHA-256: recorded after packaging by
  `tools/release-governance.js`.
- PM QA: **READY FOR PM QA** only after the Candidate ZIP handoff; PM acceptance is
  not asserted here.
