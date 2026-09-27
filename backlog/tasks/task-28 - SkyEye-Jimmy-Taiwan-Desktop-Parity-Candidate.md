---
id: TASK-28
title: SkyEye Jimmy Taiwan Desktop Parity Candidate
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-27 16:00'
updated_date: '2026-09-27 16:02'
labels: []
dependencies: []
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
以 Jimmy Taiwan God’s Eye 公開 Runtime 作為 Desktop 功能、視覺與互動 evidence，基於 Frozen upstream bilawalsidhu/gods-eye-view commit b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe 與現行 SkyEye Next Desktop Candidate，建立獨立 parity candidate。不得把 godeyes.jimmy-dev.win/api/* 作為 production dependency；Jimmy-specific 行為須以 MIT upstream 與 Zhuge implementation 重作。保留 current SkyEye 與原始 God’s Eye Candidate，不進 architecture modernization、mobile、production cutover。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 產出 JIMMY_PARITY_MATRIX.md，涵蓋 Runtime Recon 已確認的 Taiwan/global layers、interaction 與 unknown/block 狀態
- [ ] #2 產出 Jimmy reference snapshot/screenshots 與 candidate screenshots，並保存 viewport/camera/layer/panel/loading/error evidence
- [ ] #3 建立與 parity 行為相容的 provider/adapter boundary；正式資料不依賴 Jimmy same-origin API，unknown provider fail-closed
- [ ] #4 Desktop candidate 可驗證 globe/navigation、layer controls、selection/tracking、CCTV、weather/radar、Taiwan-specific layers 與 search
- [ ] #5 Targeted interaction tests、full regression、license/attribution matrix 與 known risks 可追溯；current SkyEye 與 upstream baseline 未被覆寫
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Freeze Jimmy runtime recon and upstream baseline evidence into JIMMY_PARITY_MATRIX.md, API compatibility matrix, provider/license mapping, and screenshot capture contract; keep godeyes.jimmy-dev.win/api/* reference-only. 2. Add isolated Taiwan provider contract, registry, cache/coalescing policy, attribution registry, and provider adapters for the confirmed NLSC/CWA/Taiwan CCTV boundaries with explicit unknown/blocked states. 3. Integrate the first real E2E spike through the existing God’s Eye map/layer architecture by adding an opt-in NLSC WMTS map stack; preserve upstream defaults and current SkyEye routes. 4. Add deterministic contract/provider tests plus a real public NLSC WMTS probe and runtime evidence capture; exercise the frozen reference and candidate Desktop surfaces without production deployment. 5. Run targeted tests, upstream unit/regression gates, diff checks, and record source/runtime risks before Candidate review.
<!-- SECTION:PLAN:END -->
