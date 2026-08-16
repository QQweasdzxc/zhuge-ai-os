---
id: TASK-4
title: Shared Task Drawer Foundation — AI Board First Consumer
status: In Progress
assignee:
  - '@Co'
created_date: '2026-08-16 02:21'
updated_date: '2026-08-16 02:24'
labels:
  - ai-board
  - shared-ux
dependencies: []
references:
  - docs/RELEASE.md
  - docs/AI_BOARD_BATCH_2_SHARED_SHELL_DEVELOPER_QA.md
  - docs/KNOWLEDGE_WRITE_AND_PRINCIPLE_RECONCILIATION.md
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
建立一套可由 AI Board 先行採用的 Shared Task UX / Shared Task Drawer Foundation。Shared UI Component 與 Domain Model 分離；本 task 不修改 WorkLog Runtime、資料、Migration、Calendar Sync，不改 Auth、MFA、UUID、RLS、Schema、Cloud RPC 或 Governance lifecycle。WorkLog 僅做 compatibility / field mapping assessment；AI Board 完成後交 PM Runtime QA。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AI Board Drawer 使用可供未來 WorkLog adapter 重用的 shared shell，維持 Desktop 左右雙欄與 Mobile responsive layout。
- [ ] #2 左側呈現 Task identity、metadata、需求內容、使用情境、Checklist、Attachment / Artifact 與 AI Board domain sections。
- [ ] #3 右側以「💬 工作進度紀錄」呈現人工 note、system activity、status/workspace/evidence/audit activity，且保留 Canonical Audit / Evidence。
- [ ] #4 Engineering Evidence 保留為唯讀工程狀態；PM 只面對一個明確的「PM 驗收通過」操作，不新增重複人工 gate。
- [ ] #5 WorkLog 不修改 Runtime 或資料；完成 compatibility / field mapping assessment，確認日期與 Calendar Sync 不進入 AI Board。
- [ ] #6 Automated regression、browser regression、Architecture Guardrail QA 與 Full Candidate packaging 完成，Build Identity 與 Artifact Created At 一致，且不建立 PM Accepted Baseline。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add generic shared/components/task-drawer.js and shared/theme/task-drawer.css for a domain-neutral responsive two-column drawer; no Cloud, domain, or RPC logic.
2. Refactor AI Board openTaskDetail to adapt existing canonical task, checklist, activity, movement, artifact, notes, and evidence data into the shared drawer; keep controlled RPC callbacks and expose one PM acceptance action while engineering evidence remains read-only.
3. Add docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md for WorkLog field mapping only; do not change WorkLog runtime, data, migration, or Calendar Sync.
4. Add shared drawer, AI Board, browser/static, and architecture guardrail regression coverage; verify existing Free Workspace, Archive, MFA, and read boundaries.
5. Package a new full Candidate from the QA-passing working-tree snapshot with a fresh Asia/Taipei Build ID and verify extracted identity, completeness, integrity, content match, and regression before PM Runtime QA.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @Co
created: 2026-08-16 02:21
---
Co started formal Architecture Check and implementation within PM-approved Shared Task Drawer / AI Board First Consumer scope.
---

created: 2026-08-16 02:24
---
Formal architecture gate complete; implementation plan recorded for Shared Task Drawer Foundation / AI Board First Consumer.
---
<!-- COMMENTS:END -->
