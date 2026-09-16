---
id: TASK-21
title: Global Floating Hub + App Access Approval — Phase 1
status: In Progress
assignee: []
created_date: '2026-09-16 02:12'
updated_date: '2026-09-16 06:12'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the PM-approved Phase 1 for the shared Global Floating Hub and canonical Zhuge AI OS app-access application/review flow. Preserve existing C, Investment, WorkTodo, and Auth behavior while adding append-only access history, canonical access resolution, Creator-only review/note surfaces, Realtime Presence, and one shared shell-mounted floating hub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing four Google users retain access through explicit bootstrap evidence without modifying their product data.
- [ ] #2 New authenticated users can submit an append-only application and remain blocked from normal runtime while pending or rejected.
- [ ] #3 Creator/Owner can review applications and maintain private notes; ordinary users cannot read or write those notes.
- [ ] #4 All protected runtime data and privileged actions remain backend-authorized; direct URL/API access cannot bypass app approval.
- [ ] #5 One shared floating hub preserves existing assistant/time behavior and hides Creator-only actions from ordinary users.
- [ ] #6 Realtime presence is ephemeral and creates no durable activity or heartbeat history.
- [ ] #7 Focused tests and regression pass with no Product Data mutation.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add additive access-application history, current-status resolver, approved bootstrap evidence, Creator-only note boundary, and least-privilege RLS/RPC contracts. 2. Integrate the canonical access check into authenticated bootstrap/direct runtime gates without changing Google Auth or C/Investment authority. 3. Add one shared Global Floating Hub mounted through the existing shared shell and preserve existing assistant/time actions. 4. Add Management Center User Access Management and Realtime Presence using the approved existing authorities. 5. Add focused developer/browser tests, run read-back and regression, and report remaining PM Runtime QA.

6. Fix Runtime RED #3 by making the Hub assistant item an inline-open action: reuse the existing WorkLog compact assistant panel where that runtime is available, and provide an in-page embedded handoff for other shared-shell pages without changing top-level route; preserve standalone Chat route.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase 1 implementation completed in the formal worktree. Added canonical append-only App Access history/current resolver, creator-only review and private notes, approved-user bootstrap evidence, private Realtime Presence gateway, shared Global Floating Hub, Management Center User Access surface, and pre-runtime gates for normal web consumers. Supabase migration 20260916025649 was applied to the configured project; Product/C/Investment data remains unchanged. Developer QA: 615 total, 607 pass, 0 fail, 8 browser skips because no browser executable was configured. PM Runtime QA remains pending.

Runtime RED #3: replaced the Hub navigation link with an inline compact chat overlay that loads the existing WorkLog assistant panel in hub-embedded mode. The host page URL is unchanged; the standalone Chat route remains available. Focused QA: 9/9 pass; no Cloud or Product Data writes.
<!-- SECTION:NOTES:END -->
