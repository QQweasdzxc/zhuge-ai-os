---
id: TASK-38
title: Global shared header compact and workspace retained-count clarity
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-03 09:36'
updated_date: '2026-10-03 09:50'
labels: []
dependencies: []
type: bug
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PM authorized shared Header geometry convergence and explicit current/history/retained workspace counts. Read-only Production archive RCA for TASK-079; preserve canonical delete fail-closed and all history. No push, deploy or Production mutation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Formal Shared Shell adopters have compact desktop/mobile headers and primary controls >=44x44.
- [x] #2 Shared workspace projection distinguishes current/history/retained totals, including search filtering, and historical deletion wording identifies retained work codes.
- [x] #3 Archive function/scheduler/source/activity RCA is recorded without modifying Production data; semantic or DB changes require PM decision.
- [x] #4 Targeted, Full Regression and official Browser Regression pass without skips or weakened assertions.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Preserve fetched origin/main baseline. 2. Converge shared shell geometry and remove competing geometry. 3. Extend existing board read projection and shared runtime count/delete wording. 4. Record archive-detach RCA and decision gate. 5. Run adopter/browser and regression QA; local commit, backup artifacts and HARD STOP for review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PM confirmed leaving Completion cancels countdown. Prepared existing detach RPC function-only migration; no Cloud apply/backfill. Header: 18 formal routes x four widths, Desktop 74px/narrow with actions128px, controls>=44x44. Counts: current/history/retained and historical delete wording, zero writer calls in localhost click QA. Targeted25/25; count conformance9/9; isolated Postgres eight case groups PASS; Full841/841 and official Browser31/31 plus five standalone PASS, zero skipped. One obsolete wording assertion replaced with exact PM-required historical message and shared guard assertions; no other assertions removed/weakened. Source identity and diff PASS. Runtime/Cloud fix, GPT/CTO review and promotion remain pending; keep In Progress at HARD STOP. Evidence: docs/qa/global-header-workspace-count.
<!-- SECTION:NOTES:END -->
