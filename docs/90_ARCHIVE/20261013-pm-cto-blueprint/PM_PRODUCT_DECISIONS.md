# Zhuge AI OS｜PM 產品決策日誌（候選 v0.1）

PM 確認日期：2026-10-13（Asia/Taipei）。本日誌追蹤「PM 決定什麼」，**不等於功能已上線**。正式 Source 與 Cloud Contract 是實際行為的權威；舊治理文件未經正式審查不會因本日誌自動失效。

[產品全景](../00_CURRENT/PM_CTO_PRODUCT_BLUEPRINT.md)｜[使用流程](../00_CURRENT/PM_CTO_USER_FLOWS.md)｜[現況](../00_CURRENT/PM_CTO_PROJECT_STATUS.md)

## 如何判讀決策與交付

- **DECIDED**：產品方向已由 PM 決定，但可能尚未實作。
- **DISCUSSING**：產品方案／UI 尚未定案，不能當開發 GO。
- **CANDIDATE GO**：隔離候選開發／Developer QA 可做，非正式寫入與發布。
- **PROD HOLD**：main、Render、Production Supabase 和 PM 個人 Google 權限，仍要另行取得 PM 放行。
- **SUPERSEDED**：被新決策明確取代，舊內容保留供追溯。

## PM 決策總表

