# DM-00～DM-03 Phase 2 Runtime Capability Matrix

這份文件是 PR #105 (`d4d69da1257745f89aa6ec8ae35034ff170d3429`) 之後的
Phase 2 Review 契約。它只描述可驗證的能力；沒有 Provider binding、正式
credential、簽章回呼和 Run readback 時，狀態保持 `UNVERIFIED`／`BLOCKED`。

## 判定規則

一項 Cloud Dispatch 能力只有在下列證據同時存在時才能標為 `VERIFIED`：

1. Provider 官方支援該能力的文件或 API surface。
2. 由 CTO 核准的 workspace/provider binding。
3. 不在 Source 或 Pages bundle 內的正式 credential。
4. 可驗證來源的 ACK、Provider Run ID、狀態事件或 signed callback。
5. TaskFlow native readback 能把 Provider Run 與原生 issue/task 綁回同一 workspace。

本 Review 環境沒有配置上述正式 runtime，因此不把 HTTP 202、TaskFlow task
ID、GitHub comment、動畫或前端 metadata 當成 Provider ACK／Run。

## Provider 能力

| Provider／執行資源 | Dispatch | ACK | Run lookup | Heartbeat | Checkpoint | 安全改派 | Quota | Review 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex Cloud (`codex`) | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | 沒有核准的官方 runtime binding、credential、callback signature 或 readback |
| Gemini (`gemini`) | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | 沒有核准的官方 runtime binding、credential、callback signature 或 readback |
| GH Helper (`github`) | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | `UNVERIFIED` | GitHub mirror 可提供 PR／SHA／CI 證據，但不啟動 Agent、不建立 Provider Run |

程式化矩陣位於
[`provider-adapter-contract.mjs`](../pages-client/provider-adapter-contract.mjs)。
它的 adapter 是純契約，沒有 fetch、Session scraping、credential 讀取或付費
Provider 呼叫。即使呼叫端把 `credentialStatus` 標成 `CONFIGURED`，未把某一
Provider 能力明確升為 `VERIFIED` 時仍會回 `BLOCKED`。

## TaskFlow 原生執行接線

| 生命週期 | 現有原生接線 | 可以證明什麼 | 尚不能證明什麼 |
| --- | --- | --- | --- |
| CTO → native issue | `POST /api/issues`，既有 Auth、workspace member 和 issue permission | 原生 TaskFlow issue 已建立 | CTO Allowlist 尚未接入正式 mutation handler |
| executor binding | issue `assignee_type`／`assignee_id` 加 `zhuge_owner`／`zhuge_provider` metadata | 責任代碼和原生 assignee 可讀回 | 不代表 Provider 已在線或可接受工作 |
| dispatch request | `POST /api/issues/{id}/rerun` | TaskFlow 回傳原生 task queue record／task ID | 不代表外部 Provider ACK 或 Provider Run ID |
| task readback | `GET /api/issues/{id}/task-runs` | 原生 queue 的狀態與歷史 | 不代表 Cloud Provider 的獨立 Run 狀態 |
| GitHub evidence | `GET/POST /api/issues/{id}/pull-requests` 加 native metadata | TaskFlow 可讀回 PR 關聯，並保存 exact SHA／CI URL | GitHub event/comment 不可授權派工或建立 Run |
| CTO Review／PM acceptance | native issue status、GitHub exact SHA／CI 和驗收 reference | 可形成 Review read model | 尚未有正式 PM acceptance runtime write gate |

原生路由、middleware 和目前缺口的逐檔核對見
[`DM00_DM03_PHASE2_NATIVE_WIRING_AUDIT.md`](./DM00_DM03_PHASE2_NATIVE_WIRING_AUDIT.md)。

## Durable runtime record

Phase 2 加入可序列化的
[`dispatch-persistence-contract.mjs`](../pages-client/dispatch-persistence-contract.mjs)。
它把下列欄位視為同一筆可持久化的 dispatch record：

- `intent_id`、`idempotency_key`、`workspace`、`issue_id`、`work_code`、`task_id`。
- `issuer_user_id`、`issuer_authorization`、`executor_id`、`provider`。
- `writer_id`、`fencing_token`、單調遞增 `fencing_epoch`、`lease_expires_at`。
- `provider_run_id`、Run source、`processed_event_ids`、`rejected_event_ids`。
- `checkpoint_ref`、heartbeat、quota、retry attempt、run history 和 audit log。

目前交付的是跨程序可 hydrate／replay 的 reducer 及負向測試，不是假稱已經
接上正式 DB。正式 TaskFlow 仍未新增 migration、table 或 ACL；要啟用跨程序
持久化，下一 Gate 必須由 CTO／PM 指定既有 native store 的 transaction／row
lock adapter，並用正式 DB readback 驗證版本衝突和 fencing。

## CO-01／CO-03 交接欄位

DM-04 工作台和整合者只需要讀取同一份 native read model：

```json
{
  "issue_id": "<native issue id>",
  "work_code": "DM-02",
  "executor_id": "CO-02",
  "provider": "codex",
  "task_id": "<TaskFlow task id>",
  "provider_run_id": null,
  "dispatch_state": "ACK_PENDING",
  "authorization": "UNVERIFIED",
  "observed_at": "<ISO-8601>",
  "lease": {
    "writer_id": "<writer>",
    "fencing_epoch": 1,
    "expires_at": "<ISO-8601>"
  },
  "evidence": {
    "provider_ack": "UNVERIFIED",
    "provider_run_id_source": "UNVERIFIED",
    "github_sha_source": "native_github_mirror",
    "blocked_reason": "PROVIDER_RUNTIME_UNVERIFIED"
  }
}
```

正式欄位 schema 見
[`DM00_DM03_PHASE2_RUNTIME_SCHEMA.json`](./DM00_DM03_PHASE2_RUNTIME_SCHEMA.json)。
`provider_run_id` 沒有 Provider readback 時必須是 `null`；CO-03 不得從
`task_id` 或 GitHub 證據推導它。

## 下一個真正 Gate

1. CTO 提供正式 Allowlist 的 server-side readback，並把 authorization check
   接到受控 mutation path。
2. PM 額外核准 Provider binding、credential scope 和是否允許付費服務。
3. Provider 提供官方支援證據、signed callback、實際 ACK／Run readback、
   heartbeat／checkpoint 和 quota response。
4. 指定既有 TaskFlow native store 的持久化 adapter；不新增第二套 Task DB。
5. 於隔離 Review workspace 做一次可回放的 end-to-end dispatch，完成后才可
   將 `UNVERIFIED` 改為 `VERIFIED`。
