# ZG71 部署與回復（main 執行；本 PR 未執行）

## 固定建議與次序

1. 先重跑 `impact-readonly.sql`、比對 live 7 個函式與 capture。若有 drift，重新 review；不要直接全量 db push。
2. 按先前 audit 的歷史 migration 次序核對 11/06 baseline，再部署 ZG71 migration。cutoff 不會被 migration 設定，沒有任何會員回填／祖父資料寫入；此步 6 個現有有效允許仍為 6。
3. 部署下列 7 個 Edge 與 `_shared/app-access.ts`，再部署同一 PR 的 Pages gate/UI。所有使用者路徑在資料或 Provider 呼叫前，用 caller JWT（anon apikey）呼叫 is_app_access_approved；不是 service role。
4. 相容觀察期讓缺口帳號自己下次進入，由 ensure_app_member 產生名片；creator 明確確認 On。不得替未進入者建立記錄，也不以 Auth created_at 推定成員。
5. 重新計數，缺口必須為 0、已確認的存取不變，才由 main 執行 `activate-cutoff.sql` 的一行 `select private.activate_app_access_model();`。函式為 owner-only，現在缺口 1 時會拒絕。它用 server clock 並一次封存 App 名單，再設定 cutoff；不改暫停旗標、不回填／重設事件。
6. cutoff 啟用後新進 NEW/PENDING 一律 Off；舊快照的相容放行僅在暫停 true 時成立。cutoff 後重新提出申請需再明確 On；disabled 永遠優先。無法藉回填 created_at 或重送 ensure 取得祖父資格。

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
