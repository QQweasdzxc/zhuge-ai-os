# Native Project／Task UI Reuse Matrix

**目前權威狀態：** [全站收編總帳](./REVIEW.md)
**Source scope：** PR #126 `.9.159`（Draft）；main .9.120 不變。
**本文件：** 原生重用契約說明，不是第二套 TaskFlow 資料或 ACL authority。

## Capability Matrix

| PM 要求 | 既有 TaskFlow Source／route | PR #126 行為 | Readiness |
| --- | --- | --- | --- |
| TaskFlow 原生 Projects | `third_party/multica/apps/web/app/[workspaceSlug]/(dashboard)/projects/` | AI 派工中心只有取得可信 Native Project UUID／Workspace／ACL mapping 才導向原生 route | 原生 UI `ALREADY_IN_MAIN`；Executor mapping `BLOCKED_MISSING_NATIVE_INTERFACE` |
| 原生 Project Board／Issue Detail | 原生 Project route、`/api/issues/{id}`、原生 Issue detail | 沿用原生 route 與 Issue ID；不重建 Kanban／Detail | Source exists；Review contract/Browser CI PASS；真實登入未驗證 |
| Status movement／drag／移交 | Project status movement mutation contract 尚未在可追蹤的 TaskFlow Server Source 找到 | 不提供前端假更新；沒有明確受權 mutation／transfer contract 時不顯示成功 | `BLOCKED_MISSING_NATIVE_INTERFACE` |
| 五位 Executor → Project | `labs/taskflow/pages-client/native-project-mapping-contract.mjs` | 只接受 server-owned、唯一 UUID、同 Workspace、後端 ACL 驗證的 mapping envelope；缺少時顯示 GAP | 合約與負測試存在；API 尚未提供 envelope；五位皆 GAP |
| AI-managed Issue | Protected Dispatch Runtime Read Model + 原生 Issue ID | 不看 title、assignee、GitHub comment 或可修改 metadata；依可信 authority、Workspace 及 Issue identity | 隔離投影合約／測試通過；Bulk server read model 尚未接線 |
| AI Tasks 原生 View | 對照原生 `issues`／`my-issues` source route | TaskFlow Server has no safe bulk AI filter today；現有 route 是一般／個人 Issue 清單，不可冒充 AI 專用篩選；不載入未過濾的人類 Issue；PR #126 已移除自製六欄 Kanban，顯示明確 BLOCKED | 原生 Tasks route／AI filter 未在追蹤的 TaskFlow Web Source 中找到 |
| AI Project／Tasks 同卡一致性 | 原生 Issue ID、Workspace、Status、History | 不複製 Issue；不提供未接通的狀態移動／改派；一般人類 Issues 排除 | Contract tests PASS；無真實 Runtime Mutation 證據 |
| Workspace／ACL | TaskFlow native Auth、Workspace membership 與 Issue access | 前端 mapping 只做顯示契約，不能授權；API 401／403／錯誤不當作空資料 | Source fail-closed；Production approved-account readback 未驗證 |

## 五 Executor 狀態

| Executor | Native Project UUID | Workspace／ACL authority | 狀態 |
| --- | --- | --- | --- |
| CO-01 | 未核實 | 未取得 server-owned mapping | GAP |
| CO-02 | 未核實 | 未取得 server-owned mapping | GAP |
| CO-03 | 未核實 | 未取得 server-owned mapping | GAP |
| GEM-01 | 未核實 | 未取得 server-owned mapping | GAP |
| GH-HELPER | 未核實 | 未取得 server-owned mapping | GAP |

不能依名稱／slug／lead 推測 Project；不能分配未歸屬專案；不能以不同 Executor 共用 Project。未取得正式 API 證據前，以上 ID 均刻意留空。

## Remaining Interface Gap

1. 後端提供受 TaskFlow Auth 保護的 Executor Registry mapping read API，含唯一 Native Project UUID、Workspace UUID、membership／Project ACL decision、版本與有效時間。
2. 原生 Project mutation API 契約：Status、drag/drop、Transfer/Reassign、idempotency、history/audit 與 Workspace ACL；目前不假造接口。
3. 原生 Tasks View 的可信 AI scope filter，且與 Project Issue list 共用同一原生 Issue ID／Status／History。
4. Reporting Native Atomic Write／Protected Detail Store 由服務端 persistence transaction 承接；現有文件／reference adapter 仍 fail-closed。

**改派與歷史：** 仍需 TaskFlow Native Issue mutation 的權威契約與可讀回的 Activity／Audit history；完成契約前不展示改派成功。這也是 Project status movement mutation contract 的同一個 Server-side gap。

以上是已存在原生能力與缺少接口的界線；本輪不新增 Project、不修改 DB／ACL、不建立第二 Kanban，也不建立 Preview。
