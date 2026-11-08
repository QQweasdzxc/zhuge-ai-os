# ZG71 部署與回復（main 執行；本 PR 未執行）

## 固定建議與次序

1. 先重跑部署前的 `impact-readonly.sql`、比對 live 7 個函式與 capture。若有 drift，重新 review；不要直接全量 db push。
2. 按先前 audit 的歷史 migration 次序核對 11/06 baseline，再部署 ZG71 migration。cutoff 不會被 migration 設定，沒有任何會員回填／祖父資料寫入；此步 6 個現有有效允許仍為 6。
3. 部署下列 7 個 Edge 與 `_shared/app-access.ts`，再部署同一 PR 的 Pages gate/UI。所有使用者路徑在資料或 Provider 呼叫前，用 caller JWT（anon apikey）呼叫 is_app_access_approved；不是 service role。
4. 依補充 7 的唯讀查證，1 個身分沒有可驗證 App 活動，卻仍有近期 Google 登入／未撤銷 refresh token；不推定測試或停用，不補建 membership，不依賴它下次登入，也不替它建立名片。啟用時它與其他現行允許者一樣被凍結，存取不變。
5. 部署 migration 後重新唯讀計算「當下有效允許」人數（目前 6）。main 確認後執行 `activate-cutoff.sql` 的一行 `select private.activate_app_access_model(6);`；整數是剛核對的當下有效允許人數（防漂移），不是 ID 名單或時間。函式只回傳計數：鎖定決定事件與暫停設定表至 commit 為止（併發的決定／首次登入事件等 commit 後才寫入，其 server clock 晚於 cutoff），鎖定之後才取 cutoff（clock_timestamp），一次讀取當下有效允許的身分集合並凍結，不建立名片／member，不傳回身分；人數不符則整筆拒絕，不寫 cutoff 也不寫凍結資料。預測 6→6 允許、0 Off，不改暫停旗標、不回填／重設事件。啟用期間才在 Auth 建立的身分不在集合內，視同日後新進者。
6. cutoff 啟用後新進 NEW/PENDING 一律 Off；凍結名單的相容放行僅在暫停 true 時成立（暫停關閉後凍結者若無明確 On 會失去存取，故暫停先保持開啟，待每人有名片與決定）。cutoff 後重新提出申請需再明確 On；access_disabled 永遠優先。無法藉回填 created_at 或重送 ensure 取得凍結資格。

## Edge 使用者／服務路徑界線

| 函式 | 使用者路徑 | 服務路徑 |
|---|---|---|
| gas-vendor-bridge | getUser → App access → Google SA Sheet 讀寫 | Google SA 是後續 Provider 憑證，不是跳過使用者檢查的入口 |
| investment-intelligence-read | getUser → App access → market/news Provider | 無內部 service 入口 |
| zhuge-skyeye-read | getUser → App access → TDX/CWA 等 | 無內部 service 入口 |
| task-attachment-ai-read | 原 JWT 形狀檢查 → App access（資料庫驗證 JWT）→ OpenAI | 無內部 service 入口 |
| investment-screenshot-recognition | 原 AAL2 條件保留 → App access → OpenAI | 無內部 service 入口 |
| workspace-email-notification | getUser → App access → 原 workspace owner/audit/idempotency → admin DB/Resend | service_role 僅後續 server DB client，不是合法外部 caller 跳過路徑 |
| card-progress-email-notification | getUser → App access → 原 task/audit → admin DB/Resend | 同上；補齊 repo 另一個相同類型使用者路徑 |

engineering-transition、engineering-actor-broker、zhuge-task-074-mcp、zhuge-line-task-runtime 等既有 actor/service 入口原封不動。fubon 已部署的 creator + access 檢查不改。既有 zg-ledger-bridge 不改。沒有新增 secret 或環境變數。

Node fake-RPC 測試實際執行上述七個 TS handler（移除 imports，純工具 import 由 stub/純 normalizer 替代），false/null/object/string/HTTP error/network/malformed/timeout 均 403 且資料／Provider 讀寫為 0；true 繼續既有輸入驗證。新 helper 的 timeout 為 8 秒，錯誤／逾時故意 fail closed。正常健康路徑下正式目前 6 人的原 canonical RPC 均為 true，因此不改變其有效資格；故障時則依要求拒絕，不能承諾網路故障仍可使用。

## 指令（只提供，不執行）

在 repo 根目錄、以 main 審核的精確 commit checkout，用現有 Supabase 登入部署每一個函式（保留原 verify_jwt 設定，不加 --no-verify-jwt）：

```sh
supabase functions deploy gas-vendor-bridge --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy investment-intelligence-read --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy zhuge-skyeye-read --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy task-attachment-ai-read --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy investment-screenshot-recognition --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy workspace-email-notification --project-ref lenpbbhwxyyfwgvjcozf
supabase functions deploy card-progress-email-notification --project-ref lenpbbhwxyyfwgvjcozf
```

