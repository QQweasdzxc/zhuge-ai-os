# TF Off 邊界研究結論

本次不宣稱 Off 涵蓋 TF；管理頁有明確文案，且沒有改 TF 登入、token 或加入憑證橋接。

有對應鍵，但不等於已有可用的每次請求授權通道：

- `labs/taskflow/overrides/zhuge_auth.go`：`verifyZhugeIdentity` 用收到的 Supabase token 呼叫 `/auth/v1/user`；`ensureZhugeUser` 將 `identity.ID` 作為 TF user.id，並檢查相同 Email 不可綁另一 UUID。這是既有同 UUID 對應，不是只能猜 Email。
- 同檔 `ZhugeLogin` 之後呼叫 `h.issueJWT(user)` 與 `auth.SetAuthCookies`，簽發 TF 本地 JWT/cookie；原 Supabase access token 不存入本地 user、session 或資料請求。
- frozen `third_party/multica/server/internal/middleware/auth.go` 的後續請求以 TF `auth.JWTSecret()` 驗簽，還有 PAT、Cloud PAT、agent token 等路徑；不是 Supabase JWT，不能轉送給 Supabase `is_app_access_approved()` 冒充 caller。
- `labs/taskflow/patches/apply-zhuge-house-rules.py` 封閉 native 人類註冊／邀請等入口；`apply-zhuge-identity.py` 及 Dockerfile.backend 維持既有 bridge。這次沒有修改這些來源。
- 正式庫唯讀 roles metadata 有 multica_lab_runtime、taskflow_runtime、taskflow_migrator；有資料庫角色不代表既有 middleware 已獲得 App 授權介面。repo 的 DB boundary overlay 限定 TaskFlow schema，沒有可依已驗證本地 UUID 查 canonical App 存取的既有受控 method／grant。

因此無法只重用現有 caller-JWT RPC，在不新增跨系統授權通道的前提下，對所有既有 TF session 即時套用 Off。只在登入時查一次也無法處理已簽發的 cookie/PAT，不會把此作法冒充可逆 Off。

建議的安全後續路徑是：由 main 另行批准 server-to-server、僅對已驗證 TF human UUID 的 canonical 查詢接口，最小資料為 boolean；加入 TF middleware 的 human JWT/PAT 路徑並保留 actor/service 路徑。需新增跨 schema 的最小 EXECUTE grant 或受控服務信任、fixture/schema/效能與失敗策略測試；不是讓瀏覽器傳任意 Email／user_id、儲存 Supabase token、重簽或轉送憑證。此信任介面不在現有機制內，本次不新增。

`tests/zg71-taskflow-boundary.test.cjs` 驗證 repo 中同 UUID → 本地簽發 → 本地 middleware 的上述邊界與 UI 不涵蓋說明。這是 source-level 結論；沒有登入 Render 正式 TF、沒有撤銷 TF 真實 token，也不推論尚未核對的 Render 部署 SHA。
