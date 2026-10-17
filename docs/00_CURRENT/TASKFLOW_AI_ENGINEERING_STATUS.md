# Zhuge AI OS｜TaskFlow AI 工程整合｜最新交接文件

> **最優先／P0：每次開發成果必須真正保存，可從 GitHub 獨立恢復。**
>
> 本文件是目前 **TaskFlow ↔ GitHub ↔ Codex** 開發主線的最新交接摘要，保留於正式 GitHub Repository；不是另一套任務平台。任何 GPT、Codex、Gem 或工程協作者開始工作前，**先讀本文件、GitHub 當前 main、PR #60、Issue #51 的最新決策**，不可只憑舊對話或過時交接摘要直接開發。
>
> 本次文件更新是**Review 分支內的開發紀錄檢查點**，不宣稱正式版本、CI、FullSource ZIP、Production 部署或 PM 驗收已完成。後續程式交付仍須遵守既有 Version／Build／QA／封存治理。

## 0. P0 硬性規則：先保存、再繼續（最高級別，不得跳過）

**上次損失案例：** Codex Cloud 工作環境 `environment_offline`，`.9.64 / 20261017-0031` 未提交工作樹與本地 commits 在可使用的工作環境／GitHub 都無法取得。不是 GitHub 已上傳版本遺失，而是某批工作在可查遠端版控之前就中斷。**不得再讓整批工作只停留在暫存 Coding 工作樹。**

### 每個有意義的開發階段（遠端檢查點）
1. 確認現有功能、最小缺口與 **正確 GitHub main／Review 分支精確 SHA**；不得猜測、不重做既有正式功能。
2. 修改一個可清楚交接的小範圍後，執行該範圍必要檢查、`git diff --check`，建立 Commit。
3. **立即 Push 到既有 Review 分支／其他經正式授權的遠端分支，並透過 GitHub 再次讀取驗證遠端完整 SHA 與檔案確實存在。** 只有本地 commit／Codex 說「已完成」／GitHub 留言或眼睛表情，都**不是遠端保存成功**。
4. 更新本文件的現況、Issue #51 的里程碑，並註明目前已保存的遠端 SHA。完成以上動作再做下一階段。
5. **無法 Push 或確認遠端讀回時，先停下大量新修改。** 優先使用現有正式可寫途徑保存可驗證的 commit 或保護好的 patch/artifact；若依然無法取得，明確回報 BLOCKED，不得宣稱交付或重複從頭開工。
6. 不 reset／force-push／覆蓋既有重要工作；若失去暫存環境，一律從最近一個**已確認 GitHub 遠端**的 SHA 續作。

### 每次正式完整交付（ZIP + 程式 + 歷程）
- 嚴格沿用 **`docs/10_GOVERNANCE/RELEASE.md`** 與 **`tools/release-governance.js`**：新版 Version／Build、正式 QA、乾淨且已提交 Source、FullSource ZIP、Manifest、SHA256、來源 SHA 一致性驗證。失敗不得虛報 PASS。
- 每次正式交付必須**同時可取得**：
  - GitHub 原始碼 Commit（完整 SHA）／PR／版本、Build、日期；
  - 完整原始碼 **FullSource ZIP + manifest + sha256**；
  - 開發歷程、功能差異、實際測試證據、是否已部署、下一步／回復方式。
- 固定中文入口：**`版控/README.md`**（待 Co 在本輪建立，或連結已存在的唯一等效索引）；它是**索引**，非第二套版本控制系統。記錄每版 SHA、ZIP/manifest/SHA256 永久連結和交接歷程；維護歷史，不覆寫。
- 完整 ZIP **不要反覆直接提交二進位檔到 Git 原始碼歷史**。優先使用同 GitHub Repo 的對應 GitHub **Release 附件**作長期封存，索引連結至 Release。不可僅倚賴可能到期的 CI Artifact。沒有 Release 上傳權限／成功讀回，明記 **BACKUP NOT SAVED**，不得以「有本地 ZIP」冒充已完成遠端備份。
- 保護金鑰、Token、.env、私密 TF 工作內容及個資；不得放入公開 GitHub/ZIP。Repo 目前為 public，未經評估與 PM 授權不可直接改 private。
- 每次完整交付的 ZIP **與其對應 Source SHA 一致**；單純中間 checkpoint 可只先保存程式與紀錄，但不可冒充完成 FullSource 交付。
- 原本的 Release Gate、QA 與正式資料庫部署批准仍有效；P0 儲存規則不是跳過授權的理由。

