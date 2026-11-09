# ZG-71 最終稽核（補充 4–6，取代先前僅列缺口版本）

main 基準 `2ddf801287963f4909890e4ad6141202a85d24c8`（ZG-70 #246）。同一 PR #247，未部署、未 merge，正式庫只有唯讀 metadata／彙總查證。

## 唯一有效允許與最終建議

`private.app_access_effective_allowed(user_id)` 是唯一授權判斷；is_app_access_approved 用 auth.uid() 呼叫它；resolve 和 creator list 的 effective_allowed 用同一個函式；enabled 僅為相容別名。UI 只以 effective_allowed 顯示與切換，沒有自行用 pause 或歷史 status 猜測許可。

最終建議為由 main 明確啟用一次性「當下有效允許」凍結快照。migration 不啟用 cutoff，不改任何現有有效存取、不寫申請／凍結資料：

- cutoff 未設：保留原暫停語意，但 access_disabled 必定 false。
- cutoff 已設：批准事件（bootstrap/approved/enabled）為 true；disabled 永遠 false；其他狀態僅可在 pause=true 且身分已在受保護快照中時相容放行。cutoff 後新提出的 PENDING 仍需重新決定；新進 NEW/PENDING 為 Off、琥珀框與待審文字。
- 頂層只有名片／有效開關／待審文字；暫停開關移至名片下方、預設收合的「進階：過渡設定」。UI 不增加祖父或 cutoff 控制。暫停設定仍是原 creator setter，沒有自動切換旗標。相容期顯示「暫停審核中，登入者可直接使用；個別 Off 會被擋」，啟用後顯示「既有成員保留使用；新加入者需你開啟。個別 Off 會被擋」。

`ensure_app_member()` 無參數、只記錄 auth.uid()，Email／顯示名稱取該身分既有資料、不取頭像。private 表 first_seen_at 用 clock_timestamp，冪等 DO NOTHING；沒有新增 client time／其他 user_id 入口。共用 app-access-service 在 resolve 後對已登入的當前身分呼叫它，成功留卡才完成 getCurrent。anonymous 不留記錄，Off 不因此解除。

凍結判斷不使用使用者可回填的 app_users/user_profiles/worklog_users.created_at；owner-only `activate_app_access_model(integer)` 先鎖定決定事件與暫停設定表、再取 server clock cutoff，一次凍結當刻有效允許的身分（只回計數，不建名片）。cutoff 後新增／回填上述表都不會更新。private 表 RLS＋撤銷直接存取；EXECUTE 對 public/anon/authenticated/service_role 全部撤銷。

## 實際影響與部署證據

目前有效允許 **6**，有 App 證據 **5**，缺口 **1**。現有 APPROVED 5（bootstrap 4、application_approved 1）、NEW 1。migration 單獨部署仍 6／0。補充 7 已查 158 個 public/TF 與 6 個 private App 欄位來源，該帳號活動均 0，TF UUID/Email 對應 0；但 1–7 天前有 Google 登入、仍有 3 個未撤銷 refresh token，不能判定停用或測試。沒有合法活動來源可補建 membership，不依賴它下次登入。

固定建議：不判定缺口帳號身分，啟用不改任何人現行存取；以 owner-only `activate_app_access_model(6)` 凍結當下 6 人，結果 6 允許／0 Off；人數漂移則拒絕。凍結僅在暫停保持 true 時有效，且 TF 既有 session 不在 Off 涵蓋範圍。

- [逐函式 live 比對與影響表](../../../docs/zg71/live-definition-comparison.md)：正式庫 pg_get_functiondef 的七個定義與 baseline／新 migration，逐一列差異；list 重組不是純 additive。
- `tests/fixtures/zg71-live-function-definitions.json`：唯讀原文，無個資資料列；SQL 測試真的載入這七個 live 定義後套用新 migration。
- `docs/zg71/impact-readonly.sql`／`impact-counts.json`：正式庫彙總及可重跑的唯讀 SQL；current/no-cutoff/立即 A 投影分別計數。
- `20261106093852_app_access_review_pause_baseline.sql`：11/06 歷史 SQL 補錄，檔名為提供的台北核准時間 UTC 排序，非聲稱正式 migration history；DO NOTHING 不重設暫停。
- `20261108154522_reversible_app_access_switch.sql`：兩種新決定事件、creator setter、effective helper、首次記錄、快照啟用 function、舊寫入保護 trigger；不自行啟用任何新政策。
- [部署與已測回復](../../../docs/zg71/deployment.md)：SQL 次序、七個 Edge CLI/Dashboard 依賴、owner-only cutoff、精確 legacy rollback 與有新事件時的固定 compatibility rollback。新事件不能被舊 reader 安全解讀時，exact rollback 會原子拒絕；絕不刪改歷史或讓 Off 悄悄失效。

## A：新人前端入口盤點與沿用

共用 `shared/auth/app-access-gate.js` 原本已有 NEW 姓名／原因申請表、PENDING 等待卡、REJECTED 備註與重新申請。保留既有必填及 OAuth，不重做登入。PENDING 文案為「申請已送出，等待管理者審核」；明確 Off 顯示禁止與 review_note，沒有重新申請覆蓋 Off 的入口。

