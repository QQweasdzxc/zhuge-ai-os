# Knowledge Write 與 Principle Reconciliation（Read-only Proposal）

日期：2026-08-10（Asia/Taipei）

本文件是 TASK-014／024 Shared Shell 回歸期間的治理盤點，不執行 Knowledge 寫入、Schema 變更或 RLS 變更。

## 1. 正式承載與目前能力

- 正式 Engineering Knowledge：`public.engineering_knowledge`
- 目前 Board 使用 Shared Gateway 讀取 `status = approved` 的原則。
- 現有 RLS：authenticated Engineering Member 可讀；`owner`／`editor` 可寫。
- 已盤點的 public function 中，沒有受控 Knowledge Write RPC。
- 已盤點的 Edge Function／Tool Path 中，沒有可重用的 Knowledge Write 入口。
- 因此目前的 owner/editor 寫入政策只是資料庫權限，不等同於受控的三方 Knowledge Governance 流程。

結論：目前不能安全地把 AI Engineering Credential Infrastructure Principle 直接寫入 Cloud；不得使用 Direct DML，也不建立第二套 Knowledge Architecture。

## 2. 最小受控寫入方案（待決策）

沿用既有 Engineering Activity Audit 與 Shared Actor Boundary，新增一個受控寫入入口（RPC 或既有受保護 Runtime 的同等 Tool Path）：

1. Co／GPT 只能提交提案與修訂建議。
2. QJC authenticated owner 才能核准、發布或 supersede 正式 Principle。
3. 寫入必須同時留下 `engineering_activity_log`，包含 actor type、actor label、before／after、reason。
4. 更新採 append-only／versioned；不得無痕刪除既有 Principle。
5. Browser 不接觸 Service Role；不改變既有 `engineering_knowledge` RLS 邊界。

在受控入口核准前，本文件只作為 Proposal，不代表已完成 Cloud 寫入。

## 3. Principle Reconciliation

| 來源／規則 | 現況 | 分類 | 建議 |
| --- | --- | --- | --- |
| AI Engineering Credential Infrastructure Principle | 尚未存在於 `engineering_knowledge`；語意已由 Protected Actor Broker、EP-030、EP-037 部分承接 | Revise | 不新增重複 Principle；待受控 Knowledge Write 入口核准後，修訂 EP-037 或既有 Shared Identity／Handoff Principle，補上 AI Actor Credential Infrastructure 邊界。 |
| DR-019 Security Rule | 目前 Cloud 沒有 `DR-019` record，亦沒有可核對的正式內容 | Keep | 保留名稱作為待對照來源；在取得正式內容前不新增或猜測替代規則。既有安全邊界仍依已核准的 Shared Identity、RLS、Actor Broker 規則執行。 |
| DR-020 Release Package Rule | 目前 Cloud 沒有 `DR-020` record；Build／Artifact 規則已完整存在於 EP-034、EP-035 | Supersede | 以 EP-034（Build Identity）與 EP-035（Artifact Provenance）作為目前正式規範；不另建 DR-020 duplicate。 |

## 4. Scope 與風險

- 本提案不改變 Board Workflow、Controlled Transition、Auth、RLS、OAuth 或 WorkLog Business Logic。
- 主要風險是沒有受控 Knowledge Write 入口時，任何直接寫入都會繞過 QJC 最終核准與 Audit；因此目前保持 read-only。
- 若未來批准受控入口，必須先完成 Security／Audit 測試，再由 QJC 發布 Principle；Co／GPT 不得自行把提案標成 approved。

