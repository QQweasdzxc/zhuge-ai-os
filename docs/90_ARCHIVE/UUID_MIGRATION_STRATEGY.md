# Investment Gate 2 — UUID Migration Strategy

Document Version: 1.0
Decision Status: Proposed for PM Review
Execution Status: Not Authorized
Database Mutation: Not Authorized

## 1. Objective

將 Investment 資料 ownership 從 Legacy Workspace identity：

```text
Investment.user_id → app_users.id
```

安全地轉換為 Zhuge AI OS canonical identity：

```text
Investment.user_id → auth.users.id = auth.uid()
```

本文件只定義 mapping、migration choice、validation 與 blocking rules，不執行 SQL，不修改 Production Schema。

## 2. Current Identity Model

### 2.1 Catalog evidence

```text
auth.users.id
    ↓ logical mapping only; no FK
app_users.auth_user_id
    ↓ belongs to
app_users.id
    ↓ legacy Investment owner FK
portfolios / opening_positions / transactions / watchlists
strategies / decision_logs / user_settings / onboarding_state
```

目前 evidence：

| Object | Rows | Legacy owner resolved to `app_users.id` | Direct owner equals Auth UUID |
| --- | ---: | ---: | ---: |
| `app_users` | 1 | 1 linked `auth_user_id` | 0 |
| `portfolios` | 1 | 1 | 0 |
| `opening_positions` | 8 | 8 | 0 |
| `transactions` | 3 | 3 | 0 |
| `watchlists` | 0 | 0 | 0 |

這證明結構可建立 mapping，但不能證明 `app_users.auth_user_id` 的實際人員歸屬一定正確。

### 2.2 Identity fields

| Field | Current meaning | Target meaning |
| --- | --- | --- |
| `app_users.id` | Legacy Workspace owner UUID | Legacy mapping key only；不得作為新 Domain owner |
| `app_users.auth_user_id` | Claimed Google/Supabase user；UNIQUE nullable，無 Auth FK | Verified bridge to `auth.users.id`；保留期間由 Migration 決定 |
| `auth.users.id` | Supabase canonical identity | 所有 Investment owner 的唯一來源 |
| Investment `user_id` | FK to `app_users.id` | FK to `auth.users.id` and equals `auth.uid()` |
| `user_code` | Legacy human/workspace code，例如 `001` | Audit/reference only；禁止作為 authorization key |

## 3. Mapping Classification

每個 `app_users` row 必須先分類，不得以「目前只有一個使用者」跳過分類。

### A. Safe Auto-Mapping

同時符合：

- `app_users.auth_user_id` non-null。
- 該 UUID 存在於 `auth.users.id`。
- 一個 `app_users.id` 只對應一個 Auth UUID。
- 一個 Auth UUID 只對應一個 `app_users.id`。
- 所有 Investment child rows 的 legacy owner 都可找到該 `app_users.id`。
- PM/Owner 已完成 identity attestation，確認 legacy workspace 的實際所有者。
- 不存在跨 owner portfolio reference 或 duplicate natural key。

處理：可由核准的 repeatable migration 自動 backfill。

### B. Manual Review Required

任一情況：

- Mapping 結構唯一，但缺少 PM/Owner identity attestation。
- Email、display name、legacy user code 與 Auth identity 出現不一致。
- Legacy Workspace 曾由多人或共用帳號使用。
- 資料 ownership 可推測但沒有足夠 audit evidence。

處理：產生 Review Item；由 PM 明確指定 target Auth UUID 後才能進入 A。

### C. Orphan Data

任一情況：

- Investment row 的 `user_id` 找不到 `app_users.id`。
- `app_users.auth_user_id` 找不到 `auth.users.id`。
- Child row 的 `portfolio_id` 找不到 portfolio。

處理：阻擋該 owner 的 migration。禁止自動指派給目前登入者。

### D. Duplicate Mapping

任一情況：

- 多個 `app_users.id` 對應同一個 Auth UUID。
- 一個 legacy workspace 被多個 Auth identity claim。
- 同一筆 domain record 在不同 legacy owner 下具有相同 business key 且疑似複製。

處理：阻擋 migration；需建立 merge／ownership correction decision。不得使用 `LIMIT 1` 隱藏衝突。

### E. Invalid / Blocked

任一情況：

- `auth_user_id` null 且無法確認 owner。
- UUID 格式或 FK chain 無效。
- Ownership 有爭議。
- Financial health check 不平衡。
- Backup、row count、aggregate evidence 不完整。

