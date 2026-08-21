---
id: TASK-7
title: System Template Management — AI Board Golden Master
status: Done
assignee: []
created_date: '2026-08-21 05:35'
updated_date: '2026-08-21 05:41'
labels:
  - system-template
  - shared-ux
  - ai-board
  - worktodo
dependencies: []
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在正式 WorkLog/控制台內提供「管理功能 → 系統模板」入口與可擴充的模板管理頁。空白 AI Board 是唯一 Golden Master；保留一套共享模板、AI Board 與 WorkTodo 兩個 Adapter、各自獨立的兩套 Domain Data。模板目錄與複製／套用能力只做受控的 Source/UI 預留，不新增未核准的 Cloud 寫入、Schema、RPC、RLS、GitHub 或部署變更。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 控制台的「管理功能」區顯示「系統模板」入口，點擊後可進入管理頁並可返回控制台。
- [x] #2 管理頁明確標示空白 AI Board 為唯一 Golden Master，且呈現一套模板、兩個 Adapter、兩套 Domain Data 的邊界。
- [x] #3 管理頁預留多模板目錄與複製／套用操作的架構，但複製與套用在未核准 Cloud 寫入前不得執行任何資料寫入。
- [x] #4 模板管理 UI 使用既有共享 Task Board／Task Card／Task Drawer 表面，不建立第二套平行任務 UX 或 Domain Data。
- [x] #5 完成自動化驗證、解壓完整性驗證與 SHA-256 驗證，並產出 append-only 更新版 ZIP。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 新增 presentation-only 的系統模板目錄契約，固定 AI Board Golden Master 與兩 Adapter／兩 Domain Data 映射。
2. 在控制台管理功能加入系統模板入口，並於 WorkLog 內新增模板管理頁與共享 Task Board 預覽。
3. 以 disabled 且明確標註待核准的複製／套用控制項預留未來多模板架構，不觸發 Cloud 寫入。
4. 新增目錄、入口、路由、共享表面與無 Cloud 寫入邊界測試，完成語法檢查與完整回歸。
5. 以實際 Asia/Taipei Artifact Created At 建立新的 append-only ZIP，完成解壓完整性與 SHA-256 驗證。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Source implementation complete. Added shared/components/system-template-catalog.js, Control Center system-templates route, WorkLog manager page, shared empty Task Board preview, responsive styling, README contract note, and regression coverage. Product Version remains 0.9.0-alpha.9.13; Runtime Build is 20260821-1340. Automated regression: 204 passed / 0 failed / 4 skipped; skipped tests are existing browser checks without a configured Chrome/Chromium executable. No GitHub, Cloud, deployment, schema, RPC, RLS, or unapproved write changes.
<!-- SECTION:NOTES:END -->
