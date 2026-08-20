---
id: TASK-6
title: WorkTodo → Shared Task UX Integration — Phase 1
status: In Progress
assignee: []
created_date: '2026-08-20 07:46'
updated_date: '2026-08-20 08:04'
labels:
  - worktodo
  - shared-ux
  - adapter
dependencies: []
modified_files:
  - modules/worklog/components/worktodo-task-adapter.js
  - shared/components/task-card.js
  - shared/theme/task-card.css
  - modules/worklog/index.html
  - modules/worklog/worklog-app.js
  - modules/worklog/worklog.css
  - app/Board/ai/index.html
  - app/Board/ai/board-runtime.js
  - tests/worktodo-task-adapter.test.js
  - tests/shared-task-drawer.test.js
  - tests/ux-polish.test.js
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
將 WorkTodo 接入既有 Shared Task UX，保留 WorkTodo Canonical Data、DataService/Repository/RLS 與 Domain semantics；本階段不建立第二套 Task Card/Drawer/Progress UX，不修改 Schema/RPC/RLS。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 WorkTodo 使用 Shared Task Drawer shell，不再新增平行 Task Drawer implementation
- [x] #2 Title、Note、Status、Progress、Priority、Pin、Due Date、Completion 與 Work Journal 可由 Adapter 映射至 Shared UX
- [x] #3 Work Journal 使用 Shared Progress Timeline presentation，寫入仍走既有 DataService/Repository path
- [x] #4 Shared component 不直接讀寫 WorkTodo Cloud，WorkTodo capability gaps 不使用 workaround
- [x] #5 Adapter、responsive 與 regression tests 通過後才進 QA Runtime
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 建立 WorkTodo normalized view model / capability contract；2. 接入 Shared Task Drawer 與 Work Journal Timeline；3. 保留既有 DataService/Repository writes；4. 補齊 adapter/responsive/regression tests；5. 執行 QA Runtime smoke 與 dead-code audit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PM 已核准 Implementation Audit PASS，可直接開始 Phase 1；Pre-WorkTodo Integration PM Accepted Baseline 保持不變。

Phase 1 implementation completed: WorkTodo adapter/view model and capability flags, Shared Task Card/Drawer consumer integration, Work Journal shared timeline mapping, existing DataService/Repository write paths preserved, and legacy renderer consumer audit completed. Targeted: 25 passed / 0 failed / 0 skipped. Full automated regression: 191 passed / 0 failed / 4 skipped (browser tests require an available Chrome/Chromium executable). QA Runtime deployment and Live QA remain pending.
<!-- SECTION:NOTES:END -->
