---
id: TASK-17
title: A/C Shared Composition for WorkLog GDPD and Investment Portfolio
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-03 02:42'
updated_date: '2026-09-03 04:32'
labels:
  - shared-module
  - worklog
  - gdpd
  - investment
  - ivtk
  - governance
dependencies: []
references:
  - >-
    /Users/qq/.codex/attachments/73eea98d-9569-44f3-87b9-1ea532a9c672/pasted-text.txt
priority: high
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
依 PM 最新正式需求，讓 WorkLog／總務採購與 Investment／投資組合直接組合同一份正式模組 A（導航）與模組 C（看板），各自承載 GDPD 或 Investment Data。保留既有資料層與穩定關聯，不建立 Consumer-owned board/template；移除 Investment 的觀察清單頁籤；修復已從 C 移除的 Template Capability 在 WorkTodo 復活的回歸；完成正式 Runtime、Parity 與 Candidate 交付治理。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 WorkLog 下與工作待辦並列正式出現總務採購，使用原本的 A + 原本的 C，並有 GDPD、廠商清單兩個頁籤；GDPD 卡片使用 GDPD-xxx 語意。
- [ ] #2 Investment 的投資組合保留既有頁籤但直接渲染 canonical C + Investment Data；不保留獨立 Portfolio Board Presentation、不新增第二個 Investment Board 入口。
- [ ] #3 Investment 原觀察清單頁籤移除；不得另建第二套 Watchlist UI，既有資料與穩定 source identity 保留。
- [ ] #4 C 的 Workspace/Card/Drawer/操作/版面/Responsive/Mobile/Shared Capability 只有一份；Consumer 只能改 Data、Ownership 與 Business Content，不能擁有 C 副本。
- [ ] #5 已從 canonical C 移除的資料健康檢查（唯讀）不再出現在 WorkTodo；完成 Root Cause 修復與防回歸驗證。
- [ ] #6 既有 Investment Cloud Data、Projection、Stable Linkage 與正式持股不被 UI 組合變更破壞；不製造金融資料、交易或重複 source of truth。
- [ ] #7 完成相關 Functional/Flow/UX/Desktop/Mobile/Reload/Parity/Regression，並依正式 Release Identity 與 Candidate ZIP Governance 交付唯一 Candidate 給 PM QA；Deployment 不取代 Delivery。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit and preserve the canonical A navigation, canonical C Golden Master primitives/runtime, current WorkLog and Investment adapters, and the existing Investment Cloud/stable-link data path; treat GDPD as a truthful empty/pending data source because no formal GDPD records/schema are currently present.\n2. Fix the C capability regression at its shared source: remove the legacy data-health-check reintroduction path from Golden Master consumers and add regression assertions that WorkTodo/AI Board/consumer surfaces cannot resurrect it.\n3. Make Investment #portfolio a direct C consumer of Investment data, remove the Investment 觀察清單 tab/render path while retaining underlying watchlist data and compatibility behavior without a second UI, and ensure IVTK cards use canonical C card/board/drawer structure with only Investment data slots.\n4. Add WorkLog/總務採購 as a parallel shared-navigation entry using the existing A shell and a thin C consumer runtime with GDPD and 廠商清單 tabs; render canonical C with no fixture rows and GDPD-xxx identity semantics when formal GDPD data is available.\n5. Add focused unit/browser checks for A/C composition, Investment route/tab consolidation, GDPD empty-state truthfulness, C capability non-resurrection, stable Investment linkage, desktop/mobile/reload behavior, and Consumer parity; do not modify Supabase schema/RLS/data unless an actual in-scope blocker is proven.\n6. Run code review, focused QA, relevant regression, desktop/mobile runtime checks, Cloud/read-only integrity checks, then align the new release identity and produce one Candidate ZIP with SHA-256 for PM QA; deployment is evidence only and is not PM acceptance.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Continuation audit 2026-09-03: resumed the existing dirty worktree without reset or rollback. The later PM naming correction is retained in product/runtime code: visible name 庶務行政 and code/prefix GAS supersede the earlier GDPD wording. Implemented Module A management peer and 庶務行政 tabs, canonical C composition for Investment #portfolio with consolidated 觀察名單, truthful GAS empty boundary, and shared-source removal of retired 資料健康檢查 capability. Focused QA 54/54; non-browser regression 402/402 with 8 browser cases initially skipped; Chrome browser regression 410/410 after stabilizing the test-only collapsed-navigation frame wait; git diff check PASS; release preflight PASS for version 0.9.0-alpha.9.13 build 20260903-1221. No Cloud mutation, deployment, or PM acceptance yet. Candidate packaging and PM QA handoff remain pending; keep task In Progress.
<!-- SECTION:NOTES:END -->