| ID | PM 已確認的定義 | 對應 Issue／來源 | 交付狀態 |
| --- | --- | --- | --- |
| P-20261013-01 | Zhuge AI OS 是產品名稱，**TaskFlow 作為新的主入口、主要操作平台與未來首頁**；舊 AI OS 不再作主要入口。 | #47 | DECIDED；未上線 |
| P-20261013-02 | 原 AI OS 的 WorkLog／Investment 等收進 TaskFlow **Apps**：A 先入口連結與安全返回；B 逐步整合 UI／資料讀取，保留模組業務邏輯。不直接全站重寫。 | #47 | A Candidate GO；B 先設計及隔離驗證 |
| P-20261013-03 | 首頁回答「今天要做什麼？」：待處理、待追蹤、到期、日曆、**Investment**、WorkLog 摘要、Apps。**不放 Token、AI 成本、Agent 執行分析**。PM 已核准原型，開始隔離候選開發。 | [#49](https://github.com/QQweasdzxc/zhuge-ai-os/issues/49) | **版型 DECIDED／CANDIDATE GO；尚未開發或上線** |
| P-20261013-04 | **Google 登入成功不等於使用權核准**。新帳號要申請，Email 來自 Google，填姓名／外號與原因；Creator／Owner 核准才可進 TaskFlow 和 Apps；可駁回、重申請，保留歷史。 | AI OS App Access Source、#47 | 原 AI OS 已有；TF 安全整合待驗證 |
| P-20261013-05 | WorkLog 原工時、日曆、分析、ECP 匯出及歷史要完整保留。TF 任務日期和 WorkLog 已完成工時可在統一日曆分圖層顯示，**資料 Authority 不合併**。 | #46、#47 | DECIDED；整合候選待開發 |
| P-20261013-06 | **所有有日期 TF Issue** 單向自動同步至 PM 個人 Google 的「Zhuge AI OS」次要日曆，Cloud 背景補漏和冪等。WorkLog 已完成工時預設不外送。 | #46 | Candidate GO；真實 OAuth／Calendar HOLD |
| P-20261013-07 | CTO 經**現有 Supabase Connector**受控建立／更新 TaskFlow 卡；PM 接受單人環境下共用 postgres 風險前提，但仍保留必要 ZG 編號、Project、去重和交易完整性。 | #42 | Candidate GO；正式 GRANT／寫入 HOLD |
| P-20261013-08 | 各 Project 可自訂 Status／欄位、隱藏／恢復原生欄，不得刪卡或修改原生七種狀態；不同 Project 應允許相同自訂顯示名稱。 | #44 | CI PASS 候選；功能缺口和 Browser/DB QA 未解 |
| P-20261013-09 | PDF／圖片預覽授權優先修復且保留下載，大型 PPTX HTTP 500 另查 Root Cause。 | #45 | Candidate GO；未上線 |
| P-20261013-10 | 使用**產品全景圖＋使用流程圖＋決策／交付狀態**溝通；新需求先查既有定義、列變更影響，再形成 PM 正式決策。 | 本文件 | DECIDED；治理文件首版候選 |

| P-20261013-11 | 首頁採 PM 核准的深色側邊欄／淺色卡片佈局，含 TF 待辦、追蹤、日曆、到期、**Investment 真實投資摘要**、WorkLog、Apps；支援 Widget 開關、排序、尺寸並保存每位使用者設定，Mac／iPhone 適配。 | [#49](https://github.com/QQweasdzxc/zhuge-ai-os/issues/49) | **CANDIDATE GO／Production HOLD**；不得使用示意數值 |

## 容易漏接的跨議題關係

1. **首頁入口反轉**不代表舊 AI OS 模組、OAuth、Supabase 資料與身份授權可以刪除；要先 A，再 B。舊 Module A／C、EP-039 等正式治理規則仍需 ADR 審查，不能默默作廢。
2. **登入與註冊**不是只有 Google 登入按鈕。要跨 TaskFlow 直連 URL、Workspace membership、後端 API、Apps 檢查 App Access；NEW／PENDING／REJECTED／UNKNOWN 都不得越權進入。
3. **Issue #46** 先受 Issue #47 的 WorkLog 日曆重用評估約束，不能再建一套重複工時日曆。任務期限是日期，廠商會議是未來的時段，工時又是完成紀錄。
4. **Issue #42** 的 Co 原回覆為 BLOCKED；PM 後續已決定繼續尋找最小 Connector SQL-only 候選。接受單人環境不等於 PM 批准 Production 即時寫入。
5. **Issue #47** 初版文字只允許唯讀評估；PM 在後續對話核准 Phase A 隔離候選開發、B 階段先做設計驗證。實際 Co 工作前須將 GitHub Issue 和指令的授權範圍對齊，不能擴充成全面重寫。
6. **Usage Dashboard** 是原生 AI 使用分析，不是 PM 要的工作首頁。PM 2026-10-13 已選定新首頁原型並授權 #49 候選 Coding；不代表可直接把原型示意股價／總市值／工作量當正式資料。

## 每一次新增決策，請維持這個格式

- Decision ID：P-YYYYMMDD-NN
- PM 確認日期：
- 原規則、功能與 Source 證據：
- 新規則一句話：
- 適用範圍／明確排除：
- 影響檢查：登入／權限／TF／Apps／WorkLog／Calendar／Google／SB／Mobile
- 相關 Issue／圖／UI Prototype：
- 取代舊 Decision ID（如有）：
- 產品決策：DISCUSSING 或 DECIDED
- 工程交付：NOT STARTED／CANDIDATE／QA VERIFIED／RELEASED
- 正式環境 Gate：HOLD 或 PM 已明確批准的 GO

## PM × CTO × Co 對話工作法

1. **新對話前**：先看本日誌、產品藍圖、使用流程、Current State、相關 GitHub Issue，再確認實際 Source／Runtime。缺資訊必須標示，不能捏造。
2. **PM 提想法後**：CTO 用白話回覆，挑正確圖（產品架構／操作流程／畫面線框／變更影響圖），並找出既有規則可能漏接處。心智圖只用於初期發想。
3. **PM 確認後**：追加 Decision ID、更新受影響圖、決策日誌與 Current State；再交給 Co 候選實作。未批准的設計標 DISCUSSING。
4. **Co 交付後**：以 Commit、Review Ref、測試與正式 Runtime 證據更新工程狀態，不用單一 CI PASS 冒稱完成。
5. **權威分層**：PM 日誌記錄目標，Source／Cloud 記錄現況，Issues 追任務，Figma 記 UI 視覺；彼此衝突時列 Gap 並請 PM 決定，不造第二套授權或執行權威。
6. **發布另議**：Production DB／Auth／Google OAuth、更動 main、Render 發布都需要獨立 PM 授權；本文件沒有執行這些工作。