處理：整批或該 owner migration 停止，保留 legacy read-only evidence。

## 4. Current Mapping Assessment

目前 Production catalog 顯示：

- Structure：一個 `app_users`、一個 non-null `auth_user_id`，沒有 structural duplicate。
- Domain：1 portfolio、8 opening positions、3 transactions 全部能解析到同一個 legacy owner。
- Direct Auth ownership：0 row；所有 row 都需要 migration。
- Semantic ownership：Database 無法證明 legacy workspace 的實際人員就是目前 Auth identity。

Sanitized mapping evidence（2026-08-01）：

| Legacy owner key | Auth owner key | Legacy code | Auth exists | Portfolio | Position | Transaction | Settings | Onboarding |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `bd5dce53dfbe` | `f713fe0b3927` | `001` | true | 1 | 8 | 3 | 1 | 1 |

Watchlist、Strategy、Decision Log 目前皆為 0 rows。Fingerprint 只供 evidence 對照，不得作為 authorization key。

Current structural blocker counts：

```text
NULL auth mapping: 0
Orphan auth mapping: 0
Duplicate auth mapping groups: 0
Legacy owner orphan rows: 0
Cross-owner portfolio links: 0
```

因此目前分類為：

```text
Structural result: A candidate
Authorization result: B — Manual Review Required
```

PM 完成 identity attestation 後，可將此 mapping 提升為 A；未確認前不得自動轉換。

## 5. Migration Options

### Option A — In-place replacement

直接把每張 Table 的現有 `user_id` 從 `app_users.id` 更新為 `auth.users.id`，再替換 FK 與 RLS。

| Dimension | Assessment |
| --- | --- |
| Risk | High；identity、FK、View、RPC、RLS 同時切換 |
| Rollback | Difficult；舊 owner 值被覆蓋，必須依外部 snapshot 還原 |
| Downtime | 需要完整 write freeze；cutover window 較短但風險集中 |
| FK impact | 所有 Investment FK 同時 drop/recreate |
| View/RPC impact | 同一 release 必須同步修改 |
| Runtime compatibility | 舊 Runtime 立即失效 |
| Validation | 只能依 before snapshot 比較；無法 row-by-row 雙欄核對 |

優點：最終 Schema 簡單、步驟少。

缺點：對 Financial Data 與 Production rollback 不足，任何 mapping 錯誤都直接覆蓋 owner。

### Option B — Dual-column validation and staged cutover

先保留 legacy `user_id`，新增 temporary canonical owner column（設計名稱 `auth_user_id`），完成 backfill、constraint、financial validation 與新 Runtime shadow test 後才切換。

| Dimension | Assessment |
| --- | --- |
| Risk | Lower；mapping 與 cutover 分離，可逐 owner 驗證 |
| Rollback | Strong；legacy owner 保留至 stabilization 完成 |
| Downtime | Schema preparation 可 online；final cutover 仍需短暫 write freeze |
| FK impact | 可先新增 Auth FK，再於 final transaction 切換 |
| View/RPC impact | 可建立 shadow/new contract 後逐一驗證 |
| Runtime compatibility | 舊 Runtime 可在 validation phase 繼續讀 legacy owner |
| Validation | 可 row-by-row 比對 legacy owner 與 canonical Auth UUID |

缺點：過渡期有兩個 owner 欄位，必須嚴格禁止長期雙軌與不一致寫入。

## 6. Recommendation

推薦 **Option B — Dual-column validation**。

原因：

1. Investment 是 Financial Data，ownership 錯置比短期 Schema 複雜更嚴重。
2. 現有 Auth link 沒有 FK，必須先驗證再信任。
3. Option B 可提供 row-level mapping evidence 與可回滾窗口。
4. View、RPC、RLS 可以在不覆蓋 legacy owner 的情況下完成 isolation test。
5. 最終仍會收斂為一個 `user_id = auth.uid()`，不允許永久雙欄。

## 7. Option B Target Sequence（Design Only）

### Stage B0 — Freeze baseline

- 記錄 migration ID、Git SHA、schema fingerprint、row count、financial aggregates。
- PM 驗證 legacy owner 與 Auth identity。
- 未通過者保持 B/C/D/E，不進入 backfill。

### Stage B1 — Add validation column

每張 Investment Table 暫時新增 nullable `auth_user_id uuid`，並設計 FK：

```text
auth_user_id → auth.users.id
```

Legacy `user_id` 與舊 Runtime 保持不變。

