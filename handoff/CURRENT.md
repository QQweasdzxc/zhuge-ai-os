# Zhuge AI OS｜Daily Engineering Handoff｜固定入口

> **PM 正式批准：Handoff v1；Repo = `QQweasdzxc/zhuge-ai-os`；交接專用 Branch = `ops/handoff`。**
> 本分支是協作日誌，不是正式產品 Source／Release 分支。**禁止將交接記錄的 Commit 誤認為正式產品部署、TF 任務或 Codex 接單。**
> 讀取時間基準：`Asia/Taipei`，日期格式 `YYYYMMDD-Handoff.md`。

## 目前的每日交接入口

**今日（2026-10-20）：** [20261020-Handoff.md](./20261020-Handoff.md)

新的一天由**當天第一個實際工程／督導工作階段**建立新的日期檔案，再將此 `CURRENT.md` 指向新檔；**尚未設置定時自動建立、背景推送或 AI 自動啟動**。不預先宣稱明日檔案已存在。

## 2026-10-20 PM 最新授權（取代下列歷史截圖與逐版 PM GO）

**正式交接：[20261020-Handoff.md](./20261020-Handoff.md)**；原則候選：[PR #100](https://github.com/QQweasdzxc/zhuge-ai-os/pull/100)；權威 PM 決策：[Issue #51](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51#issuecomment-6285091395)。

- **CTO-01（GPT）是唯一派工、改派、工程進度回收、技術審查、整合總管**。本輪四位獨立工程師：**CO-01（Codex-01）、CO-02（Codex-02）、CO-03（Codex-03）、GEM-01（Gem）**，全部平行無上下級；GH-HELPER-* 為另外可調用的資源。CO-03 ≠ GEM-01，其實際 Provider 身分／接線仍需核實，不能把貼指令當 ACK。
- CTO 可以自主安排 CO-01 或具操作權的 CTO 在唯一 Production 發布，**不需每版重新向 PM 申請 exact-SHA GO**；仍須 exact-SHA CI、新 Version／Build、FullSource、安全與回復檢查。
- 新增付費、重大權限／Secrets／DB ACL、不可逆資料操作，仍須 PM 事前批准；PM 只在正式上線後進行功能審測。
- **唯一 P0：AI 派工管理核心**（TaskFlow DM-00～DM-03 + DM-04）；其他主線 HOLD。不另設 staging／測試網站。
- 下方 10/18～10/19 歷史快照保留以供追溯；它們的舊 Gate／角色描述／版本**不得取代今日授權與最新遠端證據**。

## 最高層真相與優先順序

1. **PM 決策與已授權事項：** [GitHub Issue #51](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51) 的最新有證據記錄／PM 明確指令；Handoff 不創造新授權。
2. **產品原始碼與 Review：** `main`、[PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60)、遠端精確 Commit SHA、版本、GitHub Actions；不可從交接日誌反推已部署。
3. **正式環境：** 真正 Render Web/API／正式資料庫的即時唯讀驗證；候選 CI PASS 不等於正式站 PASS。
4. **日常協調摘要：** 本檔及每日 Handoff，只做上述資料的單一可讀入口與未竟工作接續；遇衝突標 **CONFLICT / NEEDS_RECHECK**，先讀真正權威。

**正式版本規範：** 產品 Source 修改仍遵守 `docs/10_GOVERNANCE/RELEASE.md` 的新 Version／Build、QA、FullSource。此 `ops/handoff` 分支僅保存不含機密的日誌，**不合併進 `main`、不進正式 Release Source、不直接觸發 Render／資料庫變更**。若未來改規則，需 PM 另行審查。每日 Handoff Git commit SHA **不是** 產品 Source SHA。

## 協作規則（2026-10-20 生效；舊三方職稱表僅歷史）

**當前正確執行者：** CTO 主管理；PM 最新指定 **CO-01、CO-02、CO-03、GEM-01 四名平行接案工程師**，GH-HELPER-* 為額外獨立資源。CO-03 已有人員代碼但 Provider Registry 與實際 ACK 未確認，絕不能假定 CO-03 = GEM-01。即時 Runtime 證據優先於 Handoff 快照。

### 歷史三方表（2026-10-18～19，現已被取代）

| 角色 | 工作 | 不能做 |
| --- | --- | --- |
| **PM** | 優先順序、授權、正式驗收；可宣告新的決策 | 不須逐項處理日常技術留言 |
| **GPT-CTO** | 每日文件**唯一寫入整合者**：讀回來源、去重、對齊 Co/Gem、更新 CURRENT、遠端 SHA 驗證；必要時由 PM 指定代理維護人 | 不因日誌自動授權部署、派工、權限或費用 |
| **Co（首席）** | 在既有 PR／Issue／已核准工程管道回報：ACK、檢查、Commit/CI 證據、阻塞、下一步；由 GPT 摘錄 | 不覆寫同一份 Handoff、不把本地 Commit 冒稱遠端 |
| **Gem（副手）** | 回報前端／BFF／Downloads／安全檢查與相依欄位；由 GPT 摘錄 | 不覆寫同一份 Handoff、不與 Co 同改共用正式程式 |

### 日常交接程序

1. 各自開始工作，先打開**固定 CURRENT → 今日檔案**，再讀最新 Issue #51 授權、GitHub main／PR #97／PR #98 和精確遠端 SHA；每日檔過期時以實際來源為準。
2. Co／Gem 在有**實際重要完成、阻塞、決策或交棒**時，向既有 PR／Issue 交付簡短 `[HANDOFF][Co/Gem][YYYYMMDD]` 回報，或由 PM 在對話提供原始資訊；回報包括「做了什麼、證據 URL、產品 Version/Build/SHA、是否已部署、阻塞、下一棒、所需 PM 決策」。
3. GPT 驗證資料源，在**今日同一份檔案**按角色更新現況，保留證據連結；更新 `ops/handoff` 必須 Commit／Push／GitHub 遠端 SHA 與檔案讀回。多方同時寫時採單一整合者，使用 fast-forward／expected-ref，禁止 force-push 覆蓋。
4. **ACK 不是 GitHub 留言寫入成功**：需要對應工程師實際回應或其他可驗證工作憑證。Handoff 更新本身**不觸發 Provider**、不算 Co/Gem 已接單、也不允許重複下發工作。
5. 當日紀錄可追加經核對的修正，清楚標注新舊時間；隔日用新檔承接所有未結案工作，過去日期不任意重寫（必要時補註更正與來源）。
6. 有爭議的進度須標 `VERIFIED`、`PENDING`、`BLOCKED`、`UNKNOWN` 或 `NOT_DEPLOYED`，不得把 Mock、候選 QA、私有檔尚未驗證或人工留言誤報正式完成。

### 安全與權限

- Repository 目前為 **public**。每日文件只能寫**可公開的工程事實、通用狀態與必要公開 GitHub 證據連結**；禁止 Secret、Token、.env、私有 TF 任務原文、個資、內部帳戶識別及私人備份內容。
- 私有 FullSource 備份保持 **owner-only Google Drive**／PM 登入核准入口；不可把 ZIP、Manifest 原文或私有下載 Token 放 `ops/handoff`、公開 GitHub Release 或 TaskFlow `public/downloads`。
- TaskFlow 內部導覽維持原 Render 站內；外部連結明確標示。
- 僅 PM 授權的 Gate／Runtime 操作可進正式環境。當 `PRODUCTION_HOLD` 時，Handoff 的 `GO` 或待辦文字**不會改變**資料庫／Render／GitHub App 的實際權限。

## 索引與公用狀態（2026-10-18 建立時）

| 項目 | 核對狀態 | 證據 |
| --- | --- | --- |
| Gate 1 | Co 已 ACK／清單已交；備份還原及 TF App 權限缺完整證據 | [Co ACK](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60#issuecomment-6233971865) |
| Gate 2 | **PM 已條件式授權；因 Gate 1 未全 PASS，Production HOLD** | [CTO Gate 判定](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60#issuecomment-6242331572) |
| Review Source | `0.9.0-alpha.9.73 / 20261017-1603 / 510b8f379181d90cc21d27d5a92913beff4d8ef7`，PR #60 Draft | [PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) |
| main Source | `e053cba43327083649641bd29cfb363ab1e42e80`，未合入 .9.73 | [main](https://github.com/QQweasdzxc/zhuge-ai-os/tree/main) |
| GOV-01 | .9.73 Candidate GitHub Exact-SHA QA PASS，**不是部署** | [Official Release Gate](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/39020087233) |
| GOV-02 | .9.73 FullSource 私人 Drive 已保存且讀回校驗 PASS；**不是 DB 備份** | [備份驗證決議](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51#issuecomment-6231860344) |

## 最新實際確認補註（2026-10-19，請以遠端來源為準）

- **正式 Pixel Office:** `main` exact SHA `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`，版本 `0.9.0-alpha.9.76`，P2 已經正式 Pages 上線；此項目與下面 2026-10-18「建立時快照」不同時點，不能混用。
- **P3 Lab:** [PR #64](https://github.com/QQweasdzxc/zhuge-ai-os/pull/64) 和 [PR #65](https://github.com/QQweasdzxc/zhuge-ai-os/pull/65) 仍是 Draft/NO DEPLOY；兩種測試路線重疊，Co 的既有開發不被獨立 QA 派工取代。
- **PM 授權的獨立唯讀派工（GitHub Issue 建立，不等於 Provider ACK）:** [#66 UX/Device QA](https://github.com/QQweasdzxc/zhuge-ai-os/issues/66)、[#67 #64/#65 Architecture Audit](https://github.com/QQweasdzxc/zhuge-ai-os/issues/67)、[#68 Status/Rewards/Security Audit](https://github.com/QQweasdzxc/zhuge-ai-os/issues/68)，均 `QUEUED / ACK_PENDING`，沒有已確認之 AI 執行者；禁止自動觸發 Co 或繞 TaskFlow Gate。
- **TaskFlow 派工正式環境：** [PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) 仍 Draft，`GATE1_BLOCKED / G2_CONDITIONALLY_AUTHORIZED / PRODUCTION_HOLD`。候選已完成 ≠ 正式 API/DB E2E 已成功。

## Multi-Agent 協作派工追蹤

**2026-10-19 實際登記：** [Agent 工作隊列（JSON）](./AGENT_TASK_QUEUE.json) ／ [協作派工規則（Markdown）](./AGENT_DISPATCH_V1.md)。[#66](https://github.com/QQweasdzxc/zhuge-ai-os/issues/66)、[#67](https://github.com/QQweasdzxc/zhuge-ai-os/issues/67)、[#68](https://github.com/QQweasdzxc/zhuge-ai-os/issues/68) 已有 **GPT-CTO 唯讀首輪審查的來源留言**；獨立 Agent 仍無受指派帳號、ACK 或 Session，維持 `QUEUED_UNASSIGNED`；不得當作三個 Agent 已接單。Co/Gem P3 開發主線和 TaskFlow Production Gate 保持獨立。

## PM 資料來源可追溯

[DATA_PROVENANCE.md](./DATA_PROVENANCE.md) 提供公開版索引規範；有敏感內容的完整資料索引只存 PM 未共用 Google Drive。

## 快速入口

- [今日 Handoff（四位工程師／最新分工）](./20261020-Handoff.md)
- [PM 決策與持續交接：Issue #51](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51)
- [Co 源碼工程主線：PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60)
- [產品最新候選狀態文件（PR #60 分支；可能落後 GitHub 新留言）](https://github.com/QQweasdzxc/zhuge-ai-os/blob/review/taskflow-github-codex-phase2-20261016/docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)
- [產品版本治理](https://github.com/QQweasdzxc/zhuge-ai-os/blob/main/docs/10_GOVERNANCE/RELEASE.md)

**下個工作階段先核對原始來源的即時狀態，再更新每日 Handoff；禁止只用這裡的歷史快照判斷是否可上線。2026-10-20 授權優先於舊的逐版 PM GO。**
