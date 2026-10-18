# Zhuge AI OS｜Pixel Office P2 角色互動與作品獎牌｜Release Review

**2026-10-18，PM 授權「我們進入 P2」。本文件僅記錄候選審查，不是正式發布或永久備份證明。**

## 基準與依賴
- 已上線 main：`0.9.0-alpha.9.74`，未受本 PR 修改。
- P1 [PR #62](https://github.com/QQweasdzxc/zhuge-ai-os/pull/62)：`0.9.0-alpha.9.75` / Build `20261018-1359`；仍在 Draft，需先依治理處理 P1。
- P2 [PR #63](https://github.com/QQweasdzxc/zhuge-ai-os/pull/63)：以 P1 Review branch 為 base，避免把 P2 的 source 誤當成單獨可直接 merge to main。
- P2 Review 身份：`0.9.0-alpha.9.76` / Build `20261018-1932`；Published C 需保持原狀。

## PM 核准的最小 P2 改動
1. Habblaud Canvas 保留真正的 pinned MIT upstream，不重建辦公室、不更動 TaskFlow Frozen Vendor。
2. Native `OfficeSnapshot` 加入 PM、Codex、Gem 三位固定展示人物：單一專用角色辦公桌，三位一律 `idle`，穩定 `id`，角色頭銜與描述不等於真實 CLI 工作證據。
3. 點原生人物或 HUD「👥 人員」使用既有決策側欄閱讀 PM / Codex / Gem 介紹、明確展示狀態；不開一個新獨立網站、不讓場景浮動物件擋住原有抽屜。
4. 作品獎牌仍然**點獎牌即新分頁進入原網站**，旁邊小型 `i` 可查看作品簡介、目標正式路由與「非即時工作狀態」告示。
5. P3 的 Codex 雲端 helper 真正啟動事件、真實 Co/Gem 工作狀態同步待後續 API 授權；不生成虛假 worker、token、API。會議室的指揮艙 URL 仍為 PM 指定隔日提供的 `PENDING_PM_INPUT`；TF-03 v1.0.1 仍待真實檔案來源核實。

## 自動驗收條件（僅最終 exact-SHA 全通過才可寫 PASS）
- `node --test tests/zhuge-pixel-office-contract.test.cjs tests/zhuge-office-furnishings.test.cjs tests/zhuge-office-p2.test.cjs`。
- 原生 upstream Habblaud TypeScript client `tsc --noEmit`、Chromium 桌機／手機 Pages Artifact smoke：三位 idle 角色、角色介紹、獎牌資訊、不可用下載／會議室網址告示、原有 OAuth & Classic 回跳、手機收合。
- 原有 Browser Regression、P0 Pages real build parity、精確來源身份 `release-governance preflight`、Candidate ZIP/Manifest/SHA256 clean exact-SHA 封裝 integrity。
- 真正 Production merge 必須完成源碼永久私人備份遠端讀回及 PM Release 授權；CI 測試 Artifact、公開密文暫存 **不等於** PM Drive 已永久備份。
- iPhone Safari 真機中文、長畫面與遮擋需由 PM 最終驗收；Linux Chromium 截圖不冒稱 Safari 真機已測。

## 回退界線
- 本次只在 P2 Review branch 操作；主分支與 P1 PR 都維持原樣。
- 任何 CI FAIL 先修正同一 P2 Review branch，重新檢查最新 SHA；不得直接 deploy main、推進 Render、觸發 DB migration 或 GitHub App 權限變更。
- 重要操作結果與缺失寫回 `handoff/20261018-Handoff.md`（ops/handoff 分支）及 PR #63。