### Stage B2 — Backfill and compare

依下列 mapping backfill：

```text
domain.user_id
    → app_users.id
    → app_users.auth_user_id
    → domain.auth_user_id
```

每張 Table 必須驗證：total、mapped、null、orphan、duplicate、financial aggregate。

### Stage B3 — Shadow authorization

- 新 RLS/View/RPC 在 staging/shadow contract 使用 `auth_user_id`。
- 兩個不同 Auth UUID 進行 positive/negative isolation test。
- 舊 Runtime 尚未切換 Production owner field。

### Stage B4 — Runtime cutover

- Write freeze。
- Runtime Repository 切換到 canonical column。
- 所有新 row 在 stabilization period 同時保留可驗證的 legacy mapping；禁止兩套 UI 或兩套 business flow。
- 監控 row ownership、403/42501、RLS rejection 與 aggregate drift。

### Stage B5 — Final owner swap

在同一 transaction boundary 內設計：

```text
legacy user_id → legacy_user_id
auth_user_id   → user_id
user_id        → NOT NULL + FK auth.users(id)
```

更新 View、RPC、Index、RLS contract。`legacy_user_id` 在 rollback retention window 內不可被 client expose。

### Stage B6 — Legacy removal

PM Sign-off、stabilization 與 rollback window 結束後：

- 移除 legacy identity RPC。
- 移除 client grants to legacy bridge。
- 移除或封存 `legacy_user_id`。
- `user_code` 僅保留 audit display，不參與 authorization。

## 8. Ownership Chain Rules

| Table | Direct owner | Secondary ownership validation |
| --- | --- | --- |
| `portfolios` | `user_id = auth.uid()` | none |
| `opening_positions` | `user_id = auth.uid()` | referenced portfolio must have same `user_id` |
| `transactions` | `user_id = auth.uid()` | referenced portfolio must have same `user_id` |
| `watchlists` | `user_id = auth.uid()` | nullable portfolio, when present must have same `user_id` |
| `strategies` | `user_id = auth.uid()` | nullable portfolio, when present must have same `user_id` |
| `decision_logs` | `user_id = auth.uid()` | nullable portfolio, when present must have same `user_id` |
| `user_settings` | `user_id = auth.uid()` | setting key unique per canonical user |
| `onboarding_state` | `user_id = auth.uid()` | one row per canonical user |

Cross-owner portfolio linkage 必須由 composite ownership validation 阻擋，不能只依 `portfolio_id` 存在。

## 9. Repeatable Mapping Discovery SQL（Read-only）

以下只作為 Runbook preflight 設計；本 Gate 不執行。

```sql
with mapping as (
  select
    au.id as legacy_user_id,
    au.user_code,
    au.auth_user_id,
    (u.id is not null) as auth_user_exists,
    count(*) over (partition by au.auth_user_id) as app_users_per_auth
  from public.app_users au
  left join auth.users u on u.id = au.auth_user_id
)
select
  legacy_user_id,
  user_code,
  auth_user_id,
  case
    when auth_user_id is null then 'E_INVALID_BLOCKED'
    when not auth_user_exists then 'C_ORPHAN_AUTH'
    when app_users_per_auth > 1 then 'D_DUPLICATE_MAPPING'
    else 'A_CANDIDATE_REQUIRES_ATTESTATION'
  end as mapping_class
from mapping
order by mapping_class, user_code;
```

禁止在 Evidence 中輸出不必要的 Email、Token 或 financial row detail。

## 10. Blocking Conditions

任一項成立即停止：

- Mapping class B/C/D/E 尚未清零或取得明確 PM override。
- `app_users.auth_user_id` 不存在於 `auth.users.id`。
- 任一 Investment row 找不到 legacy owner。
- 同一 Auth UUID 對應多個 legacy owner。
- Cross-owner portfolio reference。
- Before snapshot 或 backup 不完整。
- Row count、financial aggregate、currency/market aggregate 無法一致。
- View/RPC/RLS isolation test 未通過。

## 11. PM Decision Points

1. 核准 Option B 作為正式 Migration Strategy。
2. 確認目前唯一 legacy workspace 與 Auth identity 的實際 ownership，將 B 提升為 A。
3. 核准 `app_users` 在 cutover 後的定位：保留為 profile/legacy bridge，或未來整併到 Shared profile model。
4. 核准 dual-column stabilization period 與 legacy retention period。
5. 核准 cross-owner composite constraint design。
