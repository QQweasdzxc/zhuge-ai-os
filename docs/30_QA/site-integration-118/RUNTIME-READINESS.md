# 全站 Runtime／PM UAT Readiness

**資料核對截止：** 2026-10-23 12:42（Asia/Taipei）
**文件最後整理：** 2026-10-23 12:42（Asia/Taipei）
**狀態來源：** [全站收編總帳](./REVIEW.md)
**Main／Production baseline：** `.9.120 / 12f7676f344bf6dd9d6f4486ef07db097f3642cd`
**唯一整合 Review：** PR #126；本輪 .9.159 僅為 Review Source。
**部署限制：** 本輪不建立 Preview／Staging，不 Merge、不 Deploy、不執行正式 SQL／Canary。

## Runtime 分層

| 檢查 | 狀態 | 證據／界線 |
| --- | --- | --- |
| GitHub Pages 部署 | `DEPLOYED_SHA_VERIFIED` | main SHA `12f7676f344bf6dd9d6f4486ef07db097f3642cd`；Pages Workflow #39612304098 的部署 Job success |
| Render TaskFlow Web/API | `DEPLOYED_SHA_VERIFIED` | Web Deploy `dep-dbccblom7kps73a78it0`、API Deploy `dep-dbcd67rl550s738ci200`，均 main SHA `12f7676f344bf6dd9d6f4486ef07db097f3642cd` |
| Render Static Shell | `DEPLOYED_SHA_VERIFIED / VERSION_DIVERGED` | `dep-dbbm7gdg1s2s739ep2ug` 為 `c0ea0e3e1f65acfe2d2f3f02e0e48f3fdee919e8`（.9.101），不是目前 main |
| PR #126 Review Source | `SOURCE_ONLY` | .9.159 新候選；尚未部署。必須依最新 PR HEAD 回讀 Exact SHA |
| 正式登入／Workspace ACL | `AUTH_RUNTIME_NOT_VERIFIED` | Render 控制面 LIVE 不代表 OAuth、Session、Workspace membership 或 API 權限已實際通過 |
| PM Desktop／iPhone Safari | `PM_ACCEPTANCE_PENDING` | 本輪沒有真實帳號或 iPhone 操作證據；Chromium Browser CI 不能代替 Safari |
| AI Provider | `BLOCKED / UNVERIFIED` | 無官方 Conversation Route／ACK／Run／STOP 的真實證據；不得派送或顯示 RUNNING |

本執行環境對外 HTTP 探測被出口代理拒絕，故沒有以它推論網站故障或正常。正式網站 HTTP、登入、Workspace 資料讀取及模組使用情況在本輪均不標 PASS。

## UAT 範圍（部署授權後由 PM 操作）

目前沒有安全可供 PM 操作的 Review URL。不得將 GitHub Actions artifact、Pages/Render Production 舊版本或本機 Fixture 稱為 Review Preview。

正式版本獲准更新後，PM 可在既有正式站依序驗證：

1. Desktop：1440×900；TaskFlow／WorkLog／Investment／Labs 入口與返回 Pixel Office。
2. iPhone Safari 直式與橫式：登入／Session、側欄、返回路徑、捲動、觸控目標及無橫向溢出。
3. TaskFlow：Workspace／Project／Issue／Detail／Status／Usage／Settings，僅查看獲權限的工作區。
4. 401／403、Session 到期、登出、錯誤網路與錯誤 Workspace 的 fail-closed 行為。
5. AI 派工中心：映射缺失時顯示 GAP；AI Tasks 不展示一般人類 Issue；Provider 未驗證時不顯示 ACK／Run／RUNNING。

## 安全／回復邊界

- 此文件只記錄已部署 SHA 與 UAT 步驟，不授予正式登入、資料庫、Provider、ACL、Secrets 或發布權限。
- WorkLog 特定 P0 權限補救已有 CTO 私有驗證；合法使用流程、外部用戶端影響與其他 privileged-function 盤點仍是獨立 Gate。此公開文件不揭露私有物件名稱或資料。
- 不執行 SQL／Canary。應用程式回復只能依正式部署平台既有 immutable SHA 操作；本輪未觸發也未驗證任何部署回復。
- Production .9.120 與 Render Static Shell .9.101 的差異需在未來發布規劃中分開處理；本輪不做部署。
