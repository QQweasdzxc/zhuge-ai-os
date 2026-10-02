---
id: TASK-34
title: Module C shared workspace reordering across consumers
status: In Progress
assignee:
  - '@Co'
created_date: '2026-10-02 04:13'
updated_date: '2026-10-02 04:29'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repair the shared board workspace/column reordering experience so every active workspace, including the completion workspace and custom workspaces, can be reordered consistently across Module C consumers. Preserve board-instance isolation, existing authorization, immutable WorkTodo workspace identity, and all task/workflow/product data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All active workspaces in the current board can be reordered, including completion and custom workspaces.
- [ ] #2 All Module C consumers use the same board-instance-scoped reorder authority; no consumer-specific direct workspace sorting path is used by formal runtime.
- [ ] #3 The shared RPC accepts exactly the active workspace set for one board instance, rejects duplicates, omissions, inactive or cross-instance IDs, and preserves authorization and WorkTodo identity guards.
- [ ] #4 Targeted and full regression tests pass; no Cloud, product data, GitHub remote, or deployment mutation occurs.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Trace all Module C workspace reorder callers and the board_instance_reorder_workspaces trigger contract. 2. Update the shared drag eligibility and canonical RPC migration so the completion workspace is reorderable and WorkTodo sort-only updates pass through the existing guarded authority. 3. Add targeted coverage for complete ordering, instance isolation, WorkTodo trigger context, and all consumers. 4. Run targeted and full regression; verify no product-data, Cloud, remote, or deployment mutation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current implementation: Shared Golden Master now permits reordering every active Module C workspace, including Completion; WorkTodo adapter uses the same board-instance reorder capability as AI Board, C Template, and Procurement; migration 20261002041546_c_shared_workspace_reorder_guard.sql adds complete-order validation and the transaction-local WorkTodo sort-only trigger context while preserving authenticated board-instance authorization. Verification: targeted 24/24 PASS; full node regression 774 PASS / 0 FAIL / 11 browser-dependent skips; syntax and diff-check PASS. Browser regression could not start because no Chromium executable is configured. Cloud migration/source deployment and live authenticated Runtime QA remain NOT RUN; no Cloud/Product Data mutation, commit, push, or deploy.
<!-- SECTION:NOTES:END -->
