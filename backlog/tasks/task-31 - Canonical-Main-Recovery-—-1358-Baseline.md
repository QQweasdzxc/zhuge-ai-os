---
id: TASK-31
title: Canonical Main Recovery — 1358 Baseline
status: In Progress
assignee:
  - '@Co'
created_date: '2026-10-01 06:57'
labels: []
dependencies: []
priority: high
type: chore
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reconstruct a local-only canonical Zhuge AI OS source candidate from exact known-good commit b9e64f4a829a62878acf60a7f2c492e7253842a (20260929-1358), selectively applying verified Repo Hygiene and Lab Separation without using the bad main commit 6553f21e1daeb97f76795066505f23cf7137b0e9 as a baseline. GitHub remains read-only; no push, PR, merge, deploy, release, tag, Cloud or Product Data mutation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recovery branch is based exactly on the 20260929-1358 Git commit.
- [ ] #2 The AI Board browser regression passes 10 consecutive times with readiness-based synchronization and no weakened product assertions.
- [ ] #3 The final canonical source retains production dependencies and isolates verified Lab source outside the Production tree.
- [ ] #4 Targeted and full regression have zero failures; browser and runtime evidence distinguish executed from unavailable checks.
- [ ] #5 Required recovery reports and a FullSource ZIP include build/version, exact commit, manifest, file count, QA summary and SHA256.
- [ ] #6 main and origin/main remain unchanged; GitHub receives no mutation; recovery worktree is clean at stop.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce the sole AI Board browser regression five times on the cleanup candidate and capture per-run evidence. 2. Identify and minimally correct deterministic test-readiness or proven source regression; verify ten consecutive targeted passes. 3. Create a local recovery branch from exact 1358 commit and apply only verified hygiene/lab changes, preserving all runtime dependencies. 4. Run targeted, full, browser, static-path, desktop/mobile and available authenticated production smoke checks; record unavailable gates truthfully. 5. Produce canonical diff review, required recovery documents, manifest, FullSource ZIP and SHA256; verify identity and clean working tree without any remote mutation.
<!-- SECTION:PLAN:END -->
