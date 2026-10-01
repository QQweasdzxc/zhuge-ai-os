---
id: TASK-30
title: Canonical Source Cleanup and Lab Separation
status: In Progress
assignee: []
created_date: '2026-10-01 05:46'
labels: []
dependencies: []
priority: high
type: chore
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reconcile the known-good 20260929-1358 FullSource identity, local repository history, and current repository state; classify every root path; move only proven isolated experimental source out of the production source tree; preserve unknown or runtime-referenced paths; document dependency and QA evidence. GitHub remote is read-only for this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Canonical baseline and every repository root path are documented with evidence and a production/lab/duplicate/archive/generated/unknown classification.
- [ ] #2 Production imports and runtime dependencies are audited before any move or removal; unknown paths are preserved.
- [ ] #3 Lab roots and registry boundaries are documented and no Lab source is bundled into the production build.
- [ ] #4 Duplicate removal is limited to verified identical or unreferenced paths, with hashes and reference searches recorded.
- [ ] #5 Final hygiene and dependency audit docs are delivered; source changes pass relevant tests and working tree is clean after a local commit.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reconcile the exact 1358 baseline commit with the local repository, deletion commit, and preserved candidate branch. 2. Inventory every root path and search runtime/build/import references for experimental directories. 3. Verify existing Lab contents and registry boundaries; classify Genspark and SkyEye sources without editing their source. 4. Remove or relocate only paths proven safe, preserving archives outside AIOS. 5. Run targeted and relevant regression checks; produce audit documents and final tree evidence. 6. Create only a local commit and optional local QA package; do not mutate GitHub remote or deploy.
<!-- SECTION:PLAN:END -->
