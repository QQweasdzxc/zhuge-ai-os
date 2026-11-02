像素辦公室私密家人名單原本僅存在各裝置，無法隨帳號同步。現在正式名單只存本人帳號雲端；未登入停用編輯，既有本機 key 僅供保留遷移，不顯示為正式名單。所有新增／修改均在確認雲端回傳成功後才更新場景。

## 基準與範圍

- 初讀本機 `origin/main`: `1133d66112f8633d003b41722c579c527fcc0de9`；初始 checkout: `607a2472449fef0809800aa084a4a8df23d25dde`。
- proxy 失敗後已透過允許的執行環境成功 `git fetch origin main`，再成功完整 `git fetch origin`。
- **BASE_SHA = `3d4ed70bf419fe7ea908aaa7d702824e7ce0e4a0`**，已顯式將 `office-roster-cloud-sync` rebase 到此實際 `origin/main`；繼續工作前 HEAD/origin/main/merge-base 相等。保留 main 新增的牆面資產及 office3d.js 修改。
- 不動 `third_party/multica`、sat-service-agent-token、zg52-office-panel，不遷移其他資料，不新增付費服務，不直接推 main。
- `office.js` 僅更新過時註解：繼續接收既有 `toSessions` 的中性成員資料。同步狀態與場景注入在 `members.js` / `index.html`。
- 依 AGENTS.md / RELEASE.md 的 MATERIAL SOURCE CHANGE RULE，透過既有工具生成並同步 Build `20261102-1040`；其他頁面差異僅為必要的 Build 身分／cache-buster 投影，Published C 身分保持不變。

## Schema 與完整 RLS policy

Migration: `supabase/migrations/20261102024755_office_member_roster.sql`（檔名由 Supabase CLI `migration new office_member_roster` 產生）。

`public.office_member_roster` 每帳號一筆：`owner uuid primary key references auth.users(id) on delete cascade`、`names text[] not null default '{}'`（上限 24、拒絕 NULL 元素與多維陣列）、`updated_at timestamptz not null`。server invoker trigger 使用 clock_timestamp 更新 revision；無 seed、無稽核名單 payload。啟用且 FORCE RLS，撤銷 PUBLIC/anon 權限，僅 authenticated 取得 SELECT/INSERT/UPDATE/DELETE。

```sql
create policy office_member_roster_select on public.office_member_roster
  for select to authenticated using ((select auth.uid()) = owner);
create policy office_member_roster_insert on public.office_member_roster
  for insert to authenticated with check ((select auth.uid()) = owner);
create policy office_member_roster_update on public.office_member_roster
  for update to authenticated using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);
create policy office_member_roster_delete on public.office_member_roster
  for delete to authenticated using ((select auth.uid()) = owner);
```

Postflight: `labs/pixel-office-3d/sql/office_member_roster_postflight.sql`，只輸出 policy 結構，不輸出名單。
Rollback: `labs/pixel-office-3d/sql/office_member_roster_rollback.sql`，會刪表；先由授權流程私下備份，先回退 client，再另行批准執行。已遷移且清除的手機 key 不會自動復原。

## 資料路徑與理由

選 **(a) 瀏覽器直接 PostgREST**。已核實 `shared/app-config.js` 的 `AUTH_CONFIG` 有 URL 與公開 anon key，office 已載入 shared auth-service。沿用 Google 登入後的 Supabase session，必要時經既有 `refreshAuthSession(false)` 更新；透過 `/auth/v1/user` 驗證帳號 id，再以 `apikey` + **Supabase 使用者 JWT** 呼叫 `/rest/v1/office_member_roster`。不用 TF JWT、不新增 Edge Function、不使用 service_role。RLS 的 owner 條件才是權限邊界，前端 owner filter 僅輔助查詢。

讀寫不建立本機名單快取，credentials omit、cache no-store、15 秒 timeout；不印出名單、token 或伺服器錯誤 body。舊 hash seeding 不再新增本機名單，含名字的 fragment 立即從網址移除。名單不進 repo、公開 fixtures、站點包或未授權日誌；測試全部使用假名與假 token。

## 遷移、失敗與衝突

登入後先 GET 雲端，再把 legacy `zhuge.office.members` 合併去重。即使兩邊相同，也在確認寫入回傳 owner、完整 names、updated_at 正確後才 removeItem。雲端空值、讀寫失敗、未登入、登出皆不刪除 pending legacy key。若請求中本機內容或帳號改變，保留 key 並拒絕發布舊請求結果。沒有先刪後寫，也沒有未登入的新增／編輯／本機儲存模式。

