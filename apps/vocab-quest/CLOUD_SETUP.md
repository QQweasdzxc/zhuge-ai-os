# 英文單字闖關王 — 全雲端家庭版 V2.0

2026-11-01（台灣時間）

## 概要
- 程式碼仍在 `QQweasdzxc/zhuge-ai-os` 同一 GitHub repository，獨立 branch `app/vocabulary-quest-20261101`；**未合併 main**。
- Render 靜態網站仍是 `https://vocab-quest-family.onrender.com/`。
- GitHub username QQweasdzxc 不是網站域名。若日後使用有 QQ 字樣的自訂域名，需擁有相應 domain 並完成 Render DNS 設定；不會自動變成 GitHub username URL。
- 專用 Edge Function：Supabase project `lenpbbhwxyyfwgvjcozf`, slug `vocab-family-cloud`，source `apps/vocab-quest/backend/vocab-family-cloud.ts`。
- **家庭連結**形如 `https://vocab-quest-family.onrender.com/#f=<32-byte-random-capability>`。該 token 不可存入 GitHub 原始碼、不記錄到日誌；後端僅儲存 SHA-256 hash。不應放在公開頁面或截圖分享。

## 雲端儲存
- `public.vocab_family_spaces` — 家庭空間與 SHA-256 token hash。
- `public.vocab_family_learners` — 暱稱；家庭專用。
- `public.vocab_family_units` — 教材類別、週次、單字與例句 JSONB；已將首批 12 字輸入 Supabase。
- `public.vocab_family_attempts` — 每次測驗與答題詳情，含學習者、範圍、關卡、分數與時間。
- 以上四表皆啟用 RLS 且沒有 public、anon、authenticated 直接存取權限。服務端用環境變數 `SUPABASE_SERVICE_ROLE_KEY` 經 REST API 存取，只允許通過 family token hash 對應的家庭資料。不可將 service_role key 送到前端。
- V1.7 曾有的 authenticated-only `vocab_game_*` 三表保留但 V2.0 不使用，沒有解開原本 RLS，不影響諸葛原有資料表。

## 操作與限制
- 孩子不用登入，透過家庭私密連結即可選擇測驗者、週次及三個獨立關卡。
- 右上角切換週次或明確選擇「全部單字總複習」；預設只測當週。
- 新增測試者寫到 Supabase，不把新成績寫入 localStorage。原版在某些裝置存的暱稱會在首次使用家庭連結時嘗試搬到雲端並清掉舊暱稱清單。
- 成績只有伺服器確定回覆成功後才顯示「已存入 Supabase」，失敗需看到警告；使用普通網址沒有 family token 不允許啟動未保存測驗。
- 「教材單字庫」頁的摺疊新增表單可新增教材系列、週次與每行 `英文 | 中文 | 含 ____ 的例句`。
- 前端 V2.0 有 GitHub wordbank.js 作為網路中斷的顯示備援，但它不是雲端成績來源；只有從家庭雲端載入成功才能開始正式測驗。
- 關閉或重開網站都能用同一家庭連結取得雲端歷史，**共享連結應保密**，因取得連結者等同取得家庭字庫與成績資料使用權。
- Edge Function 不提供身分登入或未驗證公開讀取；長期需評估請求速率限制、token 輪替及歷史資料分頁上限（目前最近 200 筆）。
- 以前「只有在網頁記憶體」的測驗，關閉後仍無法復原。

## 驗證
- Supabase schema migration: PASS，家庭空間與 12 筆字庫文字：DB readback PASS。
- Edge Function deployed ACTIVE v1 / verify_jwt=false, **function code checks token itself**。
- Frontend Render live：PASS。
- JS mock cloud save / second browser history readback / add unit：8/8 PASS。
- 真實家庭 iPhone → Edge Function → Supabase → reload readback：尚待實機驗收；此情境不應標示為 PASS。
