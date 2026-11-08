# ZG-71：新人與既有成員名片／可逆使用權開關

main 基準：`2ddf801287963f4909890e4ad6141202a85d24c8`，ZG-70 #246，`0.9.0-alpha.9.189`。
新版本與 Build 由既有 release sync 連動，詳見 RELEASE.md 的 ZG-71 紀錄。

## 政策與部署過渡

只有 **最新事件 `access_disabled`** 是不受全站暫停繞過的個人 Off。
歷史 `application_rejected` 不追溯轉為 Off。暫停開啟時 REJECTED、PENDING、NEW
仍維持原先可進入；關閉暫停時回復原狀態（REJECTED 禁止，PENDING／NEW 待審核）。
名片開關反映當下的實際使用權；PENDING／NEW 另以琥珀框、文字與 aria 標記。
因此暫停中的歷史 REJECTED 名片為 On；它不是新審核，也不寫入任何轉換事件。
暫停中的 PENDING 可以是 On 並保留待審標記；關閉暫停後未決 PENDING 為 Off。
On／Off 的實際寫入必須經確認與一次性寫入前重新驗證。On 對 PENDING 寫
`application_approved`，其餘 On 寫 `access_enabled`；Off 寫 `access_disabled`。
每個事件保留原 application_id，沒有申請紀錄的 App 成員第一次被切換才產生新 ID。
備註、reviewer 與冪等 key 保留在 append-only 歷史；沒有回填或批量狀態轉換。

### Migration 次序

1. `supabase/migrations/20261106093852_app_access_review_pause_baseline.sql`：補入 11/06
   已執行 SQL 的基準。檔名使用用戶提供的 17:38:52 台北核准時間換算 UTC 09:38:52
   作為排序時間，**不宣稱它是正式庫既有 migration history 的版本號**。
   11/08 唯讀 list_migrations 未見該暫停 migration，應是歷史 ad-hoc SQL；main 須核對及協調
   部署記錄，不能直接用未經核對的全量 db push。此處沒有修改正式庫 migration history。
   與原文唯一的旗標初始化差異是 `ON CONFLICT DO NOTHING`，不覆寫既有 false／true／updated_at。
   表 `IF NOT EXISTS`、函式 `CREATE OR REPLACE`，不重建既有表、不重播原文的強制 true upsert。
2. `supabase/migrations/20261108154522_reversible_app_access_switch.sql`：以 CLI 建立，接續基準。
   完整 replace 存取函式，不依賴當前旗標值；新增事件、constraint、creator RPC 與每人清單。
   先部署 SQL 再部署 UI；舊 UI／RPC 繼續使用既有狀態名稱和欄位。
   resolve 只新增 `access_disabled`／`enabled`，保留所有既有欄位與暫停覆寫 status 的語意。
   舊版 review 保持只能審 PENDING；新 guard 阻止重送申請／舊 application 的 review 蓋掉 Off。

正式庫查證僅 `pg_get_functiondef`、schema／policy／migration metadata、彙總計數及 Edge
source fetch。未執行 DDL、submit、review、set_* 或任何真實使用者操作。

## A：新人入口稽核（修改前）

| 入口／實際位置 | NEW | PENDING | REJECTED |
| --- | --- | --- | --- |
| 共用 `shared/auth/app-access-gate.js`、service.js | 既有姓名／原因申請表呼叫 submit_app_access_request；Email 唯讀 | 既有等待卡，無重送表單 | 既有審核備註與重新送申請表 |
| Board AI／WorkTodo／Procurement／Investment／template-preview：`shared/components/golden-master-runtime.js` requireApplicationAccess | 使用上述共用 gate | 同左 | 同左 |
| WorkLog：`modules/worklog/worklog-app.js`、chat 入口 | 使用共用 gate | 同左 | 同左 |
| Investment：`modules/investment/services/investment-module.js` requireAppAccess；Lab `labs/investment/app.js` 注入共用 service/gate | 使用共用 gate | 同左 | 同左 |
| Skyeye：`modules/skyeye/skyeye-app.js` | 使用共用 gate | 同左 | 同左 |
| TF：`labs/taskflow/overrides`，既有獨立 TF auth | 無 Supabase App 申請 gate | 無此狀態畫面 | 無此狀態畫面 |
| ERP：`ZG-ERP/erp-auth.js` | boolean 存取檢查 false 為 denied；沒有申請表 | 同左 | 同左 |
| 管理頁 `labs/taskflow/access-management/index.html` + panel.js | 原先只顯示 creator 暫停設定，未列申請紀錄 | 同左 | 同左 |

