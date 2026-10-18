# Zhuge AI OS｜PM 提供資料可追溯規範 v1

> PM 2026-10-18 正式要求：日後可以回查「曾經提供什麼資料、在哪裡、何時、用於什麼工作」。本檔是**公開版規範**；**私人資料索引的內容與永久來源連結留在 PM 未共用的 Google Drive**，不得貼公開 GitHub。

## 收件與登錄

1. 當 PM 在工作階段提供需求、程式碼、附件、圖片、文件、網址、會議紀錄或決策，當次實際處理者先記下收到日期（Asia/Taipei）、名稱、類型、來源定位、是否有原始檔、相關任務／PR、用途與處理結果。
2. 用固定流水號 `IDX-YYYYMMDD-NNN`，公開可傳播的工程資料只登錄摘要、正式公開 URL 及 Commit SHA；**不公開**員工個資、薪資、機密、憑證、敏感附件原文或私人 Google Drive 的檔案 ID/分享 URL。
3. 原文及機密來源的 metadata 應保存於 PM 私人 Google Drive 的「提供資料索引與來源履歷」；原始附件若未獨立備份，標 `SOURCE_ONLY / BACKUP_UNVERIFIED`，不可宣稱永久保存。
4. 用途、派工、修改、驗收、版本與歷史後續以 PR／Issue／GitHub Source 為權威；每天 Handoff 只收摘要及 evidence。
5. PM 詢問「我曾提供過什麼」時，優先檢索私有索引（已授權連接時），連同當日 Handoff／PR 與原始聊天，按時間列出可開啟的實際來源；避免猜測或生成不存在的沙盒鏈結。
6. **非背景服務**：沒有持續自動監測其他聊天／外部資料；資料在實際工作階段登錄。未來要做到自動收件，需要獨立設計授權、來源連接與隱私驗證。

## 2026-10-18 初始公開索引（不含私人原文）

| 來源 ID | 日期 | 類型 | 可公開摘要 | 公開成果 |
| --- | --- | --- | --- | --- |
| IDX-20261018-001 | 2026-10-18 | PM 規格＋原始程式碼片段 | Habblaud MIT Pixel Office 首頁整合，zhuge-bridge.ts、zhuge-hud.ts、zh-TW.ts、main.ts 启動碼，含 route／15 秒 polling／DOD | [PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61) |
| IDX-20261018-002 | 2026-10-18 | PM 正式決策 | 採 Habblaud 像素辦公室為 AI OS 官方首頁，保留 Classic TaskFlow，依 Release Gate 實機驗收 | [PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61) |
| IDX-20261018-003 | 2026-10-18 | PM 執行授權 | 正式發布與私人備份、所有歷程進 Handoff；建立供未來查找 PM 提供資料的私人索引 | [本日 Handoff](./20261018-Handoff.md) |
| IDX-20261018-004 | 2026-10-18 | PM 治理決策 | Handoff v1 固定 `CURRENT.md`、每日日期檔、Co/Gem/GPT 統一交接 | [CURRENT](./CURRENT.md) |

## 私人索引欄位

`ID / PM 提供日期 / 資料類型 / 標題 / 內容摘要 / 原始檔名與連結 / 穩定來源定位 / 隱私分類 / 使用目的 / TaskFlow 或 PR / Source SHA / 儲存位置 / 檔案備份與讀回狀態 / 處理結果 / 關鍵字`

**安全底線：公開 Handoff 的資料來源 ID 是可回溯標籤，絕不是對私有原文的公開授權。**


## PM 補充決策｜單人網站最小安全與 GitHub 原始連結（2026-10-18）

本節為 PM 最新明確偏好。**只用單一正式網站，資料依用途決定是否保護，不採一律加密或企業級流程。** 如與前文不符，以本節為後續操作規範；先前加密備份之完成事實仍保留。

1. 一般 PM 需求、工作筆記、公開 GitHub 原始碼／URL、公開工程資料與非敏感圖片，**不額外加密**；私人文件及 FullSource 備份使用存取權限受限的 Google Drive 即可，**不強制逐檔加密**。既有已驗證的加密備份可以保留，在替代備份完成前不要刪除唯一可還原副本。
2. 密碼、API Key、OAuth Token、私鑰、.env 機密絕不進公開 GitHub／Handoff。個資、薪資、敏感內部資料仍須存私人位置，且不得把個資列入公開索引。
3. **不另建測試站。** CI / GitHub PR 是程式碼發版前檢查，不是第二個線上環境；只保留一個正式網站。必要的建置／回復驗證可於 CI 完成。
4. PM 給的 **GitHub 原始網址必須記錄**，不只記最後做出的 PR；索引欄位：ID、提供日期、原始 URL、名稱、資料類型、用途、相關 GitHub PR/Issue/Commit 連結、固定 SHA（有則填）、結果及來源保存狀態。
5. 公開 GitHub URL 可登在公開索引；私有 repo URL、私人 Drive 位置、聊天敏感附件只留私人索引。GitHub 連接授權／Token 由平台管理，**不抄 Token 到索引**；保留的是可重新開啟的網址。
6. 聊天上傳但未另行保存的圖片、PDF、Excel 等，標記 SOURCE_ONLY / 未確認備份；登錄不代表已永久保存原始檔。以後搜尋時需區分原始檔、索引、工程成果。

### 可點擊的原始 GitHub 來源（首批，並非過往所有資料的完整盤點）

| ID | PM 曾提供什麼／日期 | ORIGINAL：原始 GitHub URL | DERIVED：相關成果 | 說明 |
| --- | --- | --- | --- | --- |
| IDX-20261018-001 | Habblaud 原始像素辦公室 2026-10-18 | [marmottajr/habblaud.git](https://github.com/marmottajr/habblaud.git) | [PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61) | 上游來源固定 SHA faa1a012b5fbf632c66dc6801c5383e53a542406；MIT |
| IDX-20261015-001 | Pixel Crew 像素辦公室參考 2026-10-15 | [juinwei7/Pixel-Crew](https://github.com/juinwei7/Pixel-Crew) | [相關像素辦公室方案 PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61) | 僅為參考，不表示採用其程式碼 |
| IDX-20261018-002 | 正式指定 Habblaud 為官方首頁 | [原始模板](https://github.com/marmottajr/habblaud.git) | [PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61)、[發布計畫](https://github.com/QQweasdzxc/zhuge-ai-os/blob/review/pixel-office-homepage-20261018/docs/40_RELEASES/PIXEL_OFFICE_HOME_P0_RELEASE_PLAN.md) | PM 正式決議與產物分開追溯 |
| IDX-20261018-003 | 發布、備份與所有提供資料日後可回查 | [本日 Handoff](./20261018-Handoff.md) | [PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61) | 連結索引不等於備份原檔 |

資料錄入時應盡量保留用戶貼出的**原始 URL 字串**，而不只以新連結取代；需要日後找回時先顯示原始連結、再顯示成果與固定 Commit。
