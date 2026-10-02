# Investment Tab UI Update

日期：2026-10-02（Asia/Taipei）  
範圍：Investment 第一層導覽呈現；Pending Transaction 只做唯讀 RCA。

## 變更

Investment 六個主要入口已改用既有 `.investment-content-tabs` / `.investment-tab` 樣式與 `role="tablist"` contract，不新增 Tab 元件：

`今日軍師｜我的持股｜觀察股｜個股研究｜團軍師｜市場情報`

第二層「更多工具」與其交易紀錄、投資策略、偏好設定、截圖匯入入口未重設計。頁面內容、既有 focus、URL/hash 和路由目的地均保留；「團軍師」只改主要入口顯示名稱，仍指向既有 `advisor` focus。

主要入口 active state 現在包含 `activePage + activeFocus`，因此「我的持股」與「觀察股」不會同時呈現為選取狀態。Board 持股頁的靜態導覽會依 `#watchlist` 標示正確分頁。

Desktop 使用現有 tab row；窄螢幕採單列水平滑動，最小 hit target 44px，沒有造成整頁水平溢出。

## 路由對照

| Tab | 保留的目的地 |
|---|---|
| 今日軍師 | `modules/investment/?focus=today-focus#overview` |
| 我的持股 | `app/Board/investment/` |
| 觀察股 | `app/Board/investment/#watchlist` |
| 個股研究 | `modules/investment/?focus=research#overview` |
| 團軍師 | `modules/investment/?focus=advisor#overview`（既有 advisor focus） |
| 市場情報 | `modules/investment/?focus=realtime#overview` |

## 驗證與畫面

- Targeted Investment tests：20 PASS / 0 FAIL / 0 skipped。
- Playwright Chrome component/source preview：Desktop 1440×900、Mobile 390×844 PASS。
- 六個 tab、唯一選取狀態、tab 高度、Mobile 水平滑動到最後一個 tab、整頁無水平溢出均有自動檢查。
- 預覽只 render 本地 Shared/Investment CSS 與導覽元件；沒有載入 Cloud、登入 session、持股或交易資料，不代表 authenticated Runtime QA。

Screenshots：

- `docs/30_QA/evidence/investment-tab-ui/desktop-1440x900.png`
- `docs/30_QA/evidence/investment-tab-ui/mobile-390x844.png`
- `docs/30_QA/evidence/investment-tab-ui/mobile-scrolled-390x844.png`

本輪未建立 Build、未 commit、未 push、未 deploy；待 GPT Review / PM Review。
