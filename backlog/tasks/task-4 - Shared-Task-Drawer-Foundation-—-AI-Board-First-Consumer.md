---
id: TASK-4
title: Shared Task Drawer Foundation — AI Board First Consumer
status: In Progress
assignee:
  - '@Co'
created_date: '2026-08-16 02:21'
updated_date: '2026-08-16 03:17'
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
- [x] #1 AI Board Drawer 使用可供未來 WorkLog adapter 重用的 shared shell，維持 Desktop 左右雙欄與 Mobile responsive layout。
- [x] #2 左側呈現 Task identity、metadata、需求內容、使用情境、Checklist、Attachment / Artifact 與 AI Board domain sections。
- [x] #3 右側以「💬 工作進度紀錄」呈現人工 note、system activity、status/workspace/evidence/audit activity，且保留 Canonical Audit / Evidence。
- [x] #4 Engineering Evidence 保留為唯讀工程狀態；PM 只面對一個明確的「PM 驗收通過」操作，不新增重複人工 gate。
- [x] #5 WorkLog 不修改 Runtime 或資料；完成 compatibility / field mapping assessment，確認日期與 Calendar Sync 不進入 AI Board。
- [x] #6 Automated regression、browser regression、Architecture Guardrail QA 與 Full Candidate packaging 完成，Build Identity 與 Artifact Created At 一致，且不建立 PM Accepted Baseline。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add generic shared/components/task-drawer.js and shared/theme/task-drawer.css for a domain-neutral responsive two-column drawer; no Cloud, domain, or RPC logic.
2. Refactor AI Board openTaskDetail to adapt existing canonical task, checklist, activity, movement, artifact, notes, and evidence data into the shared drawer; keep controlled RPC callbacks and expose one PM acceptance action while engineering evidence remains read-only.
3. Add docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md for WorkLog field mapping only; do not change WorkLog runtime, data, migration, or Calendar Sync.
4. Add shared drawer, AI Board, browser/static, and architecture guardrail regression coverage; verify existing Free Workspace, Archive, MFA, and read boundaries.
5. Package a new full Candidate from the QA-passing working-tree snapshot with a fresh Asia/Taipei Build ID and verify extracted identity, completeness, integrity, content match, and regression before PM Runtime QA.

6. PM QA correction: separate primary Task Checklist (only when canonical task-checklist rows exist) from compact Engineering Evidence summary; keep full evidence collapsed under 工程詳細資料 and retain one PM Acceptance action.
7. PM QA correction: present canonical human notes plus visually distinct System Activity timeline; add a disabled composer when no browser-operational PM-authorized note write bridge exists. Do not add storage, table, RPC, or direct DML.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: node --test tests/*.test.js from working tree and extracted Candidate = 132 pass / 0 fail / 4 skipped; 4 skipped are existing external-Chrome fixtures without configured executable. In-app browser Desktop fixture PASS for shared two-column Drawer, canonical Activity, single PM Acceptance action, and Archive read-only; mobile 390x844 smoke PASS. Candidate: 20260816-1034-Zhuge_AI_OS-v0.9.0-alpha.9.13-SharedTaskDrawer-AIBoard-FullCandidate.zip; extracted ZIP integrity/source completeness/content match PASS; Build identity and Artifact Created At minute match PASS. WorkLog remains assessment-only; no Cloud/Schema/RPC/RLS/Auth/MFA/UUID changes.
<!-- SECTION:NOTES:END -->

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

author: @Co
created: 2026-08-16 02:35
---
Developer QA and Candidate packaging complete; handoff is now PM Runtime QA.
---

author: @Co
created: 2026-08-16 03:17
---
PM QA not accepted: started combined Checklist/Evidence presentation correction and human Progress Note/System Activity presentation correction within the existing AI Board consumer.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Shared Task Drawer Foundation with AI Board as first consumer. Added domain-neutral responsive shared shell, AI Board adapter mapping, read-only Engineering Evidence with one PM Acceptance action, canonical Activity/Artifact presentation, and WorkLog compatibility assessment. Verified targeted/full regression and delivered append-only Full Candidate for PM Runtime QA; PM Accepted Baseline unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
