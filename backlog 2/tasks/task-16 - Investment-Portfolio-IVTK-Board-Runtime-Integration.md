---
id: TASK-16
title: Investment Portfolio IVTK Board Runtime Integration
status: In Progress
assignee: []
created_date: '2026-09-02 17:29'
updated_date: '2026-09-02 22:42'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
依 PM 核准的 Investment IA，將既有 QA C Board 轉為 Investment 的正式 IVTK Runtime：投資組合直接呈現共用 C Board，觀察清單收斂至觀察名單；Investment Cloud 保持金融資料唯一來源，Board 僅保存穩定卡片關聯。QAT-001 保留為封存歷史資料，不得偽造成 IVTK。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 投資組合 route 直接呈現共用 IVTK C Board，且不新增第二個投資戰情板入口。
- [x] #2 IVTK active 工作區只有 股票投資 與 觀察名單；QAT-001 不出現在兩者且保留原 QAT identity。
- [x] #3 金融數值由 Investment Cloud 讀取，association 只使用穩定 source identity，不把金融欄位寫入 board_tasks。
- [x] #4 目前 Cloud read-back 維持 current position 8、watchlist 0、opening position 8、transaction 3、snapshot 0，且不產生假資料。
- [x] #5 Investment 與共用 C Board 相關測試通過，且不修改 WorkLog、Identity、OAuth 或其他非本輪功能。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 在既有 C Board Instance 上落地最小 Investment source-to-card association、RLS 與受控 Projection RPC，不複製金融欄位或交易資料。 2. 以 Investment adapter 接上共用 Golden Master Card/Board，將 portfolio 與相容 watchlist route 收斂到 IVTK。 3. 保留 QAT-001 原身份並封存舊 QA 工作區，啟用股票投資與觀察名單兩個工作區。 4. 執行 Investment、共用 C Board 相關 QA，並以 Cloud read-back 確認資料邊界與目前真實 projection 狀態。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
已在目前 origin/main 建立乾淨整併分支，避開舊 dirty worktree；Cloud 已有的 IVTK transform/projection migration 依 PM 核准範圍套用，正式 link 由 authenticated Runtime 的受控 projection RPC 建立。

驗證進度：Investment 相關 47/47 PASS；全站 Node 回歸 403 tests、397 PASS、0 FAIL、6 skipped（僅瀏覽器測試因未設定 CHROME_PATH 跳過）。Cloud read-back：IVTK instance 已啟用，active workspace 為 股票投資／觀察名單，active links 0，current positions 8，opening_positions 8，transactions 3，watchlists 0，broker snapshots 0；QAT-001 仍在 archived qat-todo。正式 authenticated Runtime 尚待將本分支發布後驗證。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @Co
created: 2026-09-02 22:42
---
PM Runtime Review 判定先前的 Deployment/Runtime PASS 不等於 Formal Delivery；目前重新開啟，待 TASK-16.1 完成 C Mother Template Parity、Release Identity 與 Candidate ZIP 後交 PM QA。
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Formal Runtime PASS. Merged the approved IVTK integration to main through ce2c05c, with required follow-up fixes 6a66a70 and f49439f. GitHub Pages deployment 33688450586 succeeded. Authenticated #portfolio now projects 8 Investment Cloud current positions into the shared IVTK C Board as IVTK-001 through IVTK-008; Cloud Projection reports synced positions 8 and watchlist 0. #watchlist is the same IVTK 觀察名單 workspace and renders the truthful empty state. QAT-001 remains QAT-001 in the archived qat-todo workspace and is absent from active IVTK workspaces. Cloud read-back remains opening_positions 8, transactions 3, watchlists 0, broker snapshots 0, current positions 8, active links 8, active IVTK tasks 8, next_task_number 8. Reload and repeated controlled RPC calls are idempotent. Focused integration 4/4, relevant regression 74/74, full Node regression 398 passed, 0 failed, 6 browser-only skipped. No Investment financial data mutation, fake position, transaction mutation, WorkLog, Identity, OAuth, or unrelated AI Board change.
<!-- SECTION:FINAL_SUMMARY:END -->
