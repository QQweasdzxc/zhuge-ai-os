---
id: TASK-10
title: 全站 Shared Navigation 視覺一致性收斂
status: Done
assignee:
  - '@codex'
created_date: '2026-08-22 07:45'
updated_date: '2026-08-22 08:04'
labels:
  - navigation
  - frontend
  - qa
dependencies: []
priority: high
type: bug
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
將登入後 App 的全站主導航收斂為單一 Shared Presentation，讓 Dashboard、AI Board、新版 WorkTodo、WorkLog 與 Investment 使用相同導航結構、尺寸、間距、字級、Responsive 行為與導航資料；保留頁面能力所需的二級導航，不將其誤併入主導航。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dashboard、AI Board、新版 WorkTodo、WorkLog、Investment 的主導航 DOM／互動均來自同一個 Shared Navigation component。
- [x] #2 上述 App 路由的主導航 computed geometry、spacing、typography、collapse 與 responsive rules 一致。
- [x] #3 WorkLog 不再以 consumer CSS 或 registry 覆寫主導航視覺設定。
- [x] #4 公開資訊頁與產品 App 主導航的邊界有明確且不互相污染的驗證。
- [x] #5 Regression、Source Match 與 QA Runtime 驗證通過。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Promote the accepted shared workspace rail geometry into shared/theme/zhuge-navigation.css as the only canonical global-nav geometry layer. 2. Remove the duplicate global-nav geometry block from shared/theme/zhuge-workspace.css. 3. Load the canonical navigation stylesheet after WorkLog content styles so WorkLog cannot override the rail. 4. Align the legacy WorkTodo registry icon with the canonical registry while preserving route/data behavior. 5. Add/update regression assertions for route stylesheet order, registry parity, public-navigation boundary, and collapsed geometry. 6. Run regression and deployed Source Match checks, then update QA Runtime.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-08-22 QA evidence: node --test tests/*.test.js = 211 pass, 0 fail, 4 browser checks skipped because no local Chromium. GitHub Pages route checks for Dashboard, AI Board, new WorkTodo, WorkLog, and Investment returned HTTP 200; all product HTML exposed Build 20260822-1554. Remote shared navigation CSS and zhuge-navigation.js SHA-256 matched the committed source. Fresh Chrome runtime DOM checks showed one shared navigation node and identical product navigation labels/geometry on Dashboard, AI Board, new WorkTodo, and Investment. WorkLog unauthenticated initialization correctly stops at its login surface; its route loads the shared navigation component and CSS, covered by source regression. The lifecycle test fixture now uses a relative future timestamp; production Board/Cloud logic was not changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Unified the product App navigation around shared/components/zhuge-navigation.js and shared/theme/zhuge-navigation.css, removed route-level navigation geometry/appearance overrides, aligned registry data, synchronized Build metadata, and verified regression plus GitHub Pages Source Match.
<!-- SECTION:FINAL_SUMMARY:END -->