CLI bundling 會帶入被 import 的 `_shared/app-access.ts`；Dashboard 部署則必須同時上傳整個依賴檔案樹，不能只貼 index.ts。部署前先用本機已安裝 CLI 的 `functions deploy --help` 確認版本選項，逐函式記錄 deploy version/hash；未部署的函式不能標示已受新 gate 保護。Dashboard/CLI 都只應由 main 在批准後執行。

## 經 PGlite 測試的回復

- 尚無新 access_enabled/access_disabled 事件且 cutoff 未啟用時：執行 `rollback-legacy.sql`，逐一恢復七個 captured live 定義，移除新 guard 與新 RPC；private membership、擴充 CHECK 和歷史資料保留。測試驗證 7 個 function body 和 capture 完全一致、trigger 已移除。
- 已有新決定或已啟用 cutoff 時：**固定採 compatibility rollback** `rollback-compatible.sql`，撤銷管理決定 setter 的 EXECUTE（保留 ensure，避免現行 gate 被一併阻斷），保留新 resolver/effective helper/guard、所有事件及快照；回復有問題的 UI/Edge 實作時必須保留 App-access 強制檢查（可直接重部署最後已驗證的這個 gate 版本）。
- 禁止直接把有新事件的資料庫退回原 reader：舊 reader 不認得 access_disabled，暫停會重新放行。`rollback-legacy.sql` 會在任何修改前拒絕此狀態；已測拒絕後事件與 trigger 仍在，明確 Off 仍 false。這是已驗證的安全回復限制，不是自動刪除／翻譯歷史的分支。
- 不回退事件 CHECK、不刪除／update append-only 事件。不得直接重部署缺少 gate 的舊 Edge（會使 Off 重新繞過）；需修復／回復最後有效 gate 的來源再部署。正式 Provider 連線、deploy 操作及 Dashboard UI 本次未測試。

Compatibility 回復後完成修復及相同 head QA，再由 main 重新授予 setter 的 authenticated EXECUTE；不需要重新產生 cutoff、快照或改動任何事件。Forward migration 可重播，測試驗證不重寫事件與 cutoff；歷史 11/06 baseline 不得在有新決定後單獨重播，因其舊 reader 不識別 Off。

## 實際部署紀錄（2026-11-09，production lenpbbhwxyyfwgvjcozf）

狀態：**半部署，未 merge、未 activation、cutoff 未設定、內部 pause 仍為 true。**

- 06:59 Stage 1：以 Dashboard SQL editor 只套用 reviewed 新 migration（SHA-256 `c100448d73312d072c581bbb5e06be8e4c83a710b8d0d554129f87b71a8b5d9`），未執行 db push 或 baseline。回讀：3 個函式依設計改變（resolve_app_access、is_app_access_approved、list_app_access_applications）、4 個不變；effective allowed 6／blocked 0／members 0／grandfathers 0／Off 事件 0；權限依設計（anon 不可執行新函式）。
- Stage 2 以 Dashboard Edge Functions editor 部署，皆加入 `../_shared/app-access.ts`（sha256 前綴 `67f1457dfd11201c`），verify_jwt 部署前後皆開啟，部署後重新載入逐檔比對 SHA-256 前綴：
  - task-attachment-ai-read：index `021fb1da79de9cf3`（以 PR head 內容部署）
  - investment-screenshot-recognition：index `b26ce1460ce11d33`（head 內容）
  - gas-vendor-bridge：index `bc1a4662804505da`（head 內容）
  - zhuge-skyeye-read：index `6fafaad05d366d40`，**live 相容 gate-only 版本**（`docs/zg71/live-compat/zhuge-skyeye-read.gated.ts`；live 原始碼見 `.live.ts`，只多 3 行 gate；不含 main 的天氣快取）
  - workspace-email-notification：index `4a7310ec7109cced`，**live 相容 gate-only 版本**（`docs/zg71/live-compat/workspace-email-notification.gated.ts`；不含 main 的 cc/bcc、card_url、From name 變更）
  - 另四個函式的 live 版本與 main 只差品牌字串（Tron OS／TRQN OS）；部署 head 會把該字串換成 TRQN OS。
- 尚未部署：investment-intelligence-read。Dashboard bundler 無法解析 `../../../labs/...` 相對依賴（Module not found，live 未變），需等價打包或 CLI／CI 部署路徑。**此函式尚無 gate，Off 使用者仍可用自己的 JWT 呼叫（消耗 provider 額度，無使用者資料）。**
- card-progress-email-notification 未部署於 production，無需 gate。
- Edge 部署不會自動回復；回復方式為重新部署 live 原始碼（`*.live.ts`）並刪除 `../_shared/app-access.ts`，但這會移除 gate，須先確認狀態。
- 驗證限制：未用真實使用者 JWT 探測；匿名金鑰探測得到函式自身的 401。尚未啟用 cutoff，因此 gate 對現有 6 個可用帳號都放行。