既有申請表沿用，沒有新增必填欄位／OAuth 流程。PENDING 文案改為
「申請已送出，等待管理者審核」。明確 Off 的 resolver 仍回 REJECTED，另外帶
`access_disabled=true`；共用 gate 顯示「目前禁止使用」、review_note，隱藏重新申請表。
歷史 REJECTED 原有重新申請行為保留。ERP／TF 本次只稽核，不變更其授權或登入。

## 成員來源與缺口

creator 專用清單取下列 **App 內已有身分證據**的聯集，以 auth UUID 去重，每人一張：

- `public.app_users.auth_user_id`（既有 App 與 creator／owner 身分）；
- `public.user_profiles.user_uuid`（WorkLog cloud profile，既有 repositories.js upsertUserProfile）；
- `public.worklog_users.auth_user_id`（WorkLog 核心使用者）；
- `private.app_access_application_events.applicant_user_id`（含 approved_bootstrap 與新人申請）。

只對上述身分 join auth.users 取得目前 Email；不把 auth.users 當名冊來源、不讀 metadata
或 Google avatar、不增加其他個資。回傳開關、狀態、既有姓名／Email／原因／決定備註、
申請／最近決定時間及 creator 鎖定旗標。沒有申請的成員不偽造申請時間；bootstrap 顯示「既有核准」。
既有 list_app_access_applications 仍是 creator + 原使用權檢查；私有 identity helper 不開放 execute。

唯讀彙總確認正式庫有 **1 個 Auth 帳號不在上述四類證據內**；不能判斷其是否屬於本 App。
暫停時 resolver 本身確實會放行任何已登入者，故無法承諾清單完全涵蓋這類無證據訪客。
**待 main 決定**：首次成功進入 App 時以既有受控路徑留下最小 membership 記錄
（user_id、首次進入時間，姓名／Email 沿用既有來源），再納入清單；本次不加登入寫入、不新增服務、
不把無證據 Auth 帳號直接公開給 creator。不標示「完整使用者名冊」。

## Off 會真的擋住的路徑

以下為新 migration 部署後，下一次相關授權／資料請求的效果；不撤銷 JWT、不移除已下載的資料，
不承諾已開啟分頁會立即自動消失。

- 共用前端 gate 的上述入口，下一次 resolve 後擋住；這是 UI gate，資料保護仍取決於以下後端。
- 已部署 `zg-ledger-bridge` v22：caller JWT 下 `requireApproved` 呼叫 is_app_access_approved，
  在任何 Google Sheet 讀寫之前 fail closed；ERP 設備資料讀寫受此伺服器檢查保護。
  source SHA256 `a32ae53a01b65a01941821614a6885803fee3c62a7adf0995d7cb7c72ec36f02`。
- 已部署 `fubon-compatibility-proof` v6（非一般帳戶 API）：先查 creator，再查 is_app_access_approved。
  此 deployed source 也列入稽核，repo supabase/functions 的直接字串搜尋沒有涵蓋它。
- 已部署 public 表上現存 `zhuge_app_access_approved_gate` restrictive RLS（72 表）；
  realtime.messages 的 read／track policies（2 條），每次授權都依 canonical function。
  完整精確表名、qual、with_check 保存在 `tests/fixtures/zg71-deployed-access-metadata.json`，共 74 條，沒有資料列。
- 已部署直接依賴此函式的 RPC：list_app_access_applications、get_app_access_application_history、
  review_app_access_application、get_creator_user_notes、upsert_creator_user_note、board_instance_can_read、
  board_provision_c_consumer_v2、board_create_instance；submit_app_access_request 使用 resolve 返回狀態。
  新 setter 本身也檢查 creator + 原使用權，不能使用者自助解除 Off。
- repo migration 的其他直接依賴：20260916093500（personal WorkTodo provisioning）、
  20261003021318（workflow canvas）、20261004025202（workspace create）、20261005060842
  （project assignment）、20261005230418（archive/restore）及 phase1 的 Board helper／RLS／Presence。
  這些是 repo 證據；唯讀正式庫直接依賴清單只有 metadata 記錄的 9 個函式，不能推論所有 repo migration 已部署。
  經 board_instance_can_read 等 helper 間接呼叫的路徑繼承該檢查；不把所有 SECURITY DEFINER RPC 一概宣稱受保護。

## 目前繞過／不能承諾 Off 擋住的路徑（只稽核）

- `gas-vendor-bridge`：repo requireUser 和已部署 v25 均只驗證 auth.getUser，隨後以 Google
  service account 讀寫廠商 Sheet，**直接 API 不受 Off 擋住**。前端 gate 不能補上伺服器缺口。
  deployed SHA256 `7710a6efeb15e0699c648028cd78cfc88486c4560e9041b6dbb4501c701ce751`。
