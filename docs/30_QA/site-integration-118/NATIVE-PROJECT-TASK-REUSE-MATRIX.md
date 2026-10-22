# Native AI Project／Task UI reuse matrix

基準：PR #122，CO-03 review branch。這份矩陣區分已接通的原生 readback 與尚待 CO-01 提供的正式契約；沒有把本地 Fixture 當成 Product Acceptance。

| PM 要求 | 目前來源 | CO-03 行為 | 狀態 |
| --- | --- | --- | --- |
| 五位 Executor 入口 | Pages client registry | 固定列出五位，入口只接受 Backend mapping | SOURCE PASS |
| Executor → Native Project ID | CO-01 Backend 尚未提供 | 僅接受唯一 `project.id`、`executor_id`、Workspace、ACL flags；缺少即 GAP | BLOCKED |
| Native Project route | TaskFlow 原生 route contract | mapping 完整時導向 `/{workspace}/projects/{projectId}` | CONTRACT READY |
| 原生六欄 Project Kanban | TaskFlow web application | 不在 Pages client 重做；等待 Native Project route／權限 | BLOCKED |
| 原生卡片／Detail | `/api/issues/{id}` readback | 使用原生 Issue ID 與既有 detail route | SOURCE PASS |
| Status movement／drag | 原生 Project mutation API 未提供 | 不提供前端假更新，顯示 BLOCKED | BLOCKED |
| AI Task overview | `/api/issues` + dispatch evidence | 只投影有派工證據的 Issue，支援 Executor filter | ISOLATED READBACK |
| 雙入口同一 Issue | native Issue ID | 兩入口只引用 Issue ID，不複製卡片 | SOURCE PASS |
| 改派與歷史 | CO-01 mutation／audit contract 未提供 | 不提供假改派；等待原生 mutation | BLOCKED |
| Workspace／ACL／401／403 | existing authenticated transport | API／權限錯誤 fail-closed | CI PASS |

## 一致性驗收前置條件

CO-01 必須提供：

1. 每個 Executor 的唯一 Native Project ID、Workspace scope、ACL decision 與有效時間。
2. 原生 Project read route、Issue list/detail route，以及 Project status movement mutation contract。
3. 改派的原生 Issue mutation、history／audit readback 與 idempotency／fencing 規則。
4. 隔離 Preview origin、測試 Workspace 與不會自動導向 Production 的登入設定。

收到上述契約後，Browser Journey 才能驗證「同一 Issue、同一 Status、同一 History」的真實 mutation；在此之前，任何 drag、status update 或 reassignment 按鈕都必須保持 BLOCKED。

## Evidence boundary

CI Fixture 可驗證 DOM、route guards、五入口、空 mapping、401／403、Desktop／Portrait／Landscape 版面。它不能證明正式 OAuth、Workspace ACL、Native Project existence、Project mutation 或 PM 真實裝置 UAT。
