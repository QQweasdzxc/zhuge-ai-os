---
id: TASK-22
title: Approved General User Shared Navigation Visibility
status: Done
assignee:
  - '@codex'
created_date: '2026-09-16 07:54'
updated_date: '2026-09-16 08:02'
labels:
  - navigation
  - frontend
  - auth
dependencies: []
priority: high
type: bug
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Approved general users must use the existing Shared Navigation Shell. The Shell currently suppresses itself for non-Creators because navigation template adoption defaults to disabled for users without Creator-only preferences. Add only the PM-approved general-user menu visibility projection while preserving Creator navigation and all existing backend authorization boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An approved general user receives the existing shared shell without requiring Creator-only navigation adoption preference.
- [x] #2 General-user navigation visibly includes WorkLog, WorkTodo, Knowledge, and Settings, and hides Procurement, Investment, Control Console, and Management.
- [x] #3 Creator/Owner navigation remains unchanged when Creator capability resolves successfully.
- [x] #4 Navigation visibility changes do not alter App Access, Creator authority, backend permission, data access, or module behavior.
- [x] #5 Regression tests cover general, Creator, and unresolved/adoption-gated navigation behavior.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a minimal presentation-only visibility projection driven by the existing Creator resolver result. 2. Allow resolved non-Creator users to mount the canonical Shared Navigation independently of Creator-only adoption preferences. 3. Add focused regression tests for visibility and mount semantics. 4. Run targeted and full regression, then create a new governed Build ID and FullSource Candidate without deployment or publish.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current evidence: WorkLog renders its shell only after canonical App Access APPROVED; shared navigation separately uses Creator-only template adoption preferences, and non-Creators receive an empty default policy. No general-user menu visibility capability exists. Existing shared Creator resolver is the canonical identity input; no Cloud/RLS/RPC change is required.

Developer QA evidence: targeted shared-navigation/template-adoption/app-access tests 18 pass, 0 fail. Full regression: 629 total, 621 pass, 0 fail, 8 browser tests skipped because no Chrome/Chromium executable is configured. Syntax checks and git diff --check pass. Source-only navigation presentation change; no Cloud, Product Data, or backend authorization mutation. PM Runtime QA remains pending deployment.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the PM-approved general-user visibility projection in the existing Shared Navigation Shell. Resolved non-Creator sessions mount the shared shell independently of Creator-only template adoption preference and see WorkLog, WorkTodo, Knowledge, and Settings; Procurement, Investment, Control Console, and Management are hidden. Creator navigation and the WorkLog App Access APPROVED gate remain unchanged. Targeted tests 18/18 pass; full regression 621 pass, 0 fail, 8 browser skips (browser executable unavailable). PM Runtime QA is pending deployment of the new FullSource Candidate.
<!-- SECTION:FINAL_SUMMARY:END -->
