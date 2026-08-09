Zhuge AI OS｜AI Board Formal Cloud Read
======================================

本頁保留 PM 確認的 Interactive Prototype v0.9 排版，並正式讀取
Supabase 的 board_tasks 與已核准 engineering_knowledge。

唯一目標：
現有 Backlog.md 風格 Board → Supabase board_tasks → PM QA

目前批次已實作：
1. 透過 Zhuge AI OS Shared Identity 取得目前登入者。
2. 透過 Shared Supabase Data Gateway 唯讀讀取 board_tasks。
3. 透過 engineering_knowledge 唯讀讀取已核准最高原則。
4. UI 狀態映射：ready／inprogress／qa／done → 待辦／推進／驗證／完成。
5. 顯示每張 TASK 的目前 Assignee。
6. 沒有 Mock Data、Board 私有 Supabase Client 或 TASK LocalStorage。
7. Status、Assignee、Ownership、RLS 與 Drag Write 尚未授權，故 UI 為唯讀。

如何 QA：
A. 先登入 Zhuge AI OS，確保 Shared Session 存在。
B. 從 Dashboard 開啟 AI Board，或直接開啟本頁。
C. Board 應由 Shared Gateway 讀取正式資料。
D. 若未登入，畫面應顯示登入提示，不應顯示假資料。

建議驗證：
- 是否看到正式 board_tasks 的真實資料
- TASK-026 的 status／assignee 會依 Supabase 正式值呈現
- 最高原則只來自 approved engineering_knowledge
- 重新整理後仍沒有 Mock Data 或本機 TASK 資料

注意：
- Board 不接受使用者貼入 Supabase URL／Key，也不在 localStorage 保存 Board 連線設定。
- 本批次只開放 Cloud Read；正式 Write 需先完成 Ownership／RLS Proposal 與 PM 核准。

檔案：
- index.html（Prototype UI baseline + Shared runtime entry）
- styles.css（原型樣式）
- board-runtime.js（Cloud Read rendering）
- ../../../shared/board/board-read-service.js（Shared read adapter）
