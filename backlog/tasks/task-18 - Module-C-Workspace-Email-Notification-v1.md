---
id: TASK-18
title: Module C Workspace Email Notification v1
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-04 12:36'
updated_date: '2026-09-04 13:28'
labels:
  - module-c
  - notification
  - supabase
dependencies: []
priority: high
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在唯一 Module C 的每個 Workspace 提供 Cloud-only Email Notification v1。卡片進入 Workspace 後讀取該 Board/Workspace 設定，由受控 Supabase Edge Function 寄送 Email；所有正式 C Consumer 共用同一份 C runtime 與 Cloud contract。使用提供的 Candidate ZIP 作為接手來源，僅處理本需求，不修改 Production 或無關模組。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 每個正式 C Consumer 的 Workspace ⋮ 選單都能開啟同一套工作區設定 UI，且設定資料只保存於 Supabase Cloud。
- [ ] #2 工作區設定可在重新整理、重新登入與換裝置後由 Cloud Read-back 還原，失敗時不回退到任何本地資料來源。
- [ ] #3 僅在卡片進入目標 Workspace 時觸發；disabled 不寄送，enabled 才依 Cloud 設定解析收件者並寄送。
- [ ] #4 收件者支援負責人、原始通報人與自訂 Email；缺少 Email 安全略過、重複地址去重，且送信結果／錯誤可追查。
- [ ] #5 Subject/Body 支援既定變數，未知變數不使 Edge Function 失敗；Provider Secret 不進前端或 Repository。
- [ ] #6 既有 Module C Board 操作與四個 C Consumer 的資料隔離、Reload、Desktop/Mobile 與相關 Regression 維持通過。
- [ ] #7 Product Completion 後才產生唯一 Candidate ZIP，並提供 Version、Build、Git Commit、Package Time、SHA-256 與 PM QA Handoff。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review Candidate ZIP、Repository instructions、Module C runtime/service、migration、Edge Function 與現有 tests。 2. Audit ownership/RLS/Auth/idempotency/send-result 邊界並做最小必要修正。 3. 補齊 focused tests 與 Cloud-independent QA evidence；未取得明確 development deployment authorization 前不套用 Supabase。 4. 執行 targeted/regression checks，完成 Product Completion 後依既有 release governance 產生 Candidate ZIP。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
接手來源：Zhuge_AI_OS_C_Workspace_Email_CloudOnly_PM-QA_20260904 (1).zip；已完成完整解壓與壓縮檔 integrity check，尚未修改正式 Cloud。

Continuation review has confirmed the Candidate ZIP source and the PM-approved v1 scope. Implementation remains gated on source/security review; no Supabase deployment has been performed.

2026-09-04 Source checkpoint: Candidate ZIP review, Cloud-only settings path, shared C Runtime wiring for WorkTodo/AI Board/GAS/Investment, idempotency/audit safeguards, syntax checks, git diff check, targeted 9/9, and full node regression 413 pass / 8 browser skips / 0 fail are complete. Current Supabase audit found no development branch or separate development project; production migration and Edge Function deployment were not performed. Cloud persistence, provider delivery, reload/re-login read-back, and browser runtime QA remain NOT VERIFIED; keep all acceptance criteria unchecked and task In Progress until an authorized Cloud path is available.

2026-09-04 Cloud QA checkpoint: PM authorized the existing QQ's Project after confirming `RESEND_API_KEY` and `WORKSPACE_NOTIFICATION_FROM_EMAIL` custom secrets. Cloud Settings Save/Read-back, authenticated reload/re-login, GAS-001 workspace movement, Resend delivery, notification audit linkage, and same-movement idempotency all passed. Evidence: `docs/evidence/TASK_018_WORKSPACE_EMAIL_NOTIFICATION_DEVELOPER_QA_20260904.md`. Developer QA is PASS; Product Completion and Candidate packaging follow, while PM QA/Acceptance remain pending. Keep this task In Progress and do not mark PM acceptance complete.
<!-- SECTION:NOTES:END -->
