# 🏠 Zhuge AI OS 打掃家園工作原則 v1.0

Status: Mandatory Cleanup Governance Principle
Decision Authority: PM
Applies To: Zhuge AI OS 全站 Code Cleanup / Legacy Retirement / Runtime Boundary

本文件定義 Zhuge AI OS「打掃家園」工作的正式治理邊界。核心目的不是看到
Legacy Data 就啟動 Migration，而是先以證據整理 Code、Runtime、Legacy、
Duplicate、Dependency 與不必要的歷史路徑，再由 PM 決定是否值得處理。

## 核心原則

> 先看清楚全站，再決定要不要動。

Audit 與 Cleanup 完全分開：Audit 階段只允許事實確認、追蹤、分類、風險評估
與建議；未經 PM 明確核准，不得修改任何正式程式、資料或運行環境。

## 七大工作原則

### 1. 先查事實，不先設計解法

發現 Finding 後，第一步確認目前 Source、Runtime 與 Data 的真實狀況。在
事實尚未確認前，不先提出 Migration、V2、Fallback、Compatibility Layer、
新 Schema、新 RPC 或大型 Remediation。

### 2. 無法判斷資料去留、功能取捨或歷史價值時，直接問 PM

工程負責確認技術事實；「要不要留、還要不要用、是否值得帶進 Canonical」
屬於 PM 的產品決策。

若技術證據無法判斷，必須停止於：

```text
STOP — ASK PM
```

不得自行把未知判成 Dead、Legacy Still Required 或 Migration Required。

### 3. PM 一句話能決策的，不用 RCA／Migration Design 繞過去

如果問題本質是「要／不要」、「留／不留」或「現在還需不需要」，先把問題
翻成 PM 可直接回答的選擇，不以工程複雜度取代產品決策。

### 4. 已經在 Canonical 的資料，不再研究如何 Migration

先確認 Canonical 是否已存在。若資料已完整存在：

```text
Migration Required = NO
```

不得重新搬移、建立第二份資料或設計額外 Migration。

### 5. PM 不需要延續的歷史，不為它增加 Compatibility Layer

Legacy Data 可以保留作為歷史，但：

```text
Legacy Data Exists ≠ Legacy Runtime Must Remain
```

PM 判定不需延續的歷史，不得單獨作為阻止 Code Cleanup 的理由，也不得為其
新增 fallback、adapter、parallel path、dual-write 或其他 compatibility
mechanism。

### 6. 只有確認現在仍需要的東西，才值得花工程成本處理

只有完成以下三項確認後，才可進入 Coding、Migration、Remediation 或
Architecture Design：

```text
Fact Check
+
Canonical Check
+
PM Value Decision
```

### 7. 治理守的是目的，不僵化歷史手段；治理必須與 Canonical Architecture 共同演進

歷史 Governance、ADR、Test Contract、Compatibility Rule 或 Engineering
Principle 被 Cleanup Finding 觸及時，必須先區分治理目的與歷史實作手段：

```text
Governance Intent
當初真正要保護什麼？

Historical Mechanism
當初用什麼技術手段達成？
```

若治理目的目前仍有效，但歷史手段已不符合現行 Canonical Architecture：

```text
KEEP INTENT → RETIRE OBSOLETE MECHANISM → EVOLVE GOVERNANCE
```

不得因歷史 Test 還在驗證舊規則，就永久保留過時架構；不得為遵守過時
Governance 而新增 Compatibility Layer；也不得因移除舊 Implementation，就
順手刪除仍有效的治理目的。歷史曾經需要，不等於現在仍然需要。

當治理目的現在是否仍需要無法由技術事實判斷時，必須：

```text
STOP — ASK PM
```

不得由工程自行決定保留或廢除。

#### 治理與架構共同演進決策流程

```text
舊規則存在
  ↓
它真正保護的目的？
  ↓
目的現在仍需要嗎？
  │
  ├─ UNKNOWN → STOP — ASK PM
  ├─ NO → 退休規則
  └─ YES
       ↓
現有手段仍合適嗎？
       │
       ├─ YES → KEEP
       └─ NO → 保留目的、更新手段、融合至目前 Canonical Architecture
```

## Audit／Cleanup 分界

### Audit 階段

Audit 是 Read-only。允許：

- 掃描 Source、Route、Runtime Entry、Dependency、Data Contract、RPC、Test
  與 Documentation。
- 追蹤實際 Runtime Reachability、Caller／Callee 與 Compatibility dependency。
- 分類 Finding、提供 Evidence、Risk、Confidence 與 Recommendation。
- 提出 Cleanup Proposal，但不執行 Proposal。

Audit 階段禁止：

- 修改、刪除、Rename、Move、Refactor 或自動修復 Source。
- 修改 Cloud、Data、Schema、RPC、RLS、Storage、Auth、Realtime 或 Route。
- 建立 Migration、V2、Fallback、Compatibility Layer 或平行實作。
- Commit、Push、修改 `main`、Deployment 或建立 Product Candidate。

