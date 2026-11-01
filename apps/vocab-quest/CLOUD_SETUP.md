# 英文單字闖關王｜獨立網頁與每週分類 V1.7
2026-11-01

## 目前已上線
- 網址：https://vocab-quest-family.onrender.com/
- GitHub repo：QQweasdzxc/zhuge-ai-os，獨立分支：app/vocabulary-quest-20261101
- 靜態網站：apps/vocab-quest/site/index.html
- 教材字庫：apps/vocab-quest/site/wordbank.js

## 家庭使用方式（不用登入）
1. 開啟網站，不需要註冊、密碼或登入。
2. 先選「教材系列」：目前為「空中學英文」。
3. 選「週次」：第一批 12 字尚未指定實際週次，因此顯示「週次待設定」，不得擅自標成第 1 週。
4. 每一關只考選定週次的單字，題目及單字卡隨機；可以單獨考第一關、第二關、第三關，或選當週三關連續挑戰。
5. 「全部單字總複習」是首頁的額外選項，絕不自動啟用。
6. 新課本增加至 wordbank.js 的 units 陣列，提供 category、week、title、words，不覆蓋既有週次；每個系列可以有自己的多週單字庫。

## Supabase 資料安全與成績保存現況
使用者已明確要求**家庭使用不設註冊、登入或權限畫面**。

Supabase 現有 project `lenpbbhwxyyfwgvjcozf` 中，三張 `public.vocab_game_*` 專用表保留並維持 RLS 與 owner_id 權限。V1.7 不會連線讀寫它們，且前端已移除 Supabase 身分登入 SDK。

目前每次測驗的結果只保留於頁面記憶體，不使用 localStorage，重新整理或關閉後無法再讀取；這不是雲端歷史。不能為了省登入而將既有家庭成績或諸葛資料庫開放給未登入的公開使用者。

如果未來要實作「無登入、跨裝置永久歷史」，應先規劃服務端控制、濫用防護及可安全辨識同一家庭的方式，且不應把 service_role 密鑰放入網站 JavaScript。完成這部分前，不能宣稱雲端成績已可永久保存。

## 測試
- no-login UI: PASS
- 多教材、多週次、指定週次題庫隔離、總複習的模擬測試：15/15 PASS
- 先前真實登入與持久化驗收不是此模式的完成條件