- 已部署 `investment-intelligence-read` v8、`zhuge-skyeye-read` v3 只檢查登入；
  `task-attachment-ai-read` v3 有 bearer/JWT 檢查但未呼叫 App 存取 resolver。其直接 Provider API 不受本開關管制。
- `workspace-email-notification` v23：auth.getUser + service role 路徑，沒有 App 存取檢查；
  engineering-transition v41、engineering-actor-broker v6、zhuge-task-074-mcp v12、
  zhuge-line-task-runtime v4 使用獨立 actor/service credential 授權，未見直接 App access gate。
  這些獨立憑證／服務路徑不宣稱被每人 Off 撤銷，也不在本次修改範圍。
- `investment-screenshot-recognition` deployed source 連續兩次 fetch 回 MCP internal error，未核實；不宣稱受保護。
- TF 使用獨立 multica_lab／TF 身分與 backend；設定只另開 Pages，不代表 TF backend 加入 Supabase gate。
- 之後新增但沒有 phase1 restrictive gate 的表（例如 office_member_roster／prefs）與其他自有 RLS、
  service-role／BYPASSRLS、已簽發 Storage URL、本機快取，都不能由這次開關概括保證阻擋。
  frozen third_party 與學習島不讀寫修改；獨立授權／遊戲系統不納入 App 名冊或開關生效承諾。

**待 main 決定**：各缺口是否要另外立工作單補後端授權；本次不修改任何上述呼叫端授權邏輯。
暫停開關的既有 creator-only setter 刻意不要求 App access，以免自鎖，行為保留。

## UI 與驗證

名片純 textContent／DOM，沒有 innerHTML。姓名縮寫、原因 details、狀態文字、aria-checked、
原生 button 鍵盤操作；全站暫停獨立區域。creator 自己與其他 creator 卡禁用；每次寫入前
驗證 auth user + canonical creator、送出期間鎖定；成功重讀清單，失敗保留開關原狀並報錯。
非 creator／401／403／網路錯誤清除個資，載入與空狀態有明確文字。

- `node --test tests/zg71-app-access-sql.test.js`：真實 SQL 在一次性 PGlite PostgreSQL，
  含 `tests/fixtures/zg71-access-contract.sql`。使用 repo 真實事件表／immutable trigger／legacy RPC。
  測試 baseline replay 不重設 true 或 false；新 migration 前後所有舊 resolver 欄位逐一相等，
  所有事件逐一相等；REJECTED+暫停仍進；Off+暫停被拒；實際 restrictive RLS 的 SELECT 回 0；
  On/Off 可逆、原 application_id、冪等衝突、備註上限、無關 Auth 帳號排除、私表拒讀、creator 不可自鎖。
- `node --test tests/app-access-phase1.test.js tests/taskflow-access-management-browser.test.js tests/zg71-access-cards-browser.test.js`：
  共用 gate 與 Playwright 假 RPC，全數攔截網路，不會送正式申請。
- TF Python 84 項 PASS；本次未改 frozen 或 TF overlay 行為。
- 乾淨 main 與分支各自重跑 baseline：mobile-actions header **116.1875 FAIL**；
  compact-header **116.1875 FAIL**；investment providers **16 PASS / 1 FAIL**（舊品牌斷言）。
  全部保留，不能宣稱全測試通過。
- TEST DATA 桌面／手機截圖由測試本地渲染產生於 `tests/evidence/zg71/TEST-DATA-desktop.png`
  與 `TEST-DATA-mobile.png`；fixture 只在 tests，不進正式頁面路徑。
- CI 已加入 SQL 測試與名片 browser test；遠端 CI 結果以 PR actual head 為準，不以本地 PASS 代替。

未驗證：正式 migration 部署（本次禁止）、正式帳號開關／真實 OAuth、Render TF rollout、
所有未接 gate 路徑的實際 runtime 行為、完整成員涵蓋、真實網路效能與併發壓力；PGlite 為 PostgreSQL
但非正式 Supabase 相同 server/extension 環境。沒有 merge 或部署授權。

FullSource Review 包裝：BLOCKED。release-governance.js 要求 governance/checklist/full/browser
等全部為實際 PASS；已知 baseline 仍 FAIL，不能產生正式 FullSource，未繞過 gate。
新 fixture 的檔尾空白 CI 失敗已修正；新增 legacy review 在 Off 後不可覆寫的 SQL 測試通過。
