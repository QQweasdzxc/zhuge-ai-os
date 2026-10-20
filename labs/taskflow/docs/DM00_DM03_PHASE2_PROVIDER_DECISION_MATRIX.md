# DM-00～DM-03 Phase 2 Provider Decision Matrix

這份矩陣把正式 Cloud Runtime 需要的能力、權限和解除條件分開記錄。它是
CTO 的決策資料，不是 Provider binding、credential 配置或付費啟動的授權。
本 Review branch 沒有讀取 Secrets、沒有呼叫 Provider，也沒有建立正式 callback
endpoint。

## 判定原則

`VERIFIED` 必須同時有官方能力文件、CTO 核准的 workspace/provider binding、
不進 Source 或 Pages bundle 的 credential、signed callback 或官方 Run readback，
以及 TaskFlow native issue／task 的 identity binding。只有文件存在時，能力仍是
`UNVERIFIED`。

| Provider | 官方能力與目前限制 | 最小 credential／權限方向 | Callback／Run 證據要求 | 成本與核准 | 目前判定 |
| --- | --- | --- | --- | --- | --- |
| Codex Cloud | [Codex Cloud](https://developers.openai.com/codex/cloud/) 描述 Cloud environment、GitHub/task/review 工作流；本專案尚未取得可由 TaskFlow server 呼叫的 dispatch、ACK、Run lookup 或 callback binding | CTO 指定的官方 workspace identity／credential scope；不得用 Pages token、Session scraping 或 GitHub comment 代替 | Provider 回傳的 Run ID、signed ACK/status、workspace／issue／TaskFlow task／idempotency binding；heartbeat、checkpoint、resume 需各自證據 | 任何受費用或配額控制的 execution 需 PM 額外核准；本輪不啟動 | `UNVERIFIED`／`BLOCKED` |
| Gemini | [Interactions API](https://ai.google.dev/gemini-api/docs/interactions) 與 [Agents](https://ai.google.dev/gemini-api/docs/agents) 提供官方 API surface；本專案沒有核准的 Google project、service identity、provider binding 或 callback readback | CTO 指定的 Google project credential（API key 或 OAuth/service identity 依正式部署選擇）；Secret 只進 runtime secret store | Interaction／agent ID 必須由官方回應取得，並以 signed/可驗證 callback 或官方查詢綁回 native TaskFlow identity；不得從 TaskFlow task ID 推導 | Google quota、model 使用與 background execution 的費用／限制需 CTO 決策，涉及付費時需 PM 額外核准 | `UNVERIFIED`／`BLOCKED` |
| GH-HELPER | [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps) 可支援 repository automation；本資源只負責 GitHub evidence readback，不是 AI Provider，不建立 Provider Run | 只讀 evidence 的最小方向為目標 repo 的 Issues／Pull requests／Actions／Contents read 權限；任何寫入權限另行審查 | native TaskFlow readback 保存 PR number、exact SHA、CI URL/status；GitHub webhook 必須驗簽與去重，不能形成 Agent ACK/Run | GitHub API quota 需監控；不啟動 agent execution | `UNSUPPORTED`（Agent runtime）／evidence readback 仍待正式 binding |

## 共同 Runtime Gate

在任何 Provider 被標為可派工前，CTO 需要確認：

1. `TASKFLOW_CTO_ALLOWLIST_USER_IDS` 或等價的原生 Authority 已由正式環境提供，且 mutation handler 能讀到 server-side authenticated identity。
2. Provider binding 指定唯一 workspace、executor、provider、credential scope、quota policy 和 callback URL；credential 不得由 client 傳入。
3. callback endpoint 能驗證 provider signature／nonce、event ID、Run ID、observed time 和 identity binding，並把 replay ledger 寫入既有 TaskFlow native transaction。
4. `provider_run_id`、ACK、heartbeat、checkpoint、quota 和 completion 各自有官方來源；HTTP 202、TaskFlow `task_id`、GitHub comment 或 UI 狀態都不能補足缺失證據。
5. 先在隔離 Review workspace 做可回放測試，再由 CTO／PM 依費用與正式權限 Gate 決定是否啟用。

## 本輪可交付與外部 Gate

已交付的是 fail-closed adapter、callback security contract、durable reducer、native
read model、WorkBench read-only envelope 和 negative tests。正式啟用前仍缺：

- CTO Allowlist 與原生 mutation handler 的部署 readback；
- 既有 TaskFlow DB 的 transaction／row-lock／audit adapter；
- Codex Cloud 或 Gemini 的正式 credential／binding；
- 可驗簽 callback、真實 ACK／Run／heartbeat／checkpoint／quota readback；
- 付費與配額政策的 PM 核准（若 Provider 方案需要）。

在上述條件完成前，程式必須維持 `UNVERIFIED`、`UNSUPPORTED` 或 `BLOCKED`，不得
產生假 Run ID 或自動改派 Writer。
