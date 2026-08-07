Zhuge AI OS｜AI Board Prototype v0.1
======================================

這是「可互動 Prototype」，不是圖片，也不是規格文件。

唯一目標：
現有 Backlog.md 風格 Board → Supabase board_tasks → PM QA

已實作：
1. 全繁體中文介面（保留 Inbox / Ready / In Progress / QA / Done 英文狀態名，並顯示中文）
2. 直接讀取 Supabase public.board_tasks
3. 五欄 Kanban
4. 卡片拖曳後直接 UPDATE board_tasks.status
5. 新增工作（INSERT）
6. 點卡片編輯（UPDATE）
7. 刪除工作（DELETE）
8. 搜尋 / 模組 / 優先度 / 負責人篩選
9. 「全部工作」列表
10. Supabase Realtime 訂閱；若 Realtime 未啟用，另有每 10 秒自動刷新
11. 不內建假資料；未連線時畫面會要求輸入 Supabase 資訊

如何 QA：
A. 直接打開 index.html。
B. 首次會跳出 Supabase 連線視窗。
C. 貼入：
   - Project URL
   - Anon / Publishable Key
D. 按「測試連線」。
E. 成功後按「儲存並載入」。

建議驗證：
- 是否看到你已寫入 board_tasks 的真實資料
- Ready → In Progress 拖曳後，Supabase status 是否變成 inprogress
- 重新整理頁面後卡片是否仍在正確欄位
- 新增工作後 Supabase 是否真的新增一列
- 修改標題/內容後是否寫回 Supabase
- QA → Done 是否正確更新
- 另一個瀏覽器視窗是否在數秒內同步

注意：
- Supabase 的 board_tasks 若啟用 RLS，必須允許目前使用的 anon/publishable key 執行 SELECT/INSERT/UPDATE/DELETE，否則 Prototype 會顯示錯誤。
- Realtime 若未將 board_tasks 加入 publication，不影響 CRUD；Prototype 仍每 10 秒自動刷新。
- 連線資訊只存在瀏覽器 localStorage，Prototype 檔案內沒有硬編碼你的 Key。

檔案：
- index.html
- styles.css
- app.js
