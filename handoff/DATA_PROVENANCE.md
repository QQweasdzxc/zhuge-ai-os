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
