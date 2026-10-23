# Zhuge AI OS｜全站收編與既有成果接線總帳

**資料核對截止：** 2026-10-23 12:50（Asia/Taipei）；文件最後整理：2026-10-23 12:50（Asia/Taipei）。
**本檔用途：** 唯一人工維護的全站模組／收編總帳；路由權威仍是既有 Shared Navigation、TaskFlow 原生 Router 與 Labs registry。這是版本化快照，不是即時監控。

## 1. Source、部署與驗收基準

| 層級 | Version / SHA | 證據 | 判定 |
| --- | --- | --- | --- |
| 正式 main | `.9.120` / `12f7676f344bf6dd9d6f4486ef07db097f3642cd` | GitHub main；Pages Workflow #39612304098（head SHA 同為 main，Deploy job success） | `ALREADY_IN_MAIN`、`DEPLOYED_SHA_VERIFIED` |
| PR #126 整合線（本輪開始） | `.9.156` / `d4110c0691e04b35df322f02dd54e034448df146` | [PR #126](https://github.com/QQweasdzxc/zhuge-ai-os/pull/126)，Draft/open | `INTEGRATED_IN_REVIEW`，未部署 |
| `.9.159` 完成驗證的候選 | `.9.159` / Build `20261023-1242` / `981828972903f91615870f9f2360ac0baa033b24` | [Browser #39901807465](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/39901807465)、[Build Parity #39901804303](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/39901804303)、[Pixel／FullSource #39901804349](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/39901804349) | 同 SHA 三條 Workflow `PASS`；未部署 |
| `.9.160` 全站狀態快照候選 | `.9.160` / Build `20261023-1250` | 文件與正式版本投影更新；Exact SHA 以 PR #126 最新 head 讀回 | Review-only；必須以 `.9.160` 自身 Exact-SHA CI 驗證 |

**GitHub Pages：** [正式首頁](https://qqweasdzxc.github.io/zhuge-ai-os/)；Workflow [#39612304098](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/39612304098) 的 head SHA 為 `12f7676f344bf6dd9d6f4486ef07db097f3642cd`，`Publish curated site to GitHub Pages` job success。這證明部署流程完成，不等於 PM 已登入或驗收。

**Render（控制平面唯讀讀回，Auto Deploy 均 OFF）：**

| 服務 | URL | Deploy ID | 實際 Commit | 狀態 |
| --- | --- | --- | --- | --- |
| TaskFlow Static Shell | [zhuge-taskflow.onrender.com](https://zhuge-taskflow.onrender.com) | `dep-dbbm7gdg1s2s739ep2ug` | `c0ea0e3e1f65acfe2d2f3f02e0e48f3fdee919e8`（.9.101） | Render 回報 LIVE；落後 main |
| TaskFlow Web | [zhuge-taskflow-web.onrender.com](https://zhuge-taskflow-web.onrender.com) | `dep-dbccblom7kps73a78it0` | `12f7676f344bf6dd9d6f4486ef07db097f3642cd`（.9.120） | Render 回報 LIVE |
| TaskFlow API | [zhuge-taskflow-api.onrender.com](https://zhuge-taskflow-api.onrender.com) | `dep-dbcd67rl550s738ci200` | `12f7676f344bf6dd9d6f4486ef07db097f3642cd`（.9.120） | Render 回報 LIVE |

Render 的 `LIVE` 是控制平面部署狀態；本執行環境無法完成公開網站 HTTP／登入探測，故所有使用者 Session、Workspace ACL、業務資料及 PM 裝置驗收均為 `NOT_RUNTIME_VERIFIED`。Production 目前沒有 .9.159 或 .9.160。

## 2. 全站 Site Map／Readiness

正式 URL 以 GitHub Pages 根站及 Render TaskFlow Web/API 為部署來源；Review Source 上的路由不可當成公開可用入口。

| 模組／入口 | 現有原生路徑與 Source | 層級狀態 | 真正缺口／下一步 |
| --- | --- | --- | --- |
| Pixel Office／首頁 | `/`、`docs/index.html`；`integrations/habblaud/build.mjs`、`assets/zhuge-office-furnishings.js` | main .9.120 已部署 Pages；#126 收編既有場景／入口修正；.9.159 Pixel Review PASS；Smoke 斷言對齊目前阻擋文案與 PR #126 | 真實 PM 登入／iPhone Safari 驗收仍待辦；.9.159／.9.160 均未部署 |
| 打卡鐘／登入回返 | `modules/worklog/?app=1&workspace=dashboard&officeReturn=1`；TaskFlow 入口使用 `taskflowReturn=1`；`labs/taskflow/pages-client/login-return.mjs` | Source 已在主線與 Review；#126 瀏覽器 Fixture PASS | OAuth、真實 Session、到期／登出／App Access 仍 `NOT_RUNTIME_VERIFIED` |
| TaskFlow 原生 Workspace | `labs/taskflow/` SSO shell → Render Web；Render API 為原生資料來源 | main .9.120 已部署 Web/API；原生 Projects、Issues、Settings、Usage 等頁面仍沿用 Vendor | 正式登入／Workspace ACL／原生操作未由本輪實測；Frozen Vendor 不修改 |
| TaskFlow Apps／Workspace 導覽 | TaskFlow 原生側欄與 `labs/taskflow/` Overlay | 延用 TaskFlow 自有 Apps 入口；不複製一份 Apps Registry | Source／Overlay CI PASS；正式 App Access 與返回 Session 未驗證 |
| AI Dispatch Workbench | Review Pages Client `/labs/taskflow/#/tf/dispatch`；`labs/taskflow/pages-client/app.mjs`、`dispatch-workbench.mjs` | 基礎 P1 功能在 main；#126 延續既有 UI／API 讀取契約；.9.156 Exact-SHA CI PASS | Review 增量未部署；Provider Route／真 ACK、Run、STOP 尚未有官方證據，必須 fail-closed |
| AI 派工中心／原生 Projects | `#/tf/ai-projects`；`native-project-mapping-contract.mjs` | #126 有五入口與原生 Project route 的 fail-closed Source | `BLOCKED_MISSING_NATIVE_INTERFACE`：`/api/projects` 沒有可信 Executor Registry／Project UUID／Workspace／ACL mapping；五位皆 GAP，沒有建立或指派 Project |
| AI 任務中心 | `#/tf/ai-tasks`；`app.mjs` | #126 已移除自製六欄 Kanban，空狀態明確封鎖；負向／去重合約有 CI | `BLOCKED_MISSING_NATIVE_INTERFACE`：追蹤的 TaskFlow Web Source 有 Projects、Issues、My Issues，沒有原生 Tasks 頁面或 AI scope filter。不得顯示一般人類 Issue 或自製替代看板 |
| Agent Reporting／PM Inbox | `agent-reporting-contract.mjs`、`agent-detail-store-contract.mjs`、`native-persistence-adapter-contract.mjs` | PR #121 選擇性 Source 與測試已收編 #126；#126 .9.156 Build Parity PASS | `SOURCE_ONLY_UNINTEGRATED` 至正式寫入層：Native Atomic Write、持久 Protected Detail Store／KMS、可信 Provider Event 尚未接通 |
| Issue #42 建卡安裝 | SECURITY DEFINER SQL（#125）與 SHA-locked one-shot runner Source（#120/#126） | #126 PostgreSQL 16 隔離 Runner PASS；沒有 Production 安裝 | 正式函式／Ledger尚未安裝；#124 是獨立 Draft workflow，仍指向舊候選，未收編且不可執行。正式 INSTALL／Canary 維持 HOLD |
| WorkLog／Dashboard／Knowledge／Management／Settings | `modules/worklog/`；同頁 `workspace=dashboard/worklog/library/management/settings` | Source 已在 main；Pages main .9.120 已部署；P0 權限修復依 CTO 私有證據已關閉特定項目 | 登入、App Access、Google OAuth／Drive、外部呼叫端影響及完整使用流程未驗證；其他權限風險仍是獨立 Gate |
| WorkLog Calendar／Google | `modules/worklog/worklog-app.js`、`shared/google/google-drive-service.js` | Calendar／Google Drive 選取匯入 Source 已存在於 main；Review 繼承現有入口 | 本輪沒有真實 Google Session／Drive 存取測試；未授權資料不會被此盤點讀取 |
| WorkTodo | `app/Board/worktodo/`、WorkLog shared adapter | 已在 main；Pages .9.120 發布 | Runtime／資料權限未驗證；與 TaskFlow AI Tasks 是不同資料域，不以其冒充 AI Tasks |
| AI Board | `app/Board/ai/` | 已在 main；Pages .9.120 發布 | 保留為既有入口；是否與未來 AI Tasks 重疊須另行決策，不在本輪退役 |
| GAS／庶務行政 | `app/Board/procurement/`；導覽權限依既有 Shell | 已在 main；Pages .9.120 發布 | 一般帳號顯示／管理角色 ACL 未做真實登入驗收 |
| AI Board 子頁 | `app/Board/ai/?view=board`、`?view=principles`、`?view=system-map` | 共用導覽現有子路由，沿用 Board Shell | Source 已在 main；公開 Pages 已發布；管理身份與資料操作未驗證 |
| 控制台／管理／設定 | `modules/worklog/?app=1&workspace=sync/management/settings` | 由 Shared Navigation 指向現有 WorkLog Workspace | Source 已在 main；Management 受既有角色／ACL 控制，真實權限未驗證 |
| Investment | `modules/investment/`、`app/Board/investment/` | Source 已在 main；Pages .9.120 發布；共用導覽將全域 Investment 項目停放，既有工作入口仍保留 | 真實投資資料、登入與 ACL 未驗證；不得移轉資料或猜測可用性 |
| Investment Lab | `labs/investment/`、`labs/registry.json`（ACTIVE） | main Source／registry 存在 | Lab 狀態不等於正式模組 Ready；Provider／資料來源與真實使用未驗證 |
| SkyEye | `modules/skyeye/`、`supabase/functions/zhuge-skyeye-read` | Source 與共用導覽已在 main | Edge Function／Auth／來源資料 Runtime 未驗證 |
| Labs／Multica Agent Lab | `labs/`、`modules/labs/` alias、`labs/registry.json` | Lab route 已存在；Multica Agent Lab registry 狀態 STAGING | 不是正式 TaskFlow Production；不可把 Lab Render 服務當正式入口 |
| TR／AI 指揮艙 | Pixel Office 會議室家具只有待補連結 | `DEFER` | 沒有已核實的獨立 TR Route／URL；不編造網址或功能 |
| HR／Travel | Shared Navigation 對應項目為 disabled／construction | `DISABLED` | 只有施工中導覽佔位，沒有可驗收的正式功能 Route |
| TaskFlow attachment preview | Vendor 原生 `/[workspaceSlug]/attachments/[id]/preview` 與受控 Overlay | 原生 route／overlay Source 在 main；#126 Build Parity 通過 | 真實登入、附件 ACL 與檔案讀取未做 Production Smoke |
| 經典報表 | `status-classic.html` | 已在 main；Pages .9.120 部署 | 保留；不以其視覺狀態代表即時工程狀態 |
| OPS-001 LIVE／DAILY | `docs/status/project-status.json` → Habblaud HUD | 本次更新為人工核對的靜態快照 | 沒有已接通的即時 TaskFlow／GitHub／Deployment read model；不能宣稱 LIVE 或 DAILY 已連線 |
| SIPX／QS Phase 1 | 獨立治理工作線 | `DEFER` | 不屬於 PR #126 的可驗收範圍；需獨立授權與來源證據 |

### Status 解讀

- `ALREADY_IN_MAIN`：Source 可在 main 找到；不代表已部署、已登入或已被 PM 接受。
- `INTEGRATED_IN_REVIEW`：僅表示相容差額在 PR #126；PR 仍 Draft，不代表 main。
- `SOURCE_CI_PASS`：該精確 SHA 的自動化測試通過；不代表 Live。
- `DEPLOYED_SHA_VERIFIED`：Pages／Render 控制平面讀回該 commit。
- `AUTH_RUNTIME_VERIFIED` 與 `PM_ACCEPTED`：本輪對 .9.120/.9.156/.9.157/.9.158/.9.159/.9.160 均未取得新的登入或 PM 驗收證據；早期 .9.101 的 P1 記錄不能自動移植到新 SHA。
- `BLOCKED_MISSING_NATIVE_INTERFACE`：安全完成所需的原生服務端 API／持久化能力不存在或沒有可信讀回，故不製作假代替。
- `RETIRED_LATER`：本輪無入口被刪除或退役；舊 AI Board／WorkTodo/GAS 先 KEEP。

## 3. PR 收編／重複差額總帳

每個 PR 的狀態是 **Source lineage／選擇性 Delta**，不是「已合併 main」。

| PR | 遠端 Head／目前狀態 | PR #126 收編情形 | 精確 CI／剩餘差額 |
| --- | --- | --- | --- |
| #120 | `a4a6a15d836ddd790d65d1a36eacc433e9dcb460`，.9.148，Draft | 是 #126 的祖先；Native Dispatch／Issue42 初始候選承接後續修訂 | 自身 Browser #39744574194、Build Parity #39744568046、Pixel #39744567979 PASS；只證明原 SHA |
| #125 | `1b7d9c7a1ba8a2189195ae2977b3024e2399acae`，.9.149，Draft | 是 #126 祖先；保留核准的 SECURITY DEFINER SQL，無 Production install | 自身 Browser #39755713877 PASS；#126 PostgreSQL Runner 在 .9.156 Exact SHA PASS |
| #121 | `b7acbfb04d39dcad04476d10e03eba727b0c379b`，.9.145，Draft | 非祖先；已選擇性帶入 Reporting contract／Detail Store boundary／必要測試；共享版本投影未整包覆蓋 | 自身 Build #39794844277、Browser #39794843550 PASS；未證明正式 Atomic Write 或 Detail Store |
| #122 | `83065504332f6050bec282ab4874baccf71c9ac6`，.9.145，Draft | 非祖先；只吸收 mapping／reuse contract、Task Center fail-closed UI 與測試；不搬入整支分支 | 自身 Browser #39795099751 PASS；未找到該 SHA 的 Build Parity PASS |
| #124 | `144b1ffb7bcbebfc95adb535d94e572f6aa4939e`，Draft | 未收編；只有手動 Production Migration workflow。Candidate SQL/runner 與 operational workflow 不同一 lineage | 自身 Browser #39775920237 PASS；該 workflow 仍 pin .9.148，且沒有 Production 執行證據，禁止觸發 |
| #126 | `.9.160`（目前候選；Draft） | 唯一整合入口；保留原整合成果，補齊全站狀態快照與 Release Identity | `.9.159` SHA `981828972903f91615870f9f2360ac0baa033b24` 的 Browser／Build Parity／Pixel 三條 Actions 均 PASS；`.9.160` 需驗證自己的 Exact SHA |

PR #121/#122 與 #126 的共同 version projection、App Shell、Workflow、導覽檔存在大量同路徑變更；只能保留 #126 的版本／整合結果。#124 的 Production workflow 不等於候選 SQL已安裝。所有六個 PR 均不得從 Draft 狀態推論部署或 PM 驗收。

## 4. 既有接線結果與未接線界線

**本輪核對後可沿用的連接：**

1. Habblaud 家具入口由既有路徑指向 TaskFlow、WorkLog、Investment、Labs；打卡鐘進 WorkLog 並保留 `officeReturn=1`。TaskFlow SSO 使用現有 Zhuge 身分，不建立第二個 Auth。
2. Shared Navigation 由 `shared/components/zhuge-navigation.js` 提供 route inventory；Labs 內容由既有 `labs/registry.json` 管理；`modules/labs/` 是回到 `/labs/` 的相容 alias。
3. TaskFlow native Projects／Issues／Issue detail／Usage／Settings 保持 Vendor 原生來源；PR #126 的五位入口只有取得唯一、同 Workspace、由服務端 ACL 產生的 mapping 才能開啟原生 Project URL。
4. Candidate AI Issue 投影以 canonical Dispatch Runtime 與原生 Issue ID 為條件；一般人類 Issue、可修改 metadata、PR 註解與模擬狀態不會升格為 AI Run。
5. Candidate 的 AI Tasks 在原生 AI filter 缺失時顯示 GAP；沒有另外留下自製六欄 Kanban。

**真正缺少的接口（不要以「接線」名義造替代品）：**

- Server-owned、具 Workspace membership／Project ACL 證明的 Executor Registry → Native Project mapping API。
- TaskFlow 原生 AI-managed Tasks filter／view，保持人類 Tasks 不混入。
- Native DB transaction 接到 Agent report／CTO completion，含唯一 Issue／Workspace、事件冪等、Lease/Fencing、Audit。
- 有 ACL、持久化與金鑰管理的 Protected Detail Store。
- 官方 Codex／Provider Conversation Route、真實 ACK／Run／STOP 證據與回寫權限。
- PM 真實 OAuth／Workspace Runtime UAT。

此清單是接口 GAP，不是新功能 GO；任何 DB、Provider、ACL、Secrets、Live write 都須另過 Gate。

## 5. CI／備份證據分層

`.9.159` Exact SHA `981828972903f91615870f9f2360ac0baa033b24` 的三條 Actions 均已完成：Browser #39901807465 PASS；TaskFlow Build Parity #39901804303 PASS（Go、Backend/Web Image、Overlay、PostgreSQL 16 Native Authority、Issue #42 Runner）；Pixel Office Review／FullSource Governance #39901804349 PASS。

Pixel workflow 為 `.9.159` 產出的 FullSource 加密封存：Artifact #12479102124，45,190,123 bytes，ciphertext digest `sha256:c2561c209b1d38b304c084c904746f048eb1ac855fccee0bc3855e62377799e1`，預計於 `2026-10-24 12:46:33（Asia/Taipei）` 到期。封存內 FullSource ZIP 為 `20261023-1242_Zhuge_AI_OS-v0.9.0-alpha.9.159-Pixel-Office-P2-FullSource-Candidate.zip`，ZIP SHA256 `cbd0c9236d2766cf43f9a79e9bb5bc97a25f0da71937a102baeea2f6d18e231a`；Manifest、SHA sidecar、Source-to-ZIP、ZIP Integrity 均由該 Job 驗證 PASS。這是限期加密 CI Artifact，不是 owner-only 長期備份；未找到已核准且可讀回驗證的永久儲存位置。

`.9.159` 同 SHA 完整 PASS 後，本候選 `.9.160` 僅更新狀態紀錄及 Build/Version 投影；它必須使用自己的 Exact-SHA Actions 結果。`.9.157` 與 `.9.158` 的 Pixel 失敗分別來自已修正的過時阻擋文字與 PR #60 連結斷言。無正式 PM 登入帳號／實機操作證據時，一律 `NOT_RUNTIME_VERIFIED`。

## 6. Scope、完成度與下一步

不提供缺乏分母的全站百分比。此快照按驗收層分開：

| Scope | Source | CI | Production | Runtime／PM |
| --- | --- | --- | --- | --- |
| P1 main baseline .9.120 | 已在 main | main 與部署工作流有成功證據 | Pages／Render Web/API SHA 已讀回 | 當前 Auth／iPhone UAT 未在本輪驗證；舊 .9.101 接受不自動延伸 |
| PR #126 .9.156 | 前一整合候選 | Exact-SHA PASS | 未部署 | 未作 PM Runtime UAT |
| PR #126 .9.157 | 前一狀態文件候選 | Browser PASS；Pixel 舊阻擋文案斷言 FAIL | 未部署 | 未驗證 |
| PR #126 .9.158 | 前一 Pixel smoke 修正候選 | Pixel 舊 PR #60 連結斷言 FAIL | 未部署 | 未驗證 |
| PR #126 .9.159 | Smoke／狀態契約修正版 | Browser、Build Parity、Pixel／FullSource 三 Workflow Exact-SHA PASS | 未部署 | 未驗證 |
| PR #126 .9.160 | 全站狀態快照更新 | 文件／版本投影候選；Exact-SHA CI 待執行 | 未部署 | 未驗證 |
| Issue42 Production install | SQL／隔離 runner source | PostgreSQL CI PASS | 未安裝 | Canary 未建立 |
| Native AI Project／Task／Reporting／Provider | 部分契約已存在 | 部分隔離合約 PASS | 尚未啟用 | mapping／native write／provider 證據未具備 |

**下一個單一動作：** 對 PR #126 `.9.160` 新 head 執行 Exact-SHA Browser、TaskFlow Build Parity（含 PostgreSQL／Issue42 runner）、Pixel Office／FullSource Governance；通過後停在 Draft CTO／PM Review。其後是否開放 Runtime、Production Migration 或發布，仍是獨立 Gate。
