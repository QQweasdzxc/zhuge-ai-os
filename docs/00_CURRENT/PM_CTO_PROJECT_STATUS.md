# Zhuge AI OS｜PM × CTO 專案現況快照（候選）

> **快照：2026-10-13（Asia/Taipei）。不是即時監控儀表板。**
> 新聊天開始時先查看本頁，再以 GitHub 最新 Commit／Issue、部署 Source Parity 和 Cloud read-only 證據更新；不得用今天的數字代表明天的真實狀態。

[全景藍圖](PM_CTO_PRODUCT_BLUEPRINT.md)｜[操作流程](PM_CTO_USER_FLOWS.md)｜[PM 決策日誌](../10_GOVERNANCE/PM_PRODUCT_DECISIONS.md)

## 一、現況與目標必須分開

| 範圍 | 目前 Source／交付事實 | PM 核准的產品目標 | 下一個驗證點 |
| --- | --- | --- | --- |
| 主入口 | 現有 AI OS 及 TaskFlow 為不同 Web 實作／入口。 | TaskFlow 成為 Zhuge AI OS 前台首頁。 | #47 Apps Phase A 導覽、返回、登入與 Mobile QA。 |
| Apps／WorkLog | WorkLog 已有真實工時資料、月曆、工時登錄／分析／ECP。 | Phase A 連結保留，Phase B 漸進融合。 | 確認 Auth、CSP、跨 origin session，不重寫 WorkLog。 |
| 身分審批 | 既有 AI OS App Access Service/Gate 與管理審核 UI 有 NEW／PENDING／APPROVED／REJECTED。 | TF、Apps、後端 API 也必須實施相同核准規則。 | TF 直接 URL、API、Workspace membership 與舊路由驗證。 |
| TF Issues／Project | 正式 TaskFlow 已存在 Project、Issue、原生狀態；由 TF native runtime 管理。 | CTO 可透過 SB Connector 受控建立／更新卡片。 | #42 最小 SQL 候選、事件差異／交易完整性／隔離 QA。 |
| TF 每專案狀態 | Co review 分支已有 Web Overlay 候選／CI PASS；跨 Project 同名和 API 隔離有限。 | 每 Project 可獨立設定顯示／隱藏、同名自訂欄。 | #44 Project A/B、Desktop/Mobile、DB 讀回和同名需求。 |
| TF 附件 | 使用者回報 PDF／圖片 Preview missing authorization；下載可用，另有 13.5 MB PPTX 500。 | 預覽、下載、安全授權正常。 | #45 修 Preview；PPTX 另查。 |
| 統一日曆 | WorkLog 已有成熟月曆；TF Issue 有日期欄位。 | 任務日期／工時分圖層整合；後續 Google 同步。 | #47 WorkLog reuse assessment → #46 Calendar candidate。 |
| Google Calendar | 目前沒有證據證明 PM 個人「Zhuge AI OS」次要日曆已接上自動同步。 | TF 有日期卡全部單向、Cloud 背景補漏。 | 隔離 OAuth／Google QA；正式 PM 帳號 HOLD。 |
| 工作首頁 Dashboard | TF 原生 /usage 是 Usage／Errors 分析，另有簡單 Project 進度；非工作首頁。 | PM 已選定深色側欄＋淺色卡片原型：今日待辦、追蹤、行事曆、到期、Investment、WorkLog、Apps，Widget 可個人化。 | [#49](https://github.com/QQweasdzxc/zhuge-ai-os/issues/49) 候選 Coding GO；真資料／授權／Mobile QA／正式發布仍 HOLD。 |

## 二、截至快照的 GitHub 身分與候選

- GitHub repo: [QQweasdzxc/zhuge-ai-os](https://github.com/QQweasdzxc/zhuge-ai-os)
- 讀取時 main HEAD: f3ad6832802d44978fe41402e36a51d986cc8d59（.9.35 相關基線；不可自行解讀為所有 Production 服務版號）。
- 讀取時 TaskFlow 開發分支 taskflow-dev HEAD: a4c22c1bba68957532965e2648ff49b411317810。
- #42／#44 Co 候選分支：[review/taskflow-issues-42-44-20261013](https://github.com/QQweasdzxc/zhuge-ai-os/tree/review/taskflow-issues-42-44-20261013)
- 該候選最新 Commit: 1bf1ec418fbdcaa6d6eb6d6b6a0a44c393de184c；GitHub Actions [38380819145](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38380819145) SUCCESS，**不是正式 Browser／DB 驗證或 Production Release**。
- 此藍圖候選：review/pm-cto-product-blueprint-20261013；**僅文件**，與 Co 功能候選分支分離。
- .9.36 Performance/Stability 修正曾被列為需保護的獨立成果；**正式發布版號、Runtime 部署 SHA 未在本次文件變更中重新核證**。

## 三、Issues／授權佇列

| Issue | 類別 | PM 已說明的工程授權 | 未過 Gate |
| --- | --- | --- | --- |
| [#42](https://github.com/QQweasdzxc/zhuge-ai-os/issues/42) | SB → TF 建卡 | 重新評估／最小候選 GO | SQL 成功、資料讀回、Project UI、事件缺失驗證；Production 寫入 HOLD |
| [#44](https://github.com/QQweasdzxc/zhuge-ai-os/issues/44) | Project 狀態 | 既有 Overlay 候選完善 GO | 跨專案同名、真實 DB／Desktop/Mobile、API 隔離 |
| [#45](https://github.com/QQweasdzxc/zhuge-ai-os/issues/45) | Preview／Upload | 隔離修復 GO | PDF／圖片／大 PPTX 的實際 Runtime QA |
| [#46](https://github.com/QQweasdzxc/zhuge-ai-os/issues/46) | TF + WorkLog Calendar／Google | 以 #47 可重用性為前置，候選／隔離 QA GO | 日期語意、OAuth 測試、Cloud reconciliation、PM Google 真實寫入 |
| [#47](https://github.com/QQweasdzxc/zhuge-ai-os/issues/47) | TF 主入口、Apps／WorkLog | 初始 Issue 唯讀 Gate；**PM 後續核准 A 候選 GO、B 先驗證** | Issue 文案與 PM 最新授權同步、SSO/跨來源驗證、避免全面重寫 |
| [#49](https://github.com/QQweasdzxc/zhuge-ai-os/issues/49) | 工作首頁 Dashboard | **PM 已同意原型，候選開發 GO** | 真資料、Investment、WorkLog、Widget 偏好與 Desktop/Mobile QA；Production HOLD |

**授權重要說明**：上表的「GO」只授權非正式候選、文件及隔離 QA；沒有任何一列等於 PM 授權修改正式 Supabase Auth/RLS/GRANT、PM Google Calendar、合併 main 或部署 Render。

## 四、PM／CTO 的下一次對話如何從此頁開始

1. 問題屬於哪個模組？先讀對應的藍圖區域與 Decision ID。
2. 查該 Issue 的最新回覆、Branch／Commit、部署 SHA 與 Source／Cloud 實際能力；標明資料最後確認時間。
3. 只在圖上更動受影響的流程／頁面；列出 Auth、Permissions、Data、UX、Mobile、QA、Rollback 與 Calendar 連動。
4. 讓 PM 確認新增或修改的決策；記錄為 DECIDED 或 DISCUSSING。
5. 若交付 Co，指令必須可執行、有明確 Go/Hold gate、Exit Criteria，不用重問 PM 已確認的方向。
6. Co 候選回覆後更新 QA 與 Current State，未驗證事項保持未驗證；正式環境放行另由 PM 核准。

## 五、更新責任與凍結條件

- **PM**：確認產品定義與是否正式發布；可隨時改決策，但要寫明取代範圍。
- **CTO（ChatGPT）**：先查基線、畫圖、找衝突、維護決策／現況紀錄與發開發建議；不能保證單靠聊天 Memory 永不漏接。
- **Co**：提供可追溯候選、完整 QA 和差異證據；不能用 Mock／CI 代替使用者已核准的正式結果。
- **文件治理**：本頁是快照索引，不另開平行資料權威。之後若隨候選分支前進，應以實際來源更新並提交審查，不得直接跳過 main 合併 Gate。
