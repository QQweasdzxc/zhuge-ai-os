# Issue #118｜Runtime Readiness／PM UAT 決策包

基準：PR #120 `6c76be5254ce3c9a89106cb2ac0552d42e262309`（`.9.139` 候選）\
本文件只描述可供 PM 操作驗收的流程與閘門；它不授予任何 OAuth、ACL、Secrets 或 Production 權限。

## 目前決策

`SOURCE_READY / ISOLATED_QA_READY / AUTH_RUNTIME_NOT_VERIFIED / PRODUCTION_NOT_DEPLOYED`

CI 已驗證路由、登入回返邏輯、錯誤狀態與跨尺寸版面。正式驗收仍必須由 PM 使用已批准的帳號與實際 Preview／正式候選 URL 完成；本地 Codex、Fixture、GitHub Actions 成功都不代表 Provider、OAuth 或 Workspace ACL 已可用。

## PM 實際操作流程

1. 由 Pixel Office 根頁開啟打卡鐘。確認使用的是既有 WorkLog 登入 URL，且 query 保留 `officeReturn=1`；不得把外部 `returnTo` 當作目的地。
2. 完成既有登入、Workspace 與 App Access／ACL 審核。未登入、未批准或 Runtime 尚未 ready 時，頁面應停留在登入／拒絕狀態，不應跳回辦公室。
3. 核准後只允許一次性回到 Pixel Office 根頁；回返意圖 10 分鐘後失效，重整或重播不得再次導向。
4. 從辦公室開啟 TaskFlow、WorkLog、Investment 與 TaskFlow 既有 Apps。各入口應使用既有 Shell、SSO、Workspace context 與原生模組資料。
5. 在 TaskFlow／WorkLog 內使用可見的「返回 Pixel Office」導覽；登出後確認 Session 已清除，頁面仍提供安全的辦公室入口，不能自動帶入上一個使用者的 Workspace。
6. 切換 Workspace 後重新整理，確認資料與 ACL 仍以目前 Workspace 為範圍。直接貼入另一 Workspace URL、過期 Session、401 或 403 都必須停在錯誤／登入狀態，不能顯示成功或跨 Workspace 資料。

## UAT 矩陣

| 情境 | PM 操作 | 預期結果 | 證據分類 |
| --- | --- | --- | --- |
| 正常回返 | 辦公室 → 打卡鐘 → 核准登入 | 回到同一站點 Pixel Office | PM LIVE |
| 未登入 | 開啟帶 `officeReturn=1` 的登入 URL | 顯示登入，不建立回返成功 | CI + PM LIVE |
| ACL 拒絕 | 使用未批准帳號 | 401/403 或拒絕畫面，無 Workspace 內容 | CI + PM LIVE |
| Session 過期 | 登入後等待／清除 Session，再刷新 | 回登入或明確 Session 過期錯誤 | CI + PM LIVE |
| 網路／API 失敗 | 阻斷 API 後刷新、重試 | 顯示錯誤與重試，無假資料 | CI Fixture |
| Workspace 切換 | 在合法 Workspace 間切換 | 只讀取目前 Workspace，返回路徑不變 | PM LIVE |
| 安全返回 | 點 TaskFlow／WorkLog 的 Pixel Office | 回到站點根頁，不接受任意外部 URL | CI + PM LIVE |
| 登出 | WorkLog 設定登出，再按返回 | Session 清除；需重新登入才能進受保護資料 | PM LIVE |
| 空資料 | 合法但無案件的 Workspace | Empty state 說明原因，不宣稱 Agent 閒置 | CI Fixture + PM LIVE |

## 裝置與瀏覽器

- Desktop：1440×900，檢查入口、錯誤恢復、Workspace 切換與返回導覽。
- iPhone Safari 直式：390×844；橫式：844×390，檢查觸控目標、無水平溢出、登入回返與登出後導覽。
- CI 的 Chromium／隔離 Session 只證明 Source 行為；不能取代 PM 的 Safari、OAuth、Cookie、App Access 或正式 Workspace UAT。

## 一次性部署與回復清單（由授權人員執行）

部署前：

- 記錄候選 exact SHA、Build、Preview URL、目前 Production SHA 與資料／ACL 變更為「無」。
- 以 PM 批准帳號先完成上述正常、拒絕、過期與登出四條 Smoke；保留畫面、時間、Workspace slug 與瀏覽器版本。
- 確認 OAuth callback、Site URL、Cookie domain、Workspace ACL 與既有金鑰未被本候選修改。

部署後：

- 只做一次性 Preview／正式候選驗收；不啟動 Provider、不修改 DB／Storage、不變更 Secrets。
- 依序驗證辦公室、打卡鐘、TaskFlow、WorkLog、Investment、Apps 及返回路徑，再驗證 401/403 與 Session 過期。

回復：

- 以部署平台既有 immutable SHA 回復至部署前 SHA；不以瀏覽器快取或手動資料修補代替回復。
- 回復後重新執行正常登入、ACL 拒絕、Session 過期與登出 Smoke。
- 若只發生單一模組錯誤，先停止 PM 驗收並保留錯誤證據；不得繞過 ACL、改寫 callback 或把錯誤導向外部 URL。

## 尚待 PM／授權人員完成

`LIVE_READBACK_BLOCKED` 直到 PM 提供受控 Preview／候選 URL、批准的測試帳號、Workspace 與 App Access 預期，以及可保存的 Safari 操作證據。CO-03 不請求或保存密碼、OAuth token、Secrets，也不直接執行部署、Production DB／ACL 變更或 Provider 派工。

CO-01／CO-02 的 Backend、SQL、Agent Reporting 與 Provider ACK 不在本工作卡內；本包只驗證站點入口、共用導覽、既有 Auth 邊界與可觀測的錯誤行為。
