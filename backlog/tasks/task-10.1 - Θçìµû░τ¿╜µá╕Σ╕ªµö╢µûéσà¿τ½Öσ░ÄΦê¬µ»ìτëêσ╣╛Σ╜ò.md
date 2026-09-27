---
id: TASK-10.1
title: 重新稽核並收斂全站導航母版幾何
status: Done
assignee:
  - '@codex'
created_date: '2026-08-22 16:34'
updated_date: '2026-08-22 18:50'
labels: []
dependencies: []
parent_task_id: TASK-10
priority: high
type: enhancement
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
以正式 WorkLog 導航為唯一產品導航模板，重新稽核 Dashboard、AI Board、新版工作待辦、WorkLog、Investment 的 DOM、CSS 載入順序、Shell 位置、寬度、高度、字級、間距與 responsive 行為；移除 Consumer-specific 導航 Presentation，保留公開／法律頁既有邊界。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 所有產品頁由同一份 shared navigation component 與 canonical stylesheet 提供導航 DOM 與幾何
- [x] #2 WorkLog 不再持有導航幾何或 responsive override
- [x] #3 Source regression 通過且產出可回復的 Full Source Candidate ZIP
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
執行 regression、Source Match 與 ZIP integrity 驗證
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
已完成 Source-level 導航母版收斂：WorkLog 不再持有導航 presentation geometry / responsive override；正式產品入口統一消費 shared navigation。Full regression: 215 pass, 0 fail, 0 skipped；targeted: 18 pass；git diff --check PASS；node --check PASS；未變更 Cloud / Schema / RLS / RPC / migration data / deployment。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
以 WorkLog canonical navigation 為唯一產品導航 presentation source；移除 WorkLog consumer navigation geometry/responsive overrides；正式產品入口 consume shared navigation。Full Source Candidate ZIP 與 Source Match / ZIP Integrity 已驗證。
<!-- SECTION:FINAL_SUMMARY:END -->
