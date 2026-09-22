---
id: TASK-23
title: 'RED #5 Approved User WorkTodo Self-Provisioning'
status: In Progress
assignee: []
created_date: '2026-09-16 09:14'
updated_date: '2026-09-16 09:40'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the existing board_provision_c_consumer_v2 as the sole C application provisioning contract so an approved general user can self-provision only their own WorkTodo. Resolve an existing personal Board before provisioning; create at most one independent Board, with the three approved default workspaces, no Workflow, and the existing complete shared WorkTodo runtime. Preserve the Creator/Owner WorkTodo instance and its data unchanged. Follow PM-approved Option A; no deployment or publish.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Approved non-Creator users can provision only their own personal WorkTodo through board_provision_c_consumer_v2; attempts to provision any other Consumer or access another owner’s Board fail closed.
- [ ] #2 First WorkTodo entry provisions exactly one Board Instance with independent stable identity, the three required workspaces, Workflow N/A, and Module C adoption; repeat entry, reload, and a fresh session resolve the same Board without duplication.
- [ ] #3 The personal WorkTodo uses the existing full shared WorkTodo/C runtime and existing features; no general-user-specific runtime or reduced capability is introduced.
- [ ] #4 The existing Owner WorkTodo Board, its seven workspaces, 35 cards, identities, and related data remain unchanged.
- [ ] #5 Regression covers authorization, idempotency, identity uniqueness, workspace setup, workflow N/A, data isolation, and existing Creator provisioning compatibility.
- [ ] #6 Build identity, full regression, candidate packaging, ZIP integrity, and PM Google Drive archive are verified; no deployment or publish occurs.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect current v2 provisioning SQL/source, WorkTodo boot and instance resolver, workspace keys/designations, tests, release/build rules, and PM Drive destination. 2. Add the self-only general-user branch to the existing v2 contract with server-derived stable identity and exact WorkTodo configuration; preserve Creator/Owner generic provisioning. 3. Wire WorkTodo entry to resolve the authenticated owner’s personal Board before provisioning, then start the existing shared runtime against that Board. 4. Add targeted authorization/idempotency/data-isolation tests and verify Cloud contract/read-back without modifying the existing Owner Board. 5. Run targeted and full regression, generate a new formal Build ID and clean commit per governance, package and integrity-check a new FullSource Candidate, save it to the PM Drive version-control folder, and stop without deployment/publish.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation evidence: added approved-user self-only resolution through the existing board_provision_c_consumer_v2 contract; Cloud migration 20260916093500 applied and read back. Owner WorkTodo baseline remains Board 0b2b5c4e-6767-4792-a97a-d2ddf42e60da with 7 workspaces and 35 cards; no personal Board or test data was created. Full automated regression: 568 PASS, 0 FAIL, 6 browser UI SKIP because Chrome/Chromium is not configured. Authenticated PM Runtime QA remains pending; no deployment or publish.
<!-- SECTION:NOTES:END -->
