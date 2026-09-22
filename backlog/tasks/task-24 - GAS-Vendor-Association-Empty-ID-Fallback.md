---
id: TASK-24
title: GAS Vendor Association Empty-ID Fallback
status: In Progress
assignee: []
created_date: '2026-09-16 14:30'
updated_date: '2026-09-16 14:34'
labels: []
dependencies: []
modified_files:
  - app/Board/procurement/vendor-task-association.js
  - tests/task-065-vendor-association.test.js
priority: high
type: bug
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
修正 GAS 新卡片在 Cloud Vendor Association 的 vendorId 為 null、undefined 或空字串時，Vendor selector 因空 ID lookup 而錯誤預填名冊廠商的問題。保留既有 Vendor Association、Vendor 名冊、C Shared Runtime 與 canonical association RPC；不處理其他 GAS 功能，不部署、不發布。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Vendor ID 為 null、undefined 或空字串時不執行名冊 lookup，selected Vendor 為空，未關聯卡片顯示空白。
- [x] #2 有效既有 Vendor ID 仍解析並顯示原廠商。
- [x] #3 使用者主動搜尋、選擇並保存 Vendor 後，沿用 canonical association path 正確關聯與顯示。
- [x] #4 Reload 後回讀既有關聯並顯示相同 Vendor；不修改其他關聯或名冊資料。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 在 Vendor ID lookup 層以 trim 後的非空 ID fail closed。 2. 為空關聯、既有有效關聯、主動選取/保存與 Reload 增加行為測試。 3. 執行定向及全量回歸。 4. 依正式流程建立新 BUILD_ID、提交、執行 Release Gates，封裝並驗證 FullSource Candidate，存入 PM Google Drive，之後停止。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pre-build Developer QA: node --test tests/task-065-vendor-association.test.js: 8 PASS, 0 FAIL. Full Regression: node --test tests/*.test.js: 577 total, 571 PASS, 0 FAIL, 6 SKIP (browser tests require Chrome/Chromium, unavailable in this environment). Source syntax and git diff --check PASS. Flow tests use an in-memory mock; no live Vendor Association or Vendor catalog was changed. Candidate packaging remains pending.
<!-- SECTION:NOTES:END -->
