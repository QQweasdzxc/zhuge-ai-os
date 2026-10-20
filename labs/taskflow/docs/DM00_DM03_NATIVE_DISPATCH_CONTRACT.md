# TaskFlow Native Dispatch Contract v1.1

這份契約是 CO-02 與 GEM-01 平行開發的 Review 基準。它沿用既有 TaskFlow `taskflow` schema 與原生 API；本切片不新增資料表、不套用 Issue #42 SQL、不直接寫 Supabase，也不宣稱已發布 Production。

## Native record

一張工作卡就是一張原生 TaskFlow issue。`work_code` 使用穩定跨模組格式（例如 `DM-00`、`OPS-001`），原生欄位承載 `status`、`priority`、`assignee_type`、`assignee_id`；工作編號、責任代碼、下一步、來源證據、驗收與執行追蹤放在原生 issue `metadata` KV。這不是第二套任務資料庫。

保留的 metadata keys 如下：

| Key | 用途 |
| --- | --- |
| `zhuge_work_code` | DM 工作編號 |
| `zhuge_owner` | `CO-01`、`CO-02`、`CO-03`、`GEM-01`、`GH-HELPER` 或 `GPT-CTO` |
| `zhuge_next_step` | 下一個可執行步驟 |
| `zhuge_source_evidence` | 研究、Bug 或需求的來源 URL |
| `zhuge_acceptance` | 驗收條件 |
| `zhuge_dispatch_status` | DM 狀態機，見下節 |
| `zhuge_status_source` | `taskflow_native` 或明確的 provider source |
| `zhuge_observed_at` | 最近一次可追溯觀測時間 |
| `zhuge_task_id` | TaskFlow 原生 task queue ID |
| `zhuge_provider` | 實際回報的 provider；未知時留空 |
| `zhuge_provider_run_id` | 只有 provider 真正回報時才填入 |
| `zhuge_provider_error` | 原生 API／provider 回報的錯誤 |
| `zhuge_cto_authorization_result` | 後端授權讀回：`AUTHORIZED`、`DENIED` 或 `UNVERIFIED` |
| `zhuge_cto_authorization_evidence` | 授權驗證來源與時間；前端標籤不能代替它 |

Metadata 遵守既有原生限制：單值只能是 string、number 或 boolean；不把整個 JSON 狀態機塞進 value。

## Dispatch state

| State | 意義 | 可宣稱的證據 |
| --- | --- | --- |
| `CREATED` | 已建立原生卡 | `POST /api/issues` 成功 |
| `ASSIGNED` | 已登記責任代碼，可能尚未綁定實際 Agent | 原生 issue owner metadata；若有 `assignee_id` 才是原生 Agent 指派 |
| `ACK_PENDING` | TaskFlow 已接受啟動請求，等待 Agent／provider 回報 | `POST /api/issues/{id}/rerun` 的 HTTP 202 與原生 `task_id` |
| `RUNNING` | 原生 task run 已回報 running/in-progress | `GET /api/issues/{id}/task-runs?active=true` |
| `BLOCKED` | 啟動或執行被拒絕、逾時或缺少 capability | 原生 HTTP error／task error；畫面必須保留原因 |
| `REVIEW` | 交付已回到 PM 驗收 | 原生 issue status 或 PM 驗收證據 |
| `DONE` | PM 已完成驗收 | 原生 issue status + 驗收證據 |
| `FAILED` | Provider／原生執行明確失敗 | 原生 task error 或 provider error |
| `UNKNOWN` | 尚無足夠原生證據判定 | 缺少或不可信的狀態來源 |
| `STALE` | `observed_at` 超過 TTL | 新鮮原生 readback 尚未取得 |

`ACK_PENDING` 不等同 `RUNNING`。`task_id` 也不等同 Provider Run ID；`zhuge_provider_run_id` 沒有真實回報時保持未取得，不能用留言、動畫或 task ID 填假值。

## API surface

- DM-00／DM-01：`POST /api/issues`、`PUT /api/issues/{id}`、`GET/PUT /api/issues/{id}/metadata[/key]`、`GET /api/agents`。
- DM-02：`POST /api/issues/{id}/rerun` 建立原生 TaskFlow run；`GET /api/issues/{id}/task-runs?active=true` 讀取活動與歷史。沒有實際 Agent、runtime 或 provider capability 時顯示 `BLOCKED`／`UNSUPPORTED` 與原生原因。
- DM-03：`POST /api/issues/{id}/pull-requests` 只關聯已由 TaskFlow mirror 的 GitHub PR；Issue、commit URL、CI URL 與輸入的完整 SHA 以原生 issue metadata 保存。PR list 的 `head_sha` 是 native readback；在尚未有 native readback 前，手動輸入的 SHA 標記為待驗證，不得冒充已驗證。

所有 endpoint 都走既有 Zhuge token exchange、workspace header 與 TaskFlow member permission。派工 mutation 另外必須由後端以 authenticated `user_id` 對受控 CTO user-ID allowlist 驗證；`GPT-CTO` metadata、UI label、GitHub comment 或 client body 都不能授權派工。allowlist 尚未配置時，後端固定回 `UNVERIFIED/BLOCKED`。Pages client 不保存 bearer、不呼叫 GitHub 私有 API、不包含 secrets。

## GEM-01 interface

DM-04 前端／BFF 讀取同一張 issue：`identifier`、`metadata.zhuge_*`、`assignee_id`、`task-runs`、`pull_requests`。UI 可只依 `zhuge_dispatch_status` 顯示狀態，但 provider evidence 要同時顯示 `zhuge_task_id`、`zhuge_provider_run_id`、`zhuge_observed_at` 與錯誤。後續工作台不另建卡片 store 或第二個任務 ID。

GEM-01 的 read-only schema 參見同目錄 `DM00_DM03_NATIVE_API_SCHEMA.json`。目前已可讀取的原生 endpoint 是 `GET /api/workspaces`、`GET /api/issues`、`GET /api/issues/{id}`、`GET /metadata`、`GET /task-runs`、`GET /pull-requests`；認證是既有 Zhuge session exchange 後的 in-memory TaskFlow bearer 與 `X-Workspace-Slug`。`POST /issues`、`PUT /metadata`、`POST /rerun` 與 assignment mutation 均受正式 runtime authority／member ACL Gate 約束。

## Gate

本分支已實作：原生卡／metadata／run／GitHub readback、跨模組 Work Code、Executor Registry、fail-closed CTO authority primitive、Overlay patch、CI contract。正式 Runtime 尚待驗證：受控 allowlist 配置與 readback、Provider ACK／Provider Run ID、重複派工與錯誤改派的 live DB 競態測試。未改正式 DB、Secrets、Production、Render 設定或 #42 candidate SQL。

`dispatch-runtime-contract.mjs` 定義不依賴 Provider 的安全邊界：Dispatch Intent 冪等鍵、CTO 授權結果、Writer lease、fencing token、租約逾期、Provider Run ID 必須來自事件回報，以及 duplicate/replay 的拒絕規則。Provider 能力矩陣目前以 `UNVERIFIED`／`UNSUPPORTED` 表示；沒有官方 runtime evidence 時不會轉成 ACK 或 RUNNING。
