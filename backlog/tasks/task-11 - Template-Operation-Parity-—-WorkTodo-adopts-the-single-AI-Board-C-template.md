---
id: TASK-11
title: Template Operation Parity — WorkTodo adopts the single AI Board C template
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-24 07:48'
labels:
  - golden-master
  - template
  - shared-ux
  - worktodo
  - attachments
dependencies: []
priority: high
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PM confirmed that AI Board is the sole canonical C template. WorkTodo must consume the same shared Golden Master with identical workspace operations. This follow-up covers the approved 16px visual spacing, progress-note attachment persistence and presentation, and parity of workspace reorder/rename controls. Preserve existing adapters, domain data boundaries, authenticated controlled Cloud paths, and the ONE Golden Master rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AI Board remains the only canonical C-template presentation source; WorkTodo renders the same shared runtime without a second template or consumer-specific presentation copy.
- [ ] #2 Work-progress records have a clear 16px visual gap, and AI Board New TASK spacing is visibly separated from its workspace header using the shared rule.
- [ ] #3 A progress note submitted with one or more files persists the files through the existing authenticated Storage/Repository path and displays an attachment indicator, image preview or file-type icon, filename, and delete control on that progress record.
- [ ] #4 WorkTodo supports the same workspace reorder and rename interactions as AI Board through an authorized controlled path; no UI-only fake success, localStorage source, service-role client, or RLS bypass is used.
- [ ] #5 Existing AI Board and WorkTodo domain data, login, MFA, RLS, and application scope remain intact; no domain records are changed by QA.
- [ ] #6 Desktop and mobile regression checks cover both AI Board and WorkTodo for the shared drawer and C-template operation surface.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the shared Golden Master, WorkTodo adapter, existing progress attachment Storage/Repository path, and workspace operation RPC/capability contract. 2. Implement the shared 16px spacing and progress attachment lifecycle using the existing controlled path. 3. Align WorkTodo workspace reorder/rename capabilities with AI Board without duplicating the C template or bypassing authorization. 4. Add focused regression coverage and run desktop/mobile runtime QA. 5. Commit the approved source change and report Cloud, domain-data, Git, and QA boundaries.
<!-- SECTION:PLAN:END -->
