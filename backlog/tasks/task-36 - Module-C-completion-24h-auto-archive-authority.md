---
id: TASK-36
title: Module C completion 24h auto-archive authority
status: In Progress
assignee:
  - '@Co'
created_date: '2026-10-02 12:19'
updated_date: '2026-10-02 12:30'
labels:
  - module-c
  - backend
  - qa
dependencies: []
priority: high
type: feature
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Establish one shared server-side Module C completion/archive authority. Tasks entering the canonical completion workspace record their latest entered_completion_at and are archived after 24 hours, with re-entry reset, idempotent archive transition, canonical system audit, and cross-adopter coverage. Keep archive distinct from delete and preserve existing permissions, history, reorder, and drag/drop behavior. Source and local Developer QA only; no Cloud apply, deploy, push, PR, or merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every Module C adopter uses the canonical completion timestamp and 24-hour archive rule
- [ ] #2 Leaving completion cancels the prior countdown and re-entering completion starts a new 24-hour window
- [ ] #3 Server-side execution is available through the canonical backend scheduler mechanism and is idempotent under rerun/concurrency
- [ ] #4 Archive preserves task data, history, evidence, attachments, and audit; it never deletes
- [ ] #5 WorkTodo, AI Board, GAS/Procurement, and another Module C fixture pass boundary and cross-adopter tests
- [ ] #6 Targeted and full source/browser QA are 0 FAIL, with no Cloud or remote mutation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Freeze the verified Current State at main/a0e7df39 and document the effective Module C completion/archive migration chain, including the retired 48h history, published 24h policy, completion/reopen writer, instance-scoped reconciler, optional completion designation, scheduler, and legacy WorkTodo route retirement. 2. Preserve the existing single C authority; add only task-scoped contract/behavior coverage for 23h59/24h, completion re-entry reset, leaving-completion cancellation, archive-only/idempotent transition, System audit, and WorkTodo/AI Board/GAS/C-Mother adopter routing. 3. Produce isolated RCA, authority, runtime evidence, and QA summary artifacts that separate source/developer evidence from unverified live Cloud/PM runtime gates; do not apply migrations, change product data, or modify Investment/Lab/UI. 4. Run targeted Module C/completion/archive tests, full Node regression, browser regression, syntax/diff checks; record exact PASS/FAIL/SKIP and commit locally only with remote state unchanged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Developer QA 2026-10-02: audited existing Module C completion/archive authority; effective policy v2 is 86400 seconds (24h), source scheduler is pg_cron module-c-completion-archive-v2 at */5 with the shared private reconciler, and page-load reconciliation is only a safety net. Added tests/module-c-completion-auto-archive.test.js and isolated evidence under docs/30_QA/evidence/task-36-module-c-completion-archive/. Results: TASK-36 targeted 6 pass/0 fail/0 skipped; expanded targeted 76 pass/0 fail/0 skipped; Full Regression with local Chrome 804 pass/0 fail/0 skipped; Browser Regression 19 pass/0 fail/0 skipped plus standalone scripts. No Cloud migration/data, push, PR, deploy, or remote mutation. Current Cloud scheduler read-back and PM runtime acceptance remain pending.
<!-- SECTION:NOTES:END -->
