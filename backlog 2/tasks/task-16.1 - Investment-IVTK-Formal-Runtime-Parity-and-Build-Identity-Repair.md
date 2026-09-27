---
id: TASK-16.1
title: Investment IVTK Formal Runtime Parity and Build Identity Repair
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-02 22:31'
updated_date: '2026-09-03 00:59'
labels:
  - investment
  - ivtk
  - golden-master
  - release-governance
  - responsive-ux
dependencies: []
parent_task_id: TASK-16
priority: high
type: bug
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PM formal runtime review found the approved Investment data integration and stable linkage are passing, but the product runtime fails on Build Identity and C Mother Template parity. Repair only the stale runtime Build metadata and make Investment #portfolio consume the actual canonical C Board Runtime with Investment data supplied through the adapter/approved extension surface. Preserve the existing Investment source of truth, 8 active links, IVTK identity, #watchlist consolidation, and all Cloud financial data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Formal runtime Build Identity is derived from the existing governed version/build/commit/deployment contract and no longer displays the stale 20260901-1709 value.
- [ ] #2 Investment #portfolio renders the canonical C Board Runtime rather than an Investment-specific board presentation or second template.
- [ ] #3 C Board shell, workspaces, cards, drawer/actions, layout, responsive behavior, search/filter/refresh and common capabilities remain the canonical C interaction contract; Investment-specific behavior is limited to data/lifecycle adapter semantics.
- [ ] #4 Investment Cloud values remain the only financial source of truth; stable IVTK source links and existing 8 positions remain intact, with no duplicate financial JSON, fake cards, transaction fabrication, or opening-position mutation.
- [ ] #5 Desktop and mobile formal runtime verification, machine parity audit, reload, focused QA, and relevant/full regression pass; #watchlist remains the single IVTK observation workspace and other C consumers remain unaffected.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit root version/build, current Runtime UI metadata, commit/deployment identity, and EP-034/EP-035 release helpers to locate the stale Build source. 2. Machine-compare the deployed C Mother Template Runtime with Investment #portfolio across shell, workspace, card, drawer/actions, layout, responsive, search/filter/refresh and common capabilities, separating data/lifecycle semantics from template capabilities. 3. Route Investment data through the actual shared C Board/Card/Drawer presentation contract; retain the Investment adapter and stable Cloud projection, with only approved P/L indicator extension. 4. Add focused parity/build regression checks without changing Investment financial data, Identity, OAuth, WorkLog or other consumers. 5. Deploy the focused fix and verify authenticated Desktop/Mobile Runtime, reload, Cloud read-back, and relevant/full regression.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RCA/Root Fix: IVTK 資料投影與 Stable Linkage 保留；先前失敗原因是 Consumer-owned Board/Column/Card/Drawer presentation 造成 C Template Parity Gap，並且 Runtime cache-buster／metadata 沿用 Build 20260901-1709。修復改為直接使用共用 Golden Master Board/Card/Drawer contract，Investment 只提供 source identity 與金融資料 slots；#watchlist 僅限制同一 IVTK runtime 至觀察名單 workspace。Release identity 改以 root version.json 為唯一 Build source，候選交付另依 EP-034/EP-035 產生。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @Co
created: 2026-09-03 00:59
---
PM Runtime Review 後的 Root Fix 已完成開發階段；目前進行 Machine Parity、正式 Runtime、Cloud/Reload 與回歸驗證，完成後只交 Candidate READY FOR PM QA，不提前關閉 TASK-16.1。
---
<!-- COMMENTS:END -->