### Cleanup 階段

Cleanup 只能在 Audit 完成、事實已確認且 PM 明確核准範圍後進行。每一批
Cleanup 必須明確記錄：

- 修改範圍與不處理範圍。
- 受影響的 Runtime、Consumer、Data 與 Cloud surface。
- Targeted／Full Regression。
- Rollback boundary。
- 需要的 PM approval gate。

不得因一個 Finding 的處理過程發現旁支問題，就自動展開 Cascade Cleanup；
旁支問題必須另列為 `FOLLOW-UP FINDING`。

## Cleanup Decision Flow

```text
Finding
  ↓
FACT CHECK
現在真正的狀況是什麼？
  ↓
CANONICAL CHECK
新家已經有了嗎？
  │
  ├─ YES → 不做 Migration
  │
  └─ NO
       ↓
PM VALUE CHECK
這東西現在還需要嗎？
       │
       ├─ UNKNOWN → STOP — ASK PM
       ├─ PM：NO → 不為歷史增加工程成本
       └─ PM：YES
              ↓
MINIMUM SOLUTION
              ↓
PM REVIEW
              ↓
才可 Coding / Migration / Cleanup
```

## PM Question Rule

工程遇到無法判斷的產品取捨時，不得只回報：

```text
UNKNOWN
BLOCKED
Migration Required
Legacy Still Required
```

必須轉成 PM 可以直接決定的問題：

```text
現在是什麼？
新家有沒有？
如果不保留會少什麼？
PM 要不要？
```

如果 PM 可以直接回答，停止繼續技術發散，等待 PM Decision。

## 適用範圍

本原則適用於：

- Code Cleanup
- Legacy Retirement
- Dead／Duplicate Code
- Runtime／Route Cleanup
- Dependency Cleanup
- Compatibility Cleanup
- Documentation／Test Drift Cleanup
- Cleanup 過程中遇到的 Historical Data

本原則不是一般 Feature Development 規格，也不得藉此修改既有 Architecture、
Release 或 Security Governance。

## 治理結論

```text
Audit ≠ Cleanup
Finding ≠ Authorization to Change
Legacy Data ≠ Legacy Runtime
Canonical Exists → Migration Required = NO
Unknown Product Value → STOP — ASK PM
```

任何未經 PM 核准的 Cleanup 均不得執行。

## Approved Architecture Decision Record — Post-QA Cleanup Audit

本節記錄 PM 對目前 Cleanup Audit 結果的正式決策。此決策記錄不授權修改
Frozen Runtime Candidate，也不授權重新開啟已結案 Finding。

### Frozen Baseline

```text
Version: 0.9.0-alpha.9.13
Build: 20260829-1024
Runtime QA: DEFERRED — PM MANUAL QA
Candidate Packaging: NOT AUTHORIZED
```

### Approved Cleanup Decisions

- C Local Store：`KEEP / TEST-ONLY LEGACY FIXTURE`。它不是正式 Runtime 或
  Source of Truth；正式 C Runtime 不得依賴它。
- WorkLog Legacy Runtime：`KEEP / HOLD`。目前尚未證明可以安全退休；後續如
  需處理，必須另案執行 Retirement Audit。Legacy historical data 不因本決策
  被刪除或搬移。
- Prototype／Alias historical references：`HOLD`。歷史引用不等於現行 Runtime
  consumer，也不因本決策建立新的 Compatibility Layer。
- Golden Master Consumer-specific coupling：`KEEP`。目前沒有 defect evidence，
  不因整理目的進行重構。
- AI Board「工程準則／系統藍圖」：`KEEP`。這是 AI Board 的 Domain 功能，與
  Shared Board Template 分離，不視為第二套 Board Template。
- Dashboard 過期文案：列為 `POST-QA SMALL CLEANUP`。在 PM Manual Runtime QA
  完成前不修改 Frozen Candidate。
- Template Publish 與 Formal Product Release：視為不同責任層，不得再次混用。
  Module Publish／Consumer Adoption 不等同於 Product Candidate ZIP／Manifest
  Delivery。

### Source-of-Truth Boundary

| Surface | Canonical source |
| --- | --- |
| Board UI Template | Shared Golden Master／Published C |
| Runtime Published State | Cloud |
| Consumer Data | 各 Consumer 的 Adapter／Domain Data |
| `template-release.js` | Generated Release Identity Snapshot |
| Git | Source Code Source of Truth |
| ZIP／Manifest | Delivery Artifact |

本邊界表示各層責任不同，不表示可以建立平行 Runtime、平行 Publish Architecture
或第二套 Consumer Template。任何後續調整仍須依本文件的 Fact Check、Canonical
Check 與 PM Value Decision 流程進行。
