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
- `docs/status/project-status.json`：人工核對並版控的靜態狀態快照；本輪依 `docs/30_QA/site-integration-118/REVIEW.md` 更新。CI 發布 Artifact 時同步複製到 `status/project-status.json` 及 `docs/status/project-status.json`。它不是即時 API，也不證明有人或 AI 正在工作。
- `overrides/client/src/adapters/zhuge-bridge.ts`: 驗證靜態狀態 JSON；不把模組或 PR 快照轉成人物。固定角色明確標記為像素角色；只有新鮮、非 Demo、具匹配 Source/Account 且 SSE 開啟的 Habblaud 主體 Agent 才能提供即時人物狀態。
- `overrides/client/src/adapters/zhuge-entry.ts`: 每 15 秒讀取靜態快照；同源且可用的 Habblaud Node Server 才接入 `/api/snapshot` ＋ `/api/stream` SSE。來源不同時不跨域擷取 CLI；來源不完整、過期或 Demo 的 snapshot 會 fail closed。
- `overrides/client/src/ui/zhuge-hud.ts`、`zhuge-hud.css`: 中文 HUD、待裁示與唯讀專案狀態面板。靜態模組、PR、卡點與下一步只在資訊面板顯示，不冒充工作者或即時狀態；使用 `textContent`，GitHub 連結限 HTTPS 並設定 `noopener noreferrer`。
- `overrides/client/src/i18n/zh-TW.ts`：繁體中文首頁用語及主要控制面翻譯；上游另有大量葡語字串，**全站 100% 完整翻譯仍待 i18n Audit**，不可冒稱已完成。
- `build.mjs`：在 pinned upstream clone 的暫存工作樹中，安裝 Overlay、修正 GitHub Pages 專案相對資產路徑、編譯 Canvas，產出不可直接放公開機密的靜態網站 Artifact。

## QA 與發布邊界

Review workflow `zhuge-pixel-office-review.yml` 在分支 `review/pixel-office-homepage-20261018` build，**只有 CI＋14 天測試 Artifact，絕不直接部署**。真正公開首頁上線，仍須依 AI OS `docs/10_GOVERNANCE/RELEASE.md` 走新 Version/Build、Source/CI/正式備份，PM 確認授權後才發佈 main/Pages。

## P2 Issue #71｜接待大廳獎牌牆與原生會議室

- 唯一場景仍是固定上游 `faa1a012b5fbf632c66dc6801c5383e53a542406` 的 Habblaud；本項只透過 `overrides/client/src/world/layout/zhuge-reception.ts` 及 `build.mjs` 精確 Patch 暫存建置來源。
- 獎牌使用原生 `wallItems` 掛在接待大廳北側室內牆；東側會議室使用原生牆段、雙格門洞、碰撞格、桌椅及互動 Spot，兩者不共用浮動門牌或第二套 Canvas。
- 原本可用的作品入口與說明按鈕保留。會議室／AI 指揮艙入口仍明確顯示連結待補，不猜測 URL。
- 首頁作品說明面板預設收合，避免遮住原生場景；使用者仍可展開查看作品連結與說明。
- 隔離 QA：Habblaud reception layout Vitest、原生 TypeScript、Chromium Canvas Smoke（1280×780、1440×900、1920×1080、390×844、844×390）、Issue 70/71 TaskFlow-owned 合約測試。此候選未部署，沒有 PM 真實桌機／Safari 驗收。

正式狀態 JSON 不代表 CLI 工程師正在運作。超過 5 分鐘的快照標示為**過期**；靜態快照不建立場景人物，也不把 `working` 狀態轉成角色活動。JSON 缺失時，固定像素角色仍只保持 idle，不捏造即時 AI 工作。

## 待補的驗收

- GitHub Actions 同 SHA build/client typecheck PASS、產物相對網址與 Canvas 載入。
- 桌機 Chrome／手機 Safari 實際瀏覽；角色點擊、側邊待裁示與新舊報表導覽。
- 與真實 Habblaud Server SSE 同源部署時之 CLI 狀態融合（本候選會用隔離 fixture 檢驗來源契約，但尚無正式 Runtime E2E 證據）。
- 將 `docs/status/project-status.json` 維持為依可核對來源人工更新的版本化快照；新核對時更新 `updated_at` 與總帳。超過 5 分鐘即顯示 stale；未接上正式唯讀資料 API 前，不宣稱自動更新或 LIVE。

**不要把 Review 分支已提交當成正式網站已改版。**

## P2 #91｜Native Mobile Camera/入口文案（.9.89 Review）

- 延用 pinned Habblaud 原生 Camera / WalkGrid / Room，手機直式第一次進站聚焦約 2.55 欄核心辦公區，減少遠端草地視覺；原生 `overview` 按鈕仍提供全棟總覽，原生平移與縮放保留，橫式回到全樓概覽。
- 可見的底部 `AI 指揮艙` 尚未取得已核實目的網址，保持 PENDING；主樓東側已有真正 Habblaud 原生會議室，前述待補入口不得稱為第二個會議室。
- 本次尚未完成全面房間美術改造或新像素素材；ClawLibrary 為空間設計參考，不改成 Phaser，也不直接搬用其受限素材。
- 實際手機 Safari、原生房間標籤完成度、夜間畫面品質，必須用新正式 Build 的 screenshot / runtime QA 驗證，不得用來源合約測試冒稱 visually accepted。
