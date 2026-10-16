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
