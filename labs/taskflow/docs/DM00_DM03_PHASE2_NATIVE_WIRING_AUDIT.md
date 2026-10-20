# DM-00～DM-03 Phase 2 Native Wiring Audit

核對基準：PR #105，`d4d69da1257745f89aa6ec8ae35034ff170d3429`。
本文件記錄原生 TaskFlow 的實際接線和仍然存在的 Gate，避免把前端契約或
GitHub 證據誤當成正式 Cloud Runtime。

## 已核對的 server path

| 層 | Source | 核對結果 |
| --- | --- | --- |
| Bearer／session auth | `third_party/multica/server/internal/middleware/auth.go` | Server 從 `Authorization: Bearer` 或既有 session 解析 user identity；Pages client 先走 `/auth/zhuge` 取得記憶體內 TaskFlow bearer。 |
| Workspace resolution | `third_party/multica/server/internal/middleware/workspace.go` | `RequireWorkspaceMember` 以 `X-Workspace-Slug`／UUID 解析 workspace，查 member，將 workspace/member 放入 context；task token 的 server-stamped workspace 不能由 client 改寫。 |
| Native issue routes | `third_party/multica/server/cmd/server/router.go` | `/api/issues` 的 list/create/update/get 都在 `RequireWorkspaceMember` group 內。 |
| Native metadata | `third_party/multica/server/cmd/server/router.go` | `/api/issues/{id}/metadata`、`/metadata/{key}` 使用同一原生 issue scope。 |
| Native task dispatch | `third_party/multica/server/internal/handler/task_lifecycle.go` | `/api/issues/{id}/rerun` 呼叫 `TaskService.RerunIssue`，回傳 `202` 和原生 task queue response。 |
| Task readback | `third_party/multica/server/internal/handler/daemon.go` | `/api/issues/{id}/task-runs` 讀取原生 Agent task queue；`active=true` 只縮小原生 history。 |
| GitHub readback | `third_party/multica/server/internal/handler/github.go`、`pr_auto_complete.go` | `/api/issues/{id}/pull-requests` 讀取／關聯 native GitHub mirror；它是 delivery evidence channel。 |
| Workspace permission | `third_party/multica/server/internal/middleware/workspace.go` | membership／role 是 server-side 查核；client 傳入的 workspace label 不能繞過 member lookup。 |

## 目前沒有接通的部分

### CTO Allowlist

`labs/taskflow/overrides/taskflow_dispatch_authority.go` 已提供
`AuthorizeCTODispatch` 的 fail-closed primitive 和 executor registry。它目前
沒有被直接注入 frozen vendor 的 `/rerun` mutation handler，也沒有正式
allowlist configuration 的 readback。因此：

- `GPT-CTO` metadata、UI label、GitHub comment 都不能作為授權。
- 沒有 authenticated server-side CTO user ID 和配置 allowlist 時，dispatch
  必須回 `UNVERIFIED`／`BLOCKED`。
- 本輪不修改正式 ACL、Secrets 或 vendor source；接線需要另外的最小 overlay
  patch 和 CTO Review。

### Cloud Provider Runtime

`/rerun` 目前建立的是 TaskFlow 原生 agent task。它不是 Codex Cloud、Gemini
或 GH Helper 的官方 Provider API，也不會提供外部 Provider Run ID。因而：

- HTTP `202` 只能是 `ACK_PENDING`。
- `task_id` 只能是 TaskFlow ID，不能複製到 `provider_run_id`。
- 沒有官方 signed callback／run readback 時，不能轉成 `RUNNING`。
- GH Helper 的 GitHub PR／commit／CI 證據不會產生 Agent execution。

### Cross-process lease persistence

既有 PR #105 的 lease／fencing／replay 是可測試的 runtime contract；本次新增
`dispatch-persistence-contract.mjs` 後，record 可以序列化、hydrate、檢查
optimistic version、重啟時將過期 lease 轉成 `OVERDUE`，並保留拒絕事件。

正式 production persistence 仍未接入既有 TaskFlow DB transaction。沒有
native store adapter 之前，不宣稱跨程序 live lock、row-level fencing 或
重啟後的正式 callback durability 已完成。

## CO-01／CO-03 使用規則

CO-01 整合 PR 時保留 PR #105 的已通過 baseline，採用 Phase 2 的最小增量：

- `dispatch-persistence-contract.mjs`
- `provider-adapter-contract.mjs`
- `DM00_DM03_PHASE2_RUNTIME_SCHEMA.json`
- Phase 2 test／capability／wiring audit

CO-03 只依 read-only native endpoints 和 schema 顯示結果。它應把
`provider_run_id: null`、`authorization: UNVERIFIED` 和
`blocked_reason` 原樣顯示，不能推導成在線、已接單或正在執行。
