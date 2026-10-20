# DM-00～DM-03 Phase 2 Runtime Advance

這份交接固定本輪 Review 分支的邊界。它延續 PR #106 的
`ab60ecd10d868b67dafbf2514773a6ce0985db26`，不修改 PR #106、Phase 1
release、`main` 或 Production。

## CO-03 Native Read API Contract

CO-03 的工作台只讀下列版本化 read model，不自行重建後端欄位：

| 欄位 | 來源與規則 |
| --- | --- |
| `schema` | 固定為 `zhuge-taskflow-dispatch-persistence-v1`；schema 文件為 `DM00_DM03_PHASE2_RUNTIME_SCHEMA.json` |
| `intent_id`, `idempotency_key`, `workspace`, `issue_id`, `work_code` | TaskFlow durable Dispatch Intent；workspace 由 server middleware／native issue 決定 |
| `executor_id`, `provider` | server-side Executor Registry；不得相信 UI label |
| `task_id` | TaskFlow native task queue readback；可為 `null` |
| `provider_run_id` | 只有 signed／官方 Provider event 或官方 Provider readback 才可填；沒有時必須是 `null` |
| `provider_run_id_source` | `provider_event`、`native_readback` 或 `null`；TaskFlow task ID、HTTP 202、GitHub comment 不合資格 |
| `state` | `INTENT_CREATED`、`ASSIGNED`、`ACK_PENDING`、`RUNNING`、`OVERDUE`、`BLOCKED`、`CANCELLED`、`FAILED`、`REASSIGN_REVIEW`、`REVIEW`、`DONE`、`UNKNOWN`、`PM_ACCEPTED` |
| `authorization` | `AUTHORIZED`、`DENIED`、`UNVERIFIED`；Allowlist 缺失為 `UNVERIFIED`／blocked |
| `evidence` | `provider_ack`、`provider_run_id_source`、`github_sha_source`、`blocked_reason`、`error`；UI 直接顯示 evidence 狀態 |

Projector source：[`runtime-read-model-projector.mjs`](../pages-client/runtime-read-model-projector.mjs)。它已在測試中讀取實際 JSON Schema，並驗證有效模型、偽造 authorization、缺失 evidence、native task 不得冒充 Provider Run。

## Native mutation candidate

Review overlay 提供：

```text
POST /api/issues/{id}/dispatch
Authorization: existing TaskFlow auth middleware
Workspace: existing RequireWorkspaceMember middleware
Body: { "task_id": "<optional native task>", "executor_id": "CO-02", "provider": "codex" }
```

Server 端會從 authenticated request 取得 user／workspace，讀受保護的
`TASKFLOW_CTO_ALLOWLIST_USER_IDS`，驗證 CTO authority、workspace、Executor
Registry 及 provider 對應，再將只含既有 `task_id` 欄位的請求交給原生
`RerunIssue` service。Allowlist 空值或未配置回 `503`；非 CTO、workspace
mismatch、unknown executor/provider 回 `403`。這是 Review candidate，尚未配置
正式 Allowlist，也未聲稱已產生 Provider ACK／Run。

既有 `POST /api/issues/{id}/rerun` 保持原生行為，不能被工作台當作 Cloud
dispatch success。`GET /api/issues/{id}/task-runs` 只能讀 TaskFlow native
task history。

## Transaction／row-lock candidate

[`native-persistence-adapter-contract.mjs`](../pages-client/native-persistence-adapter-contract.mjs)
要求正式 adapter：

1. 在同一 transaction 先鎖 native issue row，再鎖 `agent_task_queue` row，固定使用 `FOR UPDATE` 語義。
2. 讀取 durable record，檢查相同 `idempotency_key` 和 `expected_version`。
3. 只透過既有 TaskFlow native authority 寫入，禁止新增 dispatch task table。
4. reducer replay 不產生第二次 write；版本競態、fencing 或 transaction failure 回滾。
5. restart 重新讀取 native record 後才能進行 lease expiry recovery。

Review fake 已驗證並行 writer、replay、rollback 和新 adapter instance 的 lease
expiry recovery。正式 DB connection、row lock readback、audit persistence 仍為
`UNVERIFIED`，因此不能回報跨程序 Production runtime 已完成。

## Provider capability and binding gate

| 通道 | 目前可用接口 | 目前判定 | 需要的正式條件 |
| --- | --- | --- | --- |
| Codex Cloud | [官方 Codex Cloud 說明](https://developers.openai.com/codex/cloud/)確認可在 ChatGPT 的 Cloud environment 連接 GitHub repository、啟動 coding task、查看結果並 commit／開 PR；TaskFlow 只有 cloud runtime HTTP proxy，沒有可核驗的 Codex Cloud dispatch adapter、signed ACK callback、Run lookup 或 checkpoint binding | `UNVERIFIED` | CTO 核准 workspace/provider binding、server-side credential scope、可由 TaskFlow 呼叫的官方 dispatch/status interface、callback／readback 證據、quota／checkpoint 定義 |
| Gemini | [官方 Interactions API](https://ai.google.dev/gemini-api/docs/interactions)提供 interaction create、server-side state 與 `background=true`；[Managed Agents](https://ai.google.dev/gemini-api/docs/agents)提供遠端 sandbox agent。這個分支沒有已核准的 Gemini dispatch adapter、API key／service identity、callback 或 Run readback | `UNVERIFIED` | CTO 核准 workspace/provider binding、受控 API key/service identity、Interaction／background operation 的 server-side mapping、status／result readback 與 checkpoint 語義 |
| GH Helper | [GitHub App 官方文件](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps)說明 App 可用安裝權限、自身身分及 webhook 做 repository automation；Native GitHub routes 可讀 PR、exact SHA、CI，但不能啟動 Agent 或建立 Provider Run | Dispatch／ACK／Run／Heartbeat／Checkpoint `UNSUPPORTED`；GitHub evidence 可用 | GitHub App／token 只能授權 repository evidence，不能升級為 Agent runtime |

本次以 2026-10-20 讀取到的官方文件作能力查核。Provider adapter 只接受官方回報且有 event ID、Run ID、status、observed time
和 signature verification 的事件。現階段沒有這些正式 binding／credential，所有
Cloud lifecycle 仍是 `UNVERIFIED` 或 `BLOCKED`，沒有真實 ACK／Run evidence。

## 交付與剩餘 Gate

- Source：projector、schema validator、native transaction adapter、CTO route overlay、negative/contract tests。
- QA：Node projector／adapter tests；Python overlay tests；Go／Docker／Browser exact-SHA 由新 Review PR 重新驗證。
- 待 CTO／PM：正式 Allowlist readback、native DB adapter 注入、Provider binding／credential、是否允許付費 Provider、一次隔離 workspace 的可回放 e2e dispatch。