| 入口 | repo 實際位置 | NEW/PENDING/REJECTED |
|---|---|---|
| Board AI/WorkTodo/Procurement/Investment/template-preview | shared/components/golden-master-runtime.js requireApplicationAccess | 共用申請／等待／被拒畫面 |
| WorkLog（含 chat） | modules/worklog/worklog-app.js | 共用 gate |
| Investment 與 Lab | modules/investment/services/investment-module.js、labs/investment/app.js | 共用 gate |
| Skyeye | modules/skyeye/skyeye-app.js | 共用 gate |
| ERP | ZG-ERP/erp-auth.js | boolean 檢查，未通過顯示 denied，沒有申請表；本次不修改 ERP |
| TF | labs/taskflow/overrides + backend | 獨立 TF session，見下方邊界，不宣稱涵蓋 |
| 管理頁 | labs/taskflow/access-management/index.html + panel.js | 從原先只有 pause 設定，補成每人一張名片及篩選 |

名片來源：app_users、user_profiles、worklog_users、既有申請／bootstrap、自己的首次進入記錄聯集，一人一列；不把 auth.users 當名冊。只對已知 App ID join Auth 取得目前 Email；bootstrap 標既有核准、不偽造申請時間。textContent、原因展開、決定備註、aria、keyboard、確認／可選備註、送出鎖定、成功重讀及錯誤恢復均已測。creator 自己／其他 creator 禁止被 Off；權限失效清除名片。

## 伺服器授權覆蓋

七個使用者 JWT Edge 路徑已補 fail-closed：gas-vendor-bridge、investment-intelligence-read、zhuge-skyeye-read、task-attachment-ai-read、workspace-email-notification，以及同類 investment-screenshot-recognition、card-progress-email-notification。在任何資料／Provider 呼叫前，以 caller JWT 呼叫 canonical is_app_access_approved，false/null/非 boolean/HTTP/網路/格式/逾時一律拒絕。保留各函式原 auth/AAL2/owner/audit/冪等檢查，不以 service_role 替代 caller。

使用者／服務路徑逐一列於 deployment.md。engineering-transition／actor-broker／MCP／LINE 等合法 actor/service 路徑未修改。既有 zg-ledger-bridge 伺服器 gate 與已部署 fubon creator gate 保留。既有 72 個 public restrictive policies + realtime 2 條依賴同一 canonical 函式，精確列表為 `tests/fixtures/zg71-deployed-access-metadata.json`。repo 中 provisioning/workspace/workflow/archive 直接依賴與 board helper 間接依賴原封不動，授權繼承 effective 結果。

### 仍未涵蓋 TF 與其他界線

[TF 研究](../../../docs/zg71/taskflow-boundary.md)：有 Supabase UUID → TF user.id 的既有對應，但之後是 TF 本地簽發 JWT/cookie/PAT，登入時有既有 TF→Supabase server helper，可做僅新登入的最小檢查；後續 session 沒有可轉送的 Supabase caller JWT 或現成逐請求 canonical 查詢介面。新增跨 schema grant／server-to-server 信任會超出「重用現有機制、不得新增憑證橋接」；本次不冒充僅登入查一次即完整 Off。UI 明示「目前不涵蓋 TF 的獨立工作階段」。

也不撤銷已下載資料、本機快取／Storage signed URL；沒有新 gate 的後新增表（office roster 等）仍靠其既有 RLS。服務／actor、學習島及 frozen 範圍未修改，不宣稱每人開關覆蓋這些路徑。

## 測試與視覺證據

- SQL：48 組 cutoff × pause × old/new × 六狀態；is_approved == resolver.effective_allowed == list.effective_allowed == enabled。測試 UI 直接採這份本地 SQL 計算出的 48 組結果，逐一比 aria-checked，不是獨立抄一份 JavaScript 政策。
- SQL 另測：所有舊 resolver 欄位／事件在 migration 前後相等、REJECTED 暫停現況、RLS 真正拒讀、creator 自鎖禁止、On/Off 冪等／衝突、legacy decided review 40001、重送不可蓋 Off、私表拒讀、伺服器時間與回填防護、activation 預期影響計數 gate（不再等待登入補證據）。
- rollback：七個 live function body 完全還原、trigger 移除；新決定後 exact rollback 拒絕，compatibility rollback 保留 Off 與歷史。測試全部為一次性 PGlite，不接正式庫。
- Edge：七個真 handler 在 fake RPC 下執行 false/null/錯格式/HTTP/network/timeout，Provider／資料讀寫為 0；true 通過至既有驗證。
- `docs/zg71-screenshots/`：已提交 TEST DATA 桌面／手機主畫面（待審琥珀框、On/Off、暫停區、禁止卡）、空狀態與錯誤狀態各兩張 PNG；沒有正式個資。測試 runtime fixture 只在 tests，不進產品路徑。
- TF Python 84 PASS；baseline 三項在乾淨 main 與分支均保留：mobile-actions 116.1875、compact-header 116.1875、investment providers 16 PASS / 1 FAIL。不得說全測試通過。
- 同 head 遠端 CI 結果與完整 diff 清單記錄在 PR，release sync／Published C gate 沿既有流程。FullSource 仍受既有全測試 PASS gate 阻擋，不偽造 PASS。

正式部署、cutoff 啟用、真實帳號 Off/On、Provider 生產連線、Render 部署 SHA／session 強制效果均未執行。正式 SQL／Edge 部署及 merge 必須由 main 最終 review 後處理。
