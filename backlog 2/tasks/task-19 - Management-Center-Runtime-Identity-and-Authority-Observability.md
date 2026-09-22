---
id: TASK-19
title: Management Center Runtime Identity and Authority Observability
status: Done
assignee:
  - '@codex'
created_date: '2026-09-13 11:29'
updated_date: '2026-09-13 11:45'
labels:
  - management-center
  - observability
  - authority
dependencies: []
modified_files:
  - shared/components/template-management-center.js
  - shared/theme/zhuge-workspace.css
  - tests/management-runtime-observability.test.js
priority: high
type: enhancement
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the existing C-area Management Center consumer cards so operators can inspect evidence-backed runtime identity, board instance, writer authority, workflow/lifecycle capability, legacy status, adoption, and health without creating a second authority registry or changing runtime authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Management Center exposes evidence-backed runtime identity and authority details for C Mother, AI Board, WorkTodo, GAS, and Investment.
- [x] #2 WorkTodo clearly identifies C Shared Runtime, board 0b2b5c4e-6767-4792-a97a-d2ddf42e60da, C canonical single writer, NOT_CONFIGURED workflow, C Shared 24h lifecycle, retired legacy create authority, and formal entry.
- [x] #3 Health is not inferred from adopted/cloudEnabled alone; unavailable evidence renders Unknown or Not Available.
- [x] #4 Existing consumer-specific workflow and read-only capability differences remain intact, with no new writer, registry, migration, or product-data mutation.
- [x] #5 Targeted tests, full regression, syntax, diff check, and release preflight pass; PM Runtime/UX review remains separate.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reuse existing Template Management Center release/adoption read, BoardReadService.listModuleConsumers, createInstanceService().getAuthorityConformance(), and canonical Navigation route metadata; no new registry or writer. 2. Add a read-only evidence model that maps actual C Board Instances to C Mother, AI Board, WorkTodo, GAS, Investment, resolves release adoption by Cloud adoption key, and marks missing evidence Unknown. 3. Render compact expandable Runtime Identity / Authority details without changing existing template controls or consumer capability boundaries. 4. Add targeted source/model tests, run full regression, syntax, diff, and release preflight; keep PM Runtime QA and final packaging separate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current State Gate: Management Center currently reads only Template Adoption Policy and Module Release; it does not read Board Instance or Authority Conformance. Live Cloud has five active C instances (AI Board, WorkTodo, C Mother template instance, Investment, GAS), existing board_c_authority_conformance_check(uuid), board_instance_workflow_state, completion designation and module release records. The observability change will read those existing authorities only; no Cloud/Data mutation is planned.

Implemented read-only Runtime Identity / Authority observability using existing BoardReadService.listModuleConsumers, Board Instance getAuthorityConformance, Module Publish Service Cloud release/adoption, and canonical Navigation routes. No new authority registry, RPC, writer, schema, migration, workflow, lifecycle, or data mutation. Cloud read-back confirmed five active C Board Instances, published C release/adoption, authenticated Authority RPC, and completion designation contract. Validation: focused observability and related Management/C tests 28/28 PASS; full regression 479 total, 473 PASS, 0 FAIL, 6 SKIP because Chrome is unavailable; release-governance preflight PASS; syntax and diff checks PASS. PM Runtime/UX review and final packaging remain separate and pending.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added compact expandable Management Center Runtime Identity / Authority details for C Mother, AI Board, WorkTodo, GAS, Investment, and evidence-backed additional C instances. WorkTodo explicitly shows C Shared Runtime, Existing WorkTodo Same Data, its Board Instance identity, C Canonical Writer / Single Writer, NOT_CONFIGURED / N/A Workflow, C Shared / 24h lifecycle, retired Legacy Create Authority, and /app/Board/worktodo/. Health is green only with Authority + Runtime + Cloud adoption evidence; missing evidence is Unknown. Automated QA passed with six Chrome-dependent skips; PM Runtime/UX review remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
