---
id: TASK-11
title: Template Operation Parity — WorkTodo adopts the single AI Board C template
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-24 07:48'
updated_date: '2026-09-01 04:19'
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

Checklist Contract repair: route formal WorkTodo general Checklist read/add/toggle/delete through shared board_task_checklist_items and board_*_task_checklist_item RPCs; preserve legacy WorkLog routes and other domains; add read-only Cloud RPC authorization migration artifact without applying it; run targeted and AI Board regression.

7. Harden the shared board_tasks work-code allocator and all current task-create RPC writers against stale registry/sequence counters; preserve the unique index, task IDs, auth/RLS, and existing domain data, then verify WorkTodo, AI Board, generic C consumers, and legacy WLTK compatibility.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PM 最新視覺試用將共用 Shared Task Drawer 工作進度列表卡片間距由 20px 調整為 28px，卡片內距維持 16px，並保留統一邊界、附件、編輯、刪除與雙 Consumer 共用呈現。已同步更新 shared/theme/task-drawer.css 與 TASK-011/TASK-042 regression assertions；本輪待重新執行 targeted / full regression。

2026-08-25 RCA: Build 1455 WorkTodo Shared Drawer read path queried legacy work_journal_entries, while existing worktodo_add_task_progress_note writes engineering_activity_log; live Network evidence showed work_journal_entries 200 and no engineering_activity_log request. Minimal source fix keeps Shared Drawer renderer and makes WorkTodo load existing shared service.loadActivity(task.id) canonical, with legacy Work Journal read only as fallback; no Cloud/schema/RPC/migration changes. Added browser regression asserting engineering_activity_log path and no task-scoped fallback.

PM approved Checklist Contract minimal repair on 2026-08-26. Scope excludes Workspace Delete, Agreement, Progress, Attachment, Storage, unrelated user_tasks RPCs, and legacy route removal.

2026-08-26 Checklist Contract coding complete: formal Template C WorkTodo Adapter now uses shared BoardReadService loadTaskChecklist plus board_add_task_checklist_item / board_update_task_checklist_item / board_delete_task_checklist_item through the existing Shared Action Contract. Legacy WorkTodo checklist aggregate/repository/RPCs remain unchanged for legacy routes. Added not-applied docs/supabase/20260826_worktodo_task_checklist_canonical.sql; read-only Cloud preflight PASS and live migration history confirms it is not applied. Targeted sequence and AI Board parity tests PASS; full automated regression 251/251 PASS. Cloud Runtime QA is pending PM-approved migration application; no Cloud write performed.

2026-09-01：修正 Cloud authoritative work-code allocator。WorkTodo registry counter 目前 37、既有最大 WLTK-047；共用 trigger 在同一 prefix transaction lock 下會跳過已占用候選並配置下一個可用編號，board_instance_create_task 不再自行配號；保留既有唯一索引、TASK/WLTK/MDTK/QAT ID、Auth/RLS 與資料。Cloud migration 20260901_work_code_allocator_collision_guard 已套用並 read-back。正式 WorkTodo/AI Board/C 建立路徑維持共用 Cloud identity allocation。本機 346/346 regression pass（含 5 個 browser tests），登入 WorkTodo Runtime reload 後建立入口可見且目前無 duplicate-key banner；未代送 Cloud 建立表單，避免未經確認新增正式卡片。

2026-09-01: 優化 C／Shared Golden Master 工作區重新命名。完成欄保留 PM Acceptance lifecycle 勾號並共用同一個工作區操作選單；所有工作區可透過既有受控 renameWorkspace 修改顯示名稱，Canonical workspace key／Lifecycle／刪除權限不變。Canonical key 優先判斷，避免顯示名稱改成 完成／已完成／QJC驗證 後誤判系統身份。Focused regression 與 full node --test 通過（343 PASS，5 個既有瀏覽器測試因缺少 Chrome executable SKIP）。
<!-- SECTION:NOTES:END -->
