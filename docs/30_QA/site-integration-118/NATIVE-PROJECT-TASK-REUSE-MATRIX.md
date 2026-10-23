# Native AI Project／Task UI reuse matrix

基準：PR #122，CO-03 review branch。這份矩陣區分已接通的原生 readback 與尚待 CO-01 提供的正式契約；沒有把本地 Fixture 當成 Product Acceptance。

| PM 要求 | 目前來源 | CO-03 行為 | 狀態 |
| --- | --- | --- | --- |
| 五位 Executor 入口 | Pages client registry | 固定列出五位；預設全部 GAP，只有 versioned server mapping envelope 才建立原生路由 | SOURCE CONTRACT / LIVE GAP |
| Executor → Native Project ID | TaskFlow `/api/projects` 不含已驗證 Executor Registry mapping | 不以 name、slug、lead、Project metadata 或前端 ACL flags 推論；UUID、Workspace、ACL 缺失即 GAP | BLOCKED |
| Native Project route | TaskFlow 原生 `/{workspaceSlug}/projects/{projectId}` | 只接受 UUID Project ID 並限制至核准 TaskFlow Web host | ROUTE SOURCE VERIFIED / MAPPING GAP |
| 原生六欄 Project Kanban | TaskFlow Native Project 頁面 | AI 派工中心連結到原生 Project route；不在 Pages client 重做 Kanban | NATIVE REUSE CONTRACT |
| 原生卡片／Detail | `/api/issues/{id}` readback | 使用原生 Issue ID 與既有 detail route | SOURCE PASS / LIVE AUTH NOT VERIFIED |
| Status movement／drag | 原生 Project mutation API 未提供 | 不提供前端假更新，保留 GAP | BLOCKED |
| AI Tasks View / AI scope filter | Native `/{workspaceSlug}/issues` 與 `/{workspaceSlug}/my-issues` 存在；追蹤的 Web App 沒有 `/tasks` route 或 AI-managed scope filter | 一般 Issues／My Issues 不可冒充 AI Tasks filter；AI 任務中心不顯示自製 Kanban、不載入未過濾的人類 Issue，明確顯示 GAP | BLOCKED |
| AI Issue membership | protected `/api/issues/{id}/dispatch-runtime` readback contract | Fixture helper 只接受 canonical server runtime + Durable Intent + 同一 Issue／Workspace；不能用 metadata、GitHub、assignee 或標題分類 | ISOLATED CONTRACT ONLY |
| Native Issue ID dedupe | TaskFlow native Issue identity | 相同 ID 完全一致時收斂為一筆；Status／Workspace 衝突時排除 | ISOLATED CONTRACT ONLY |
| 雙入口同一 Issue | native Issue ID | 正式 Tasks filter 未接通前不展示第二份卡片 | BLOCKED |
| 改派與歷史 | CO-01 mutation／audit contract 未提供 | 不提供假改派；等待原生 mutation | BLOCKED |
| Workspace／ACL／401／403 | existing authenticated transport | API／權限錯誤 fail-closed；Client contract 不是 ACL 授權 | SOURCE PASS / LIVE ACL NOT VERIFIED |

## Sprint 03 Source contract

`native-project-mapping-contract.mjs` defines the required response envelope:

* schema `taskflow-native-executor-project-mapping-v1`;
* source `TASKFLOW_NATIVE_EXECUTOR_REGISTRY`;
* Workspace UUID and recent server evaluation time;
* one row per Executor, with unique Native Project UUID, matching Workspace UUID,
  `workspace_access=ALLOW` and `project_access=ALLOW` from TaskFlow's native ACL
  authority.

This is a client validation contract only. Current `/api/projects` does not
provide this server-owned envelope, and no live Executor→Project binding was
verified. Project `name`, `slug`, `lead`, `executor_id` custom metadata, or
client booleans are not accepted. No Project has been created or assigned.

The tracked TaskFlow Next.js routes confirm `/{workspaceSlug}/projects`,
`/{workspaceSlug}/projects/{id}`, `/{workspaceSlug}/issues`, and
`/{workspaceSlug}/my-issues`. The latter two are general/workspace or personal
Issue views; source review found no native `/tasks` route and no server-side
AI-managed filter. Linking either unfiltered route from AI Tasks would include
human work, so the UI does not do so.

`selectVerifiedNativeAIIssues()` is an isolated projection contract for rows
returned by a future authenticated server-side AI Tasks query. It accepts only
the canonical TaskFlow Runtime Read Model bound to a durable `intent_id`, the
same native Issue ID and Workspace, and a registered Executor. The Pages client
has no safe bulk AI filter today. Therefore the AI Tasks route is deliberately
blocked and renders no issue cards or custom columns. The isolated contract
tests do not establish live API or Provider evidence.

## 一致性驗收前置條件

CO-01 必須提供：

1. 每個 Executor 的唯一 Native Project ID、Workspace scope、ACL decision 與有效時間。
2. 原生 Project read route、Issue list/detail route，以及 Project status movement mutation contract。
3. 改派的原生 Issue mutation、history／audit readback 與 idempotency／fencing 規則。
4. 隔離 Preview origin、測試 Workspace 與不會自動導向 Production 的登入設定。

收到上述契約後，Browser Journey 才能驗證「同一 Issue、同一 Status、同一 History」的真實 mutation；在此之前，任何 drag、status update 或 reassignment 按鈕都必須保持 BLOCKED。

## Evidence boundary

CI Fixture 可驗證 DOM、route guards、五入口、空 mapping、401／403、Desktop／Portrait／Landscape 版面。它不能證明正式 OAuth、Workspace ACL、Native Project existence、Project mutation 或 PM 真實裝置 UAT。
