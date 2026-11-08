# TF 身分、資料與 App Off 邊界實證（補充 7）

UI 只稱「App 使用權」，明示不涵蓋 TF 獨立工作階段；不是整個系統的帳號停用，也不把服務／actor 通道稱為「使用者鎖定」。本次未修改 TF 登入、token、角色權限或加入憑證橋接。

## 實際來源與既有管道

| 證據位置 | 可證明的事實 |
|---|---|
| labs/taskflow/overrides/zhuge_auth.go: zhugeSupabaseRequest、verifyZhugeIdentity | **存在 TF→Supabase 伺服器 HTTP 管道**：用既有 ZHUGE_SUPABASE_URL/ANON_KEY 及該次登入收到的 Supabase access_token 呼叫 /auth/v1/user。目前這個 helper 的唯一呼叫點就是 verifyZhugeIdentity。不能說 TF 完全沒有 Supabase 呼叫。 |
| 同檔 ensureZhugeUser | identity.ID → TF user.id，為同一個 UUID；相同 Email 不得綁另一個本地 UUID。Email 是一致性檢查，不是可任意指定的授權鍵。 |
| 同檔 ZhugeLogin → h.issueJWT、SetAuthCookies | 核驗 Supabase 後改由 TF 簽發自己的 JWT/cookie。沒有保存／轉送原 Supabase token。 |
| frozen server/internal/handler/auth.go issueJWT | 簽發者是 **TF backend**，HS256、auth.JWTSecret()（既有 JWT_SECRET）；sub 是 TF user UUID，含 sid/iat/exp，這段簽發碼沒有 iss claim。不是 Supabase issuer 的 JWT。沒有讀取任何 secret 值。 |
| frozen server/internal/middleware/auth.go | JWT 以 TF JWTSecret 驗簽；另外有 human PAT 與 task/Cloud PAT 等獨立路徑。App Off 沒有接入此 middleware。 |
| frozen server/internal/handler/session.go RefreshSession、auth/session.go RenewSessionToken | 原生 session refresh／cookie sliding renewal 只解析並重簽 TF 本地 token，沒有可供 Supabase caller-RPC 使用的 token。 |
| zhuge_auth.go ZhugeIssueCliToken；apply-zhuge-identity.py、patch-cli-auth-middleware.py | 已驗證 TF user → 一次性 CLI code → 原生 PAT。既有 IsTemporarilyDisabledUser 是 TF 的另一個本地暫停 gate，**不是** App Off 資料。 |
| Dockerfile.backend、apply-taskflow-db-boundary.py | staged native migrations 與其顯式物件使用 taskflow schema；不是把公開 App schema 當 TF 私有資料。 |

正式庫 schema metadata 確認有 taskflow.user 及其 user_id/activity 資料欄位；缺口帳號在 TF UUID、Email 及活動欄位匹配均為 0。正式庫唯讀 privilege metadata：`taskflow_runtime`、`multica_lab_runtime` 對 public.is_app_access_approved() 的 EXECUTE **皆 false**，private schema USAGE **皆 false**。沒有在此 PR 補 grant 或變更資料庫角色；連線角色本身也沒有 Supabase caller 的 auth.uid()，不能只靠 UUID 相同就假裝 RPC 已接通。

## gate 位置與技術限制

| 位置 | App Off 現況 | 最小改動能做到的範圍 |
|---|---|---|
| ZhugeLogin：verifyZhugeIdentity 後、ensureZhugeUser／issueJWT 前 | 尚未檢查 App Off | 這一刻確有有效 Supabase caller token，可重用既有 server helper 查 is_app_access_approved，拒絕新的 TF 登入。 |
| ZhugeIssueCliToken／PAT 交換 | 尚未接 App Off；既有 TF 本地暫停獨立存在 | 只有本地 TF 身分／原生 token；不能把它當 Supabase JWT 呼叫相同 RPC。 |
| RefreshSession／sliding renewal | 尚未接 App Off | 同上，沒有原 Supabase token；登入時查一次不會擋已存在 session 的續期／資料請求。 |
| JWT/PAT middleware 的使用者資料路由 | 尚未接 App Off | 要完整可逆 Off，仍需已驗證 native human UUID 的受控 server-to-server 查詢介面／明確授權，不是轉送本地 JWT 或接受客戶端 Email。 |

**固定最小建議**：如果 main 後續批准修改 TF 登入授權，只在上述 ZhugeLogin 已有 caller token 的位置重用 zhugeSupabaseRequest，以 8 秒 timeout、HTTP/JSON/false/error 全部 fail closed 呼叫 `/rest/v1/rpc/is_app_access_approved`，再發 TF token。這不需新增 secret、不保存 Supabase token、不建立新橋接，但僅涵蓋**新登入**，不能宣稱涵蓋所有 TF session。依本次「不改 TF 登入」限制，這是具體建議而未實作；目前 UI 仍如實標示 TF 未涵蓋。

技術限制是 native token 與缺少既有每請求授權介面，**不是宣稱登入處技術不可查詢**。另一方面，engineering-transition／actor-broker／MCP／LINE runtime、TF agent/service token 是獨立服務授權，不是可用 App 使用者開關概括撤銷的「未鎖定使用者」；此次原封不動。

`tests/zg71-taskflow-boundary.test.cjs` 驗證以上 repo 的簽發、對應鍵、唯一 Supabase 呼叫、refresh、native middleware 與 UI 文案。沒有核對 Render 正式 deploy SHA、登入真實 TF、讀取密鑰、撤銷 token 或執行生產 gate；source 證據與資料庫 metadata 不冒充已部署 runtime 測試。
