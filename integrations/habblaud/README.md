# Zhuge AI OS × Habblaud｜像素辦公室整合

## 原始授權與來源
- Upstream: https://github.com/marmottajr/habblaud
- Pinned Commit: `faa1a012b5fbf632c66dc6801c5383e53a542406`
- License: **MIT**, Copyright (c) 2026 Márcio Junior.
- 每份由 CI 編譯出的 `pixel-office/` 與 `docs/pixel-office/` 均附原版 `LICENSE.txt`。

此整合**不修改** TaskFlow frozen vendor 的任何檔案，也不另建 TaskFlow 替代服務。

## 結構與資料

- `index.html`、`docs/index.html`：全螢幕嵌入**實際 Habblaud Canvas/Vite 編譯產物**，相對路徑 `pixel-office/index.html`。
- `status-classic.html`、`docs/status-classic.html`：保留原首頁 TaskFlow 經典報表，不刪除既有身分/CLI 路由。
- `docs/status/project-status.json`：初始狀態快照的單一來源；CI 發布 Artifact 時同步複製到 `status/project-status.json` 及 `docs/status/project-status.json`。
- `overrides/client/src/adapters/zhuge-bridge.ts`：驗證狀態 JSON、建立房間/人物資訊，**轉換成上游真的使用的 OfficeSnapshot**。
- `overrides/client/src/adapters/zhuge-entry.ts`：每 15 秒讀取靜態快照；同源且可用的 Habblaud Node Server 才接入 `/api/snapshot` ＋ `/api/stream` SSE。來源不同時不跨域擷取 CLI。
- `overrides/client/src/ui/zhuge-hud.ts`、`zhuge-hud.css`：中文 HUD、待裁示數與下一步抽屜；Canvas 點擊 AI OS 狀態人物可查看卡點。文字用 `textContent` 建立，避免狀態 JSON HTML 注入。
- `overrides/client/src/i18n/zh-TW.ts`：繁體中文首頁用語及主要控制面翻譯；上游另有大量葡語字串，**全站 100% 完整翻譯仍待 i18n Audit**，不可冒稱已完成。
- `build.mjs`：在 pinned upstream clone 的暫存工作樹中，安裝 Overlay、修正 GitHub Pages 專案相對資產路徑、編譯 Canvas，產出不可直接放公開機密的靜態網站 Artifact。

## QA 與發布邊界

Review workflow `zhuge-pixel-office-review.yml` 在分支 `review/pixel-office-homepage-20261018` build，**只有 CI＋14 天測試 Artifact，絕不直接部署**。真正公開首頁上線，仍須依 AI OS `docs/10_GOVERNANCE/RELEASE.md` 走新 Version/Build、Source/CI/正式備份，PM 確認授權後才發佈 main/Pages。

正式狀態 JSON 不代表目前有 CLI 工程師正在運作。超過 5 分鐘的快照標示為**過期**，像素代理不應誤顯示正在執行。即使 JSON 缺失，顯示「待命指揮總部」，不捏造即時 AI 工作。

## 待補的驗收

- GitHub Actions 同 SHA build/client typecheck PASS、產物相對網址與 Canvas 載入。
- 桌機 Chrome／手機 Safari 實際瀏覽；角色點擊、側邊待裁示與新舊報表導覽。
- 與真實 Habblaud Server SSE 同源部署時之 CLI 狀態融合（目前只有原生協定接線設計，未實機 E2E）。
- 將 `docs/status/project-status.json` 由真實且已核准的來源自動更新；目前為初始靜態快照，過期後要顯示 stale。

**不要把 Review 分支已提交當成正式網站已改版。**