POST 建立；PATCH 帶讀到的 updated_at 做 optimistic concurrency。409 或零列回傳會重新 GET，最多重試三次，遷移重新合併另一裝置的變更。合併超過 24 人則明確錯誤、保留本機全部資料，不靜默截斷。需先整理本人雲端名單／舊資料後重試；這個保護不自動選擇要捨棄的人名。

30 秒 polling、focus／回到頁面重新讀取；設定框有未完成輸入時不以背景讀取覆蓋草稿。跨帳或登出立即隱藏舊帳名單。儲存中停用設定框；失敗不把草稿當成已儲存的場景狀態。

## 驗證與證據

- 新 roster：12/12，實際 migration/RLS + 瀏覽器登入鏈／遷移／跨端編輯。
- 既有 office：56/56（含 2D/3D、1440/390 手勢 4/4；手勢 fixture 改為雲端，並排除最新 main 的 TF 牆面及側欄遮擋，保留原有所有手勢斷言）。
- 共用 session refresh：29/29；release governance：50/50；release consistency：1/1。
- `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser`：92 項 + 5 個 standalone scripts 全過，skipped 0。
- `git diff --check` 通過；與 BASE_SHA 比對 `third_party/multica` / `office3d.js` 無差異。

實際執行紀錄見 `tests/evidence/office-roster-cloud-sync/`。SQL 測試執行 migration 本文、真實 PostgreSQL RLS policy、非 bypass 的 authenticated/anon roles 與 request subject，不是字串比對合約。

瀏覽器測試載入真正 office 頁面與既有 auth-service，實跑 expired session → refresh → /user → roster API → RLS SQL → 手機清 key → 電腦讀取 → 雙端修改。外部 GoTrue/Google 網路端以假 token fixture 替代，PostgREST HTTP-shaped adapter 將每個 roster 讀寫交給實際 RLS SQL；**這不是正式 Supabase / Google OAuth 上線驗證**。此 PR 未執行正式 migration 或使用任何真實使用者 session。正式 migration 與 production data mutation 仍依 repo 規範另行批准。

官方 RLS 文件已經由 Supabase search_docs 核實 authenticated + auth.uid、UPDATE USING/WITH CHECK 與對應 SELECT policy；直接 changelog.md 下載遭 403，未宣稱完成 changelog 檢閱。

## 手動驗證（migration 部署後）

1. 套用 migration 並執行 postflight；確認 Data API exposed schema 包含 public，僅 authenticated 有表權限，不以 service_role 驗證隔離。
2. 手機有舊 key、未登入：設定框停用，提示未同步；舊 key 仍在。
3. 手機使用既有 Google 登入：名單自動合併上雲；看到「已同步至本人帳號」後，確認 `zhuge.office.members` 不存在。
4. 電腦以同帳號登入：看到相同名單；在電腦修改，手機回到頁面或等 30 秒看到更新；手機修改，電腦亦可見。
5. 斷網／阻擋寫入後重試遷移：顯示明確失敗，舊 key 原樣保留；恢復網路重試才清除。超過 24 人同樣保留並提示錯誤。
6. 另一個測試帳號：看不到第一帳號名單；以其 JWT 指定第一帳號 owner 的 SELECT 為空、INSERT 拒絕、UPDATE/DELETE 不改動任何列。未登入 REST 讀寫拒絕。
7. 登出：正式名單隱藏，設定框停用；不產生新的本機名單、不刪尚未成功遷移的 key。

## 交付狀態

SOURCE_STATE：指定 PR 分支，基於已 fetch 核實的 BASE_SHA；BUILD=20261102-1040。
MIGRATION_STATE：migration/postflight/rollback 已在本機實跑；正式 Supabase 尚未套用。
DEPLOY_STATE：未推 main、未部署。
RUNTIME_STATE：本機假名／假 token runtime QA 通過；正式手機 Google OAuth 與 production runtime 尚未驗收。
TASK_ID_AUTHORITY：未取得正式 Board/DB TASK ID，使用描述性分支與證據目錄，不建立 TASK 編號。
PUSH_AUTHORIZATION：使用者已明確要求建立此 PR 分支；沒有 main push 或 merge 授權。
