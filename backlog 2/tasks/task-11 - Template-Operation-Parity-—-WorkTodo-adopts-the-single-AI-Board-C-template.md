---
id: TASK-11
title: Template Operation Parity — WorkTodo adopts the single AI Board C template
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-24 07:48'
updated_date: '2026-08-24 16:32'
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
PM confirmed that AI Board is the sole canonical C template. WorkTodo must consume the same shared Golden Master with identical workspace operations. This follow-up covers the approved 48px visual spacing, progress-note attachment persistence and presentation, WLTK terminology, and parity of workspace create/reorder/rename controls. Preserve existing adapters, domain data boundaries, authenticated controlled Cloud paths, and the ONE Golden Master rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AI Board remains the only canonical C-template presentation source; WorkTodo renders the same shared runtime without a second template or consumer-specific presentation copy.
- [ ] #2 Work-progress records have a clear 48px visual gap, and AI Board New TASK spacing is visibly separated from its workspace header using the shared rule.
- [ ] #3 A progress note submitted with one or more files persists the files through the existing authenticated Storage/Repository path and displays an attachment indicator, image preview or file-type icon, filename, and delete control on that progress record.
- [ ] #4 WorkTodo supports creator-authorized workspace create, reorder, and rename interactions through a controlled Cloud path; tasks can target custom WorkTodo workspaces, and the WorkTodo surface consistently uses WLTK terminology. No UI-only fake success, localStorage source, service-role client, or RLS bypass is used.
- [ ] #5 Existing AI Board and WorkTodo domain data, login, MFA, RLS, and application scope remain intact; no domain records are changed by QA.
- [ ] #6 Desktop and mobile regression checks cover both AI Board and WorkTodo for the shared drawer and C-template operation surface.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the shared Golden Master, WorkTodo adapter, existing progress attachment Storage/Repository path, and workspace operation RPC/capability contract. 2. Implement the shared 48px spacing and progress attachment lifecycle using the existing controlled path. 3. Align WorkTodo workspace create/reorder/rename capabilities with the canonical operation contract without duplicating the C template or bypassing authorization. 4. Keep TASK/WLTK labels scoped to their domain, add focused regression coverage, and run desktop/mobile runtime QA. 5. Commit the approved source change and report Cloud, domain-data, Git, and QA boundaries.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PM 最新視覺試用將共用 Shared Task Drawer 工作進度列表卡片間距由 20px 調整為 28px，卡片內距維持 16px，並保留統一邊界、附件、編輯、刪除與雙 Consumer 共用呈現。已同步更新 shared/theme/task-drawer.css 與 TASK-011/TASK-042 regression assertions；本輪待重新執行 targeted / full regression。
<!-- SECTION:NOTES:END -->
