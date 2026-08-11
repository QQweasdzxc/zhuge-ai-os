# Dashboard WorkLog Calendar — PM QA Evidence

Product Version: v0.9.0-alpha.9.12  
Runtime Build: 20260811-1752 (candidate packaging timestamp)

## Scope

本次只修正 Dashboard「我的工作空間」中的 WorkLog Card；WorkLog 主頁、其他模組、資料庫、Auth、RLS 與 Business Logic 均不在本次修改範圍。

## RCA

Dashboard 原本以可互動的 `<button class="zhuge-module-card">` 包住 WorkLog Card 內的日期 `<button>`。這是無效的巢狀互動 DOM，瀏覽器會在解析時重新整理節點，讓日期 grid 的欄位規則失效，日期逐一變成 full-width row。Dashboard 也另有一套日期計算，容易與 WorkLog 主頁的月曆漂移。

修正方式是移除巢狀按鈕：模組卡改為非互動 `article`，主卡片使用獨立的 `button.zhuge-module-card-main`，日期 cell 保持獨立互動按鈕。日期資料改由 WorkLog 共用的 `worklogCalendarCells(year, month, sourceEntries)` 產生；WorkLog 主頁的既有 `calendarPanel()` 也改用同一 helper，因此 Dashboard 只提供 compact presentation，不維護第二套日期邏輯。

## Runtime checks

- Dashboard Desktop 1600×900：7 欄、6 週日期 grid；Today highlight 與工時日期 indicator 可見；`＋ 新增工時` 可見。
- Dashboard Mobile 390×844：保留 7 欄 compact grid，內容不以日期逐列展開；版面限制在 viewport 內。
- 原 WorkLog Calendar：仍由 `calendarPanel()` render 42 個月曆 cell，月份切換、Today、選取日期與工時 indicator 的既有行為未改變；僅抽出共用 cell model。
- Dashboard quick action：`＋ 新增工時` 只切換至既有 WorkLog capture 流程，不建立第二套表單或資料寫入。

Screenshots（本機 Runtime evidence）：

- `dashboard-worklog-b5-desktop.png`
- `dashboard-worklog-b5-mobile-final.png`

## Automated evidence

`tests/ux-polish.test.js` 覆蓋共用 helper、Dashboard compact rendering、非巢狀互動卡片與 Quick Action；Node syntax check 與 `git diff --check` 另行執行。

## Delivery boundary

本次不含 Database Migration、Schema/RLS/Auth/OAuth 變更，不含 Merge、Deploy 或 Release。