### 完成判定（按證據）
| 階段 | 何時才算完成 |
| --- | --- |
| 本地修改 | 只代表編寫中，**未交付** |
| 已保存在 GitHub | 遠端可讀的確切 SHA + 修改檔案 |
| QA 通過 | 與上述同一 SHA 對應的完整所需測試 |
| 完整備份完成 | 永久 ZIP、manifest、sha256 真正上傳並讀回；索引有連結 |
| Production 完成 | 原正式 TF 確認已部署的版本/SHA、必要 DB 狀態 |
| PM 驗收完成 | PM 在原 TaskFlow 實際驗證，同意結案 |

## 1. 目前既有成果（不要重做）

- **唯一正式 TF**：原 Render TaskFlow。舊 GitHub Pages 是 Zhuge AI OS 入口／啟動器，**不另建完整 TF 克隆或對外測試站**。
- **現有 UI**：PR #54 已合併且正式站可見的 TaskFlow「AI 工程執行」任務區塊（Co 優先、Gem 手動、狀態/紀錄、停用派工按鈕），**保留原區塊並就地接通**。
- **GitHub App**：TF 連線 repo／PR／webhook 基本讀取已成功；不代表可安全寫 PR comment 或能觸發 Codex Cloud。
- **實際 GitHub → Codex Cloud 成功**：PR #52 中由 PM/ChatGPT 發出 `@codex` PR 留言，官方 Bot 回覆且有真實 Cloud Thread。參考：
  - [派工留言](https://github.com/QQweasdzxc/zhuge-ai-os/pull/52#issuecomment-6188874242)
  - [官方回覆](https://github.com/QQweasdzxc/zhuge-ai-os/pull/52#issuecomment-6188911571)
- **GitHub Source 基線（建檔時）**：main `.9.59`、SHA `e053cba43327083649641bd29cfb363ab1e42e80`；Review PR #60 `.9.62`、原 SHA `997cc34e9fb993662183b801ae8ff067efe69dd1`，已在該 SHA 的 CI 測試通過。**一旦本檔上傳產生新 Review SHA，舊 CI 不代表新 SHA 已 PASS；Co 應依據實際最新 HEAD 重新治理與驗證**。
- **PR #60 的已保存程式**：PM 核准與 Run 記錄讀回、GitHub PR/webhook 證據部分已有基礎；PR #55 與 PR #52 只作參考，不整包混入。
- `.9.63`／`.9.64` 曾有本地工作摘要，但遠端未核實，**不得宣稱已交付或可還原其實際 diff**。
- **Co 最新開發授權**：[PR #60 的最新 PM 派工留言](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60#issuecomment-6225708304)；不要因交接文字再額外重複召喚 `@codex`。
- **PM 版控永久規則**：[Issue #51 正式決策](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51#issuecomment-6225700194)。

## 2. 尚缺項目與最短下一步

1. **先確認 GitHub 遠端可保存**：Co 能否將新階段 commit + push + 讀回。不能保存先停止大批 Code 變更。
2. **最小補缺**：在原 TaskFlow AI 工程執行區塊接通專案／任務／Co-Gem 的跨裝置選擇儲存，以及既有核准/Run/API。
3. **真實 TF → GitHub → Codex**：一次 PM 核准 → 受限的 GitHub 寫入 → 官方 Codex 確認、Cloud thread/任務 ID → 成果、PR、CI 回寫同一卡片。**TF GitHub App 身分能否觸發仍需驗證**；禁止假報成功、重複派工、將私人任務內容公開。
4. **建立「版控」固定索引 + 完整封存交付**：直接重用既有工具、發版規則；永久上傳 ZIP+manifest+sha256、遠端讀回並連結，歷史可查。
5. **新版精確 SHA QA + 正式整合**：完成 Go、Browser、隔離 PostgreSQL、Build/CI、版本治理與 FullSource 後，依既有正式 Release/DB 授權界線安排部署。**唯一使用者為 PM，不需要多人權限架構、第二站或測試區**；正式站最後一次驗收即可。
6. 若需要額外 GitHub App 寫入權限、費用、正式資料庫不可逆操作、機密授權，工程可完成部分先完成，**最後只彙整一次給 PM**。

## 3. 最新決議優先權與紀錄位置

- **最高級別**：本文件第 0 節「遠端保存 + ZIP 封存 + 固定歷史索引」是每次工程交付不可省略的 P0。
- **最新 PM 決策**：Issue #51 [雲端派工主線](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51)；此文僅為方便交接的單一最新狀態摘要，不替代 Issue / TF 任務權威。
- **原始程式與審查**：[Draft PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60)。
- **原始正式發布治理**：[RELEASE.md](../10_GOVERNANCE/RELEASE.md)。
- 舊 Issue #57「GitHub Pages 承載完整 TF」以及新建 AI 卡片、重設 GitHub、引入額外付費 AI API、Gem 自動切換等較早方案，均被 PM 更新的**單用戶、現有 Render TF、優先沿用既有功能**決策取代。

**本文件在每次正式保存 checkpoint、候選 Source、正式上線之後，都應與 GitHub 遠端實際 SHA 同步更新；不得只記在聊天／Codex 工作環境。**

## 4. 2026-10-17 雲端保存與 AI 設定接續紀錄（append-only）

### 遠端保存狀態
- 已確認原 `0.9.0-alpha.9.65` 本地 commit `02380c1a3226cdd55541cbdc32a1fb91a31ef0df` 及原留言提到的 patch/bundle，無法從目前工作環境或 GitHub branch/commit 讀回；不得宣稱已找回或把後續候選當成它的 byte-identical 恢復。原留言只保留了摘要，並非完整原始程式。
- 已恢復可用的既有 GitHub push 認證途徑，並將 PR #60 Review 分支的 `.9.66` commit `324466aa1585af9b1ba9fce1143b9a87b2e7699c` 與 `.9.67` commit `82690b9d1a4d11d6d050150d3c527648a8c4606a` push 後，使用遠端 ref 及 GitHub 檔案讀取確認 SHA/內容。沒有讀取或輸出任何密鑰。
- `.9.66` 是從可取得的 PR #60 `.9.62` 源碼續作之增量候選：TaskFlow 專案／Issue AI 工程設定改由已驗證使用者 TaskFlow API 持久化，預設關閉，切換 Co/Gem 不呼叫 Provider；Build `20261017-0634`。它不是遺失 `.9.65` 的原始替代品。

### `.9.66` / `.9.67` QA 與修正
- `.9.66` TaskFlow Build Parity `38976633305`：Overlay contract 與隔離 PostgreSQL migration integration PASS；Backend image 因一個測試在 Docker `REPO=/` 中讀取不存在的 repo-relative Dockerfile 路徑而 FAIL。Browser Regression `38976637087` Desktop/Mobile Chromium PASS。
- `.9.67` Build `20261017-0637` 遠端 SHA `82690b9d1a4d11d6d050150d3c527648a8c4606a`：Backend image、隔離 PostgreSQL migration integration、Overlay contract PASS；Web image 中新增設定儲存測試因 fixture 預期值錯誤而 FAIL。該測試先以 `enabled=false` 讀取 Issue 設定，再換工程師；既有程式保留 `false` 是正確行為。Chromium Desktop/Mobile Browser Regression `38976971720` PASS。
- 後續遠端測試修正 commit `fb22f0def6261b54c2acdb151fb6063ec5d0e731` 只修正該測試的 fixture 與 assertion，驗證切換到 Gem 不會意外將 `enabled` 從 `false` 改為 `true`；沒有改應用程式行為。該提交是 `.9.67` Build 身分下的測試修正檢查點，不能把先前 Web FAIL 改稱 PASS。
- `.9.68` / Build `20261017-0640` 是本次設定持久化測試修正後的 Review Candidate。Commit/push 後須以 GitHub branch readback 確認精確 SHA，並完成對應 CI 才可標記為已交付／通過。

### 功能邊界（維持 fail-closed）
- 已有候選程式包含 AI 工程師專案／任務選擇的持久設定 API 與 UI、PM 核准/Run intent 持久化與讀回、Run/event 資料遷移，以及 GitHub PR webhook receipt 基礎。Migration 僅於隔離 PostgreSQL Actions 驗證；Production 未安裝。
- PM 核准目前只建立 TaskFlow Run 記錄；不代表 Codex 已接單或開始工作。`dispatch_enabled=false`，沒有 Provider dispatcher、真實 Codex ACK、Cloud Run ID 或結果 callback；沒有發起付費 AI 呼叫。
- 已見 PR #60 程式的 GitHub App token 申請範圍仍為 metadata-read；正式 `@codex` comment/Cloud trigger 的授權、可支援入口與費用尚未核實。Gemini Cloud 執行亦未配置。Writer lease、Co 停止證明與 Gem 接手機制仍未實作，不得聲稱多工程師自動接力完成。
- `.9.67` Web Vitest 的失敗修正後，仍需精確 `.9.68` SHA 的 GitHub Build Parity 和 Browser Regression 結果；真實 Codex Cloud E2E、Production Migration/部署、真實 PM SSO/iPhone 驗收均未執行。
- PR #60 是唯一 Draft Review 入口；main 基線記錄為 `e053cba43327083649641bd29cfb363ab1e42e80`。沒有 main merge、Production deploy、DB migration 或 Secret 修改。
- FullSource ZIP、manifest、SHA256 尚未建立並上傳到 GitHub Release，狀態為 **BACKUP NOT SAVED**。只有精確 candidate source CI 完成後才依既有 `tools/release-governance.js` 打包；不得以本地 ZIP 或短期 CI artifact 代替永久封存。


## 5. 2026-10-17 Codex Cloud handoff candidate `.9.69` (append-only)

- **基線：** PR #60 `.9.68` Review Branch `review/taskflow-github-codex-phase2-20261016`，父 SHA `abf1dfb18c568438bb6056f0caef3fdfd647a5e5`。
- **候選 Build：** `0.9.0-alpha.9.69` / `20261017-0732`。候選精確 SHA 以 [PR #60 最新 Head](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) 讀回值為準；本分支保持 Draft，不更新 main。
- **同卡流程：** 沿用現有「AI 工程執行」面板。只有 TaskFlow workspace owner 可核准；原生 Issue、Project、revision、Co opt-in、冪等 Run 仍是唯一權威。勾選明確公開內容確認後，API 才會把任務標題/描述貼到同一個 TaskFlow 已關聯的公開 GitHub PR，並以唯一 Run/dispatch UUID 與核准時的 PR head SHA 綁定。GitHub App 使用短效 installation token；不呼叫 Codex 非公開 API、不讀取瀏覽器 Session。
- **接單及結果：** 只有經 GitHub webhook 簽章驗證、精確官方 bot 帳號 `chatgpt-codex-connector[bot]`、同一 repository/installation/PR/dispatch/checkpoint SHA 並匹配單一嚴格 ACK/RESULT/FAILURE marker 的回覆才可變更 Run。ACK 保存實際 Cloud thread UUID；完成結果還要由 GitHub API 重新確認目前 PR head SHA，然後將摘要、Commit SHA、狀態及事件保存至原任務卡讀回區。未知派送結果不會自動重送。
- **安全預設：** dispatch 仍為 **OFF**。需要 `ZHUGE_TASKFLOW_CODEX_DISPATCH_ENABLED=true`、`ZHUGE_TASKFLOW_CODEX_ISSUE_COMMENT_WEBHOOK_ENABLED=true`、有效 GitHub App/write 權限、`issue_comment` webhook 訂閱與簽章 Secret；目前沒有驗證後開啟任何 gate。任務標題/描述會進入公開 PR，UI 有明確確認；不得貼入機密/個資。沒有正式 Codex Cloud ACK、thread、Codex 工作號或結果的實際 E2E 證據，因此目前是候選整合，不是已證明可派工或已上線。
- **新增資料：** migration `598_zhuge_ai_codex_dispatch` 僅以 TaskFlow migration overlay 擴充派工關聯/回執欄位與 `issue_comment` delivery type，runtime 只增加欄位級 UPDATE；down migration 在存在派工或 comment evidence 時拒絕刪除。Migration 尚未套用至 Production。
- **本機 Developer QA：** Overlay/Build parity 定向 Python `23/23 PASS`；TaskFlow entry/CLI SSO Node `18/18 PASS`；`bash -n`、`git diff --check` PASS。新增 Go 測試包括短效 GitHub App token、固定 PR head、實際 API comment request、token 撤銷、head 變更拒絕及嚴格 webhook marker；Backend Docker / isolated PostgreSQL integration、Web Vitest、Docker parity、Browser Regression 必須以 PR #60 **最終 Head SHA** 的 GitHub Actions 結果為準。Actions 狀態請於 [PR #60 Checks](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) 查看。
- **本機 Docker 限制：** 當前執行環境的 Alpine `apk` 套件鏡像回應 `Permission denied`，因此本機 Docker parity 未通過；不可把此狀態寫成 PASS。由既有 GitHub Actions 執行遠端 Backend/Web image build 及隔離 PostgreSQL。
- **Source/Runtime 狀態：** 新候選只在 Review Branch；無 main 更新、Production deploy、正式 Migration、Secrets/Env 修改或真實 Codex 派工。iPhone/PM 正式 TaskFlow 驗收未執行。
- **FullSource 備份：** 正式打包須待最終 SHA 的遠端 CI 證據後執行。GitHub Release binary upload 不在目前可用 Connector 能力內，且本機 `GH_TOKEN` 驗證為無效；在 ZIP/Manifest/SHA256 可從受控永久位置讀回前，仍標 **BACKUP NOT SAVED**，不得以短期 CI Artifact 或工作區 ZIP 宣稱永久保存。
- **Release/PM Gate：** 真正 Cloud Run 的實際觸發行為、GitHub App `pull_requests:write` 與 `issue_comment` event 設定、Bot 是否接受 App authored `@codex` comment、訂閱/執行費用尚未獲得正式驗證或核准。派工 gate 維持關閉；需要的授權與費用只在最後集中交 PM 決定。


### `.9.69` exact-commit CI result and `.9.70` correction (append-only)

- `.9.69` Build `20261017-0732`, remote Review head `645be0e041d8b352c058e98ffe2bd5624359babb`，PR #60 Actions：
  - Build Parity Run [38982186025](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982186025)：Overlay Contract **PASS**；isolated PostgreSQL migration integration **PASS**（migration 598、runtime column ACL、evidence-preserving rollback guard）；Backend Image **FAIL**（unused `strconv` import）；Web Image **FAIL**（派工回報的任務代碼與提示文字間缺空格，既有 Vitest assertion 捕捉到 UI 缺陷）。`.9.69` 不作為通過候選。
  - Browser Regression Run [38982189789](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982189789)：Desktop/Mobile Chromium **PASS**；14 個 evidence file，短期 artifact [12081622469](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982189789/artifacts/12081622469)，SHA-256 `4c405b052b759206894621a328a58e522408081ea5c80415ecf0d7b3119a2271`（保留 14 天，並非永久 FullSource 備份，也不是 iPhone Safari）。
- 以 TaskFlow-owned 最小修正修好 Web 訊息間距，移除造成 Backend compile fail 的 unused import；修正 checkpoint commit `2bff165ed969a7d826a8db08429722dc801dd251`。
- **目前重新凍結的候選：** `0.9.0-alpha.9.70` / Build `20261017-0737`。候選 SHA 以 [PR #60 最新 Review Head](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) 讀回為準；Build Parity 與 Browser Regression 必須在該 SHA 完成後才能判定。此 Build 只包含 UI 空格修正、Go unused import 修正及正式版本/Build 身分同步。
- 本地 Python Overlay/Build parity 23/23 PASS、入口/CLI SSO Node 18/18 PASS、Go formatting / shell syntax / `git diff --check` PASS。Remote PostgreSQL test 僅在 `.9.69` 通過；`.9.70` 仍需以新精確 SHA 重跑遠端必要 Gate。
- Source 仍只在 Review Branch；沒有真實 Codex 派工/ACK/Run/thread/result、Production Migration 或 Deploy。兩個 runtime dispatch gates 繼續 OFF。`BACKUP NOT SAVED`；最終 SHA 的 FullSource ZIP/Manifest/SHA256 必須在遠端 CI 完成後重建，Release binary upload 能力仍未提供。


### `.9.70` exact-SHA CI failure and `.9.71` recheck (append-only)

- `.9.70` exact Review SHA `74c2a7f7952635655806a2c2b11a23fbe3a773fb`, Build `20261017-0737`: TaskFlow Build Parity Run [38982532178](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982532178); Overlay Contract and isolated PostgreSQL Migration Integration PASS; Backend Image FAIL because `zhuge_ai_codex_test.go` imported unused `os`; Web job status at checkpoint was still in progress. Browser Regression Run [38982535645](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982535645) Desktop/Mobile Chromium PASS (not iPhone Safari).
- Removed only the unused test import in checkpoint `648f9cdf493483767cd17e25b87beca545663835`; this is a Go test build correction, not runtime behavior.
- New candidate `.9.71` / Build `20261017-0741`; exact SHA is the PR #60 Review head. Its exact-SHA Build Parity and Browser Regression must pass before it can be reviewed as a complete candidate.
- Dispatch gates remain OFF; no actual Codex Cloud run, provider ACK/thread/result, Production migration/deploy, or permanent FullSource asset is claimed.


### `.9.71` exact-SHA final QA evidence (append-only)

- Review Branch `review/taskflow-github-codex-phase2-20261016` exact SHA `128b5ab9eaf2ea7a5b1c50ee1a3ee722aeb2f356`; Version `0.9.0-alpha.9.71`, Build `20261017-0741`; GitHub `version.json` was read back from that branch and matched.
- TaskFlow Build Parity [Run 38982825162](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982825162): Backend Image **PASS**, Web Image **PASS**, isolated PostgreSQL Migration Integration **PASS**, Overlay Contract **PASS**. Go handler tests included `TestTaskflowCodex`; migration run used isolated PostgreSQL, not Production.
- Browser Regression [Run 38982828979](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982828979): Playwright Chromium Desktop/Mobile **PASS**. Evidence artifact [12082240948](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982828979/artifacts/12082240948), SHA-256 `e308deb2c2fc851aa7456fb716684f2567dc6eb50a4bc53f7b4d10a19a5179be`; temporary CI retention, not permanent FullSource. This is not physical iPhone Safari.
- Local root regression, after `npm ci --ignore-scripts --no-audit --no-fund` from committed lockfile: `node --test` over root `*.test.js` except the Pages artifact harness (which requires a generated-site argument) **974/974 PASS**, exit 0. The seven PGlite-dependent test files first lacked the already locked local package, then passed 36/36 after dependency installation.
- Exact Pages artifact workflow command `node tools/build-pages-site.js /tmp/taskflow-pr60-pages-site && node tests/pages-publish-artifact.test.js /tmp/taskflow-pr60-pages-site`: **2/2 PASS**; site included 304 tracked files, excluded 7,509 non-site tracked files (4,866,090 uncompressed bytes).
- TaskFlow Python overlay suite **47/47 PASS**; TaskFlow dispatch/build parity targeted suite **23/23 PASS**; TaskFlow entry/CLI SSO Node targeted tests **18/18 PASS**. Release governance preflight and Go formatting/shell syntax/diff checks passed for .9.71.
- `.9.71` is a review candidate only. No real Codex Cloud ACK/thread/run/result, Production Migration, deployment, or secrets change occurred. Dispatch stays disabled.
- Durable FullSource package for the exact final candidate is not yet saved; package/upload status must be recorded separately and must not be inferred from the 14-day browser artifact.


### `.9.72` review re-identity after final `.9.71` evidence (append-only)

- The `.9.71` candidate above has exact-SHA Build Parity, Browser Regression, full root Node Regression, TaskFlow Python, and Pages Artifact evidence recorded.
- `.9.72` / Build `20261017-0807` is a documentation-and-release-identity-only successor to `.9.71`; it does not change TaskFlow application logic. The unique Build was generated by `tools/release-governance.js`; all 23 synchronized Build/cache-buster consumers preserve the Published C identity.
- `.9.72` precise SHA and its new exact-SHA GitHub Build Parity/Browser Regression results will be read back from PR #60. `.9.71` full source regression remains valid for unchanged application code; `.9.72` also requires its changed release identity, Docker Build, migration, and Browser gates.
- Dispatch remains OFF; no real Codex Cloud run/ACK/thread/result, Production migration/deploy, or FullSource permanent upload is claimed.

## 2026-10-17｜GitHub Connector P0 403 fallback transport checkpoint

- This Review candidate starts from PR #60 exact `.9.72` SHA `9c84531f30a2dcff9f1c9e703facb244e654ecac`. Development identity: `0.9.0-alpha.9.73 / 20261017-1603`. Changes are version/build synchronization plus the audited GitHub transport runbook, not a change to the TF runtime dispatch engine.
- Co Codex Cloud shell reports `git remote -v` missing and GitHub proxy 403; it has not pushed either of its two earlier local .9.73 variants. GPT's authenticated GitHub Connector is a distinct connection: standalone Git blob write and exact readback succeeded, and the present checkpoint is meant to test a full controlled tree/commit/PR Review branch ref update.
- **Do not overclaim**: New source is not delivered until the remote exact-SHA PR ref is confirmed; CI must belong to that new SHA; the new Source's FullSource ZIP, Manifest and SHA256 remain pending permanent backup until produced from the real clean commit/history and read back.
- No main promotion, Production DB migration 598, Render deploy, GitHub App privilege increase, paid provider dispatch or TF-to-Codex actual E2E is authorized by this recovery checkpoint.
- Engineering provenance and next evidence: [GitHub Connector Backup Transport](../../docs/30_QA/evidence/GITHUB_CONNECTOR_FALLBACK_TRANSPORT_20261017.md).
