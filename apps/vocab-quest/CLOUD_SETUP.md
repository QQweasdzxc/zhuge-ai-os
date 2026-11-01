# 英文單字闖關王 — Supabase 雲端資料

2026-11-01｜V1.6

- 網站：https://vocab-quest-family.onrender.com/
- GitHub：同一個 QQweasdzxc/zhuge-ai-os repository，但使用 app/vocabulary-quest-20261101 獨立分支
- 網站專案：Render vocab-quest-family，獨立部署，不更動原本的 Zhuge 服務
- Supabase Project：lenpbbhwxyyfwgvjcozf（使用同個 Supabase project，不是另一個資料庫）
- Schema：public。此遊戲**僅**使用 vocab_game_ 開頭的三張資料表，不修改其他資料表。

## 三張專用資料表

- public.vocab_game_attempts：已完成測驗、所選單元、各題作答紀錄、學習者名稱、日期。
- public.vocab_game_units：登入者自行新增的教材單元。
- public.vocab_game_words：登入者自行新增的英文／中文／例句及提示，且只可引用自己擁有的單元。

DDL migration 名稱：vocab_game_isolated_learning_store_20261101。

三張表均啟用 RLS，auth.uid() 必須與 owner_id 相同，public / anon 沒有 SELECT 資格。只把 publishable key 暴露於靜態前端，**不可使用 service_role key**。

## 需在 Supabase 後台完成的設定

Authentication → URL Configuration → Redirect URLs

新增精確網址：

`https://vocab-quest-family.onrender.com/`

不可把 Site URL 改成英文遊戲網址，避免影響 Zhuge AI OS 原本的 Auth。

## 手機與雲端儲存政策

Supabase Client 設定 `persistSession:false`：不在 localStorage 儲存登入工作階段，每次重新開啟網頁需重新登入。完成測驗才新增一筆 vocab_game_attempts；未登入的測驗只在網頁記憶體顯示，**不會永久儲存**。舊版完成但未上傳的歷史成績無法復原。

學生在拼字題輸入的答案不是新增教材；需要從「永久單字庫 → 新增單字」提交才能保存。第一批 12 字仍在 GitHub `apps/vocab-quest/site/wordbank.js`，之後在 Supabase 中新增的單字可併入「全部單字總複習」。

## 驗證狀態

- DB migration success, RLS/grants verified: PASS
- Static JS syntax and simulated sign-in, insert, history navigation, word-unit additions: PASS
- Render deployment LIVE: PASS
- 真正由家長帳號註冊／登入、iPhone 跨裝置讀回成績：尚未由家長實機驗收
