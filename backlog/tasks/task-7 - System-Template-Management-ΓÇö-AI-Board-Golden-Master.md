---
id: TASK-7
title: System Template Management — AI Board Golden Master
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-21 05:35'
updated_date: '2026-08-25 14:33'
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
1. 將現有 AI Board Presentation 原樣去資料化，升格為唯一 Empty Golden Master。 2. 保留 AI Board / WorkTodo 各自 Adapter、Domain Data、Repository、Cloud path 與 Business Rule。 3. 讓 System Template 只 mount 同一份空白母版，不使用 Fixture、GM-FIX 或 Preview renderer。 4. 完成 static QA、automated regression 與本機 Runtime smoke test；不做 migration、schema、RPC、RLS、Cloud write、Template Editor 或新功能。

5. Under the PM's revised Phase 1 decision, keep the existing AI Board page untouched, add a source-equivalent new WorkTodo entry that loads the same AI Board runtime in an empty-data mode, and split navigation from the new entry to the unchanged legacy WorkTodo route.

PM 2026-08-24 Shared Navigation conformance fix: centralize A mount lifecycle for all consumers, remove Investment local navigation while preserving internal tabs, enforce one shared shell geometry including fixed desktop rail height and responsive overrides, then run eight-page Desktop/Mobile QA against canonical A with no Cloud/Auth/Domain/Golden Master changes.

PM Agreement UX-only remediation: keep Shared Action/Delete Contract/RPC/Schema/Storage/RLS unchanged; refine the Shared Task Drawer progressive disclosure, empty-state default single-date editor, compact date labels, and visible-field focus; verify with targeted browser fixture and source regression.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corrective implementation complete. Promoted the current AI Board presentation contract into `shared/components/golden-master.js` plus `shared/theme/golden-master.css` as the only Empty Golden Master; AI Board and WorkTodo route Board/Card/Drawer/Toolbar binding through that same source while retaining their adapters, domain data and existing controlled paths. Removed the previous Preview/Fixture components and renamed the System Template surface contract. Product Version remains 0.9.0-alpha.9.13; the final Candidate Build and artifact verification are recorded in the handoff response. Automated regression: 205 passed / 0 failed / 4 skipped; skipped tests are existing browser checks without a configured Chrome/Chromium executable. Runtime source smoke PASS; clean formal WorkLog route remains at onboarding gate without a session. No GitHub, Cloud, deployment, schema, RPC, RLS, migration, or unapproved write changes.

PM Scope Confirmed PASS：Golden Master 定義為目前正式 AI Board UX/UI/Interaction 的空白框架；前一版 Fixture/Preview 路線不再延伸。

PM revised Phase 1 on 2026-08-21: stop legacy WorkTodo presentation conformance. New 工作待辦 is a source-equivalent AI Board consumer with no WorkTodo Domain Data; old modules/worklog remains unchanged and reachable as 工作待辦（舊）. No Cloud/schema/RPC/RLS/data migration or Preview/Fixture was added.

Current request scope is limited to Agreement Schedule presentation/runtime UX. No Cloud, schema, RPC, storage, RLS, main, or deployment changes are authorized.

Agreement UX-only validation: Chrome fixture PASS for empty-state single mode (1 visible date input), period toggle (2 visible inputs), clear back to single; full Node regression 234 passed / 0 failed / 5 existing browser skips; git diff --check PASS. No Cloud/schema/RPC/storage/RLS/main/deployment changes.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @codex
created: 2026-08-21 07:19
---
PM 已確認 Empty Golden Master Scope；開始 corrective implementation，禁止新增 Preview、Fixture、Domain migration 或功能。
---

author: @codex
created: 2026-08-21 08:26
---
PM Decision recorded: new 工作待辦 directly adopts the formal AI Board surface for visual QA; legacy WorkTodo remains unchanged and is separated in navigation.
---
<!-- COMMENTS:END -->
