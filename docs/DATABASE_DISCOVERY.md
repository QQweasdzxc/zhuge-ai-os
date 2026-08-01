# Investment Gate 1 — Database Discovery

Document Version: 1.0
Discovery Date: 2026-08-01（Asia/Taipei）
Status: Approved — Gate 1 PASS
Coding Status: Not Authorized
Database Mutation: None（read-only catalog only）
PM Decision Date: 2026-08-01

## 1. Scope and Source

本文件是 Investment Integration 的 Gate 1 Database Catalog。盤點來源為目前連線的正式 Supabase Project：

| Item | Value |
| --- | --- |
| Project | QQ's Project |
| Project Ref | `lenpbbhwxyyfwgvjcozf` |
| Region | `ap-northeast-2` |
| Status | `ACTIVE_HEALTHY` |
| PostgreSQL | `17.6.1.127`（engine 17） |
| Public objects | 33 tables + 3 views |
| Relevant migration ledger | 7 Investment/Identity migrations；全專案共 16 migrations |

本次只執行 system catalog 與 aggregate read query，未讀出帳務明細、Email、Token、UUID 值或投資金額，亦未執行 DDL/DML。

## 2. Executive Findings

Gate 1 發現 5 個進入 Investment Coding 前必須解決的 P0/P1 問題：

1. **Legacy Identity 已確認。** 所有 Investment `user_id` 外鍵目前指向 `public.app_users.id`，不是 `auth.users.id`。
2. **Investment RLS 目前不是 UUID isolation。** 7 張主要 Table 使用 `roles=public`、`USING (true)` 與 `WITH CHECK (true)` 的 Phase 1 Policy。
3. **三個 Investment View 是 Security Definer。** Supabase Security Advisor 全部標記為 Error；View 可能以 owner 權限執行而繞過底層 RLS。
4. **Legacy Identity RPC 暴露過寬。** 3 個 `SECURITY DEFINER` RPC 同時授權 `anon` 與 `authenticated` EXECUTE，Advisor 均提出警告。
5. **Investment Realtime 尚未啟用。** Realtime publication 中沒有任何 Investment Table。

因此目前 Database 狀態可供 Discovery 與 Migration Design 使用，但**不可直接作為 Zhuge AI OS Investment Production boundary**。

## 3. Identity and UUID Audit

### 3.1 Canonical relationship today

```text
auth.users.id
    ↓ app_users.auth_user_id (UNIQUE, nullable; logical link, no FK)
app_users.id
    ↓ Investment tables.user_id
```

Database aggregate evidence：

| Object | Total rows | Match `app_users.id` | Direct match `auth.users.id` |
| --- | ---: | ---: | ---: |
| `app_users` | 1 | 1 linked through `auth_user_id` | `id = auth_user_id`: 0 |
| `portfolios` | 1 | 1 | 0 |
| `opening_positions` | 8 | 8 | 0 |
| `transactions` | 3 | 3 | 0 |
| `watchlists` | 0 | 0 | 0 |

Conclusion：IIAR 的 UUID Warning 已被正式 Database Catalog 證實。不可將舊 `user_id` 直接解讀為 `auth.uid()`，也不可只改 RLS expression 而不做 identity/data migration。

`app_users.auth_user_id` 目前沒有 Foreign Key 指向 `auth.users.id`；
`identity_claim_logs.auth_user_id` 亦沒有 Auth FK。Identity mapping 目前由 RPC 與資料內容維持，而不是由 Database constraint 保證。

### 3.2 Required mapping contract（Design only）

Gate 2/3 前需核准：

```text
legacy app_users.id
    + app_users.auth_user_id
    ↓ verified one-to-one mapping
auth.users.id
    ↓ target owner UUID
Investment domain rows
```

Mapping 必須具備 pre-check、duplicate detection、row-count verification、rollback 與 audit evidence。此文件不建立或執行 Migration。

## 4. Table Catalog

所有下列 Table 目前 `RLS enabled = true`，但 Policy 品質不同。

### 4.1 `app_users`

Identity bridge。主要欄位：

```text
id uuid PK default gen_random_uuid()
auth_user_id uuid nullable UNIQUE
user_code text NOT NULL UNIQUE
display_name text NOT NULL
email text nullable
role text NOT NULL default owner
auth_provider text nullable
avatar_url text nullable
last_login_at timestamptz nullable
created_at / updated_at timestamptz
```

現有資料：1 row；`auth_user_id` 已連結，但 `id` 不等於 Auth UUID。

### 4.2 `portfolios`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
name text NOT NULL
base_currency text NOT NULL default TWD
is_default boolean NOT NULL default true
created_at / updated_at timestamptz
```

現有資料：1 row。

### 4.3 `opening_positions`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
portfolio_id uuid FK → portfolios.id ON DELETE CASCADE
bootstrap_at timestamptz NOT NULL
symbol / name / market text NOT NULL
asset_type text NOT NULL default stock
quantity / avg_cost / invested_cost numeric NOT NULL
last_price / market_value / unrealized_pnl / unrealized_pct numeric nullable
currency text NOT NULL
account / note text nullable
source text NOT NULL default broker_app_screenshot
created_at / updated_at timestamptz
```

Unique：`(user_id, portfolio_id, symbol, market, bootstrap_at)`。現有資料：8 rows。

### 4.4 `transactions`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
portfolio_id uuid FK → portfolios.id ON DELETE CASCADE
trade_date date NOT NULL
trade_type text NOT NULL
symbol text NOT NULL
name / account / source / evidence_url / note text nullable
market text default TW
quantity / price / gross_amount / fee / tax / net_amount numeric NOT NULL default 0
currency text NOT NULL default TWD
created_at / updated_at timestamptz
```

`trade_type` CHECK：期初庫存、買進、賣出、定期定額、現金股利、股票股利、費用、調整。現有資料：3 rows。

### 4.5 `watchlists`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
portfolio_id uuid FK → portfolios.id ON DELETE CASCADE
symbol text NOT NULL
name text nullable
market text default TW
status text NOT NULL default 研究中
research_theme / reason text nullable
importance integer NOT NULL default 3 CHECK 1..5
source text NOT NULL default manual
created_at / updated_at timestamptz
```

Unique：`(user_id, symbol, market)`。現有資料：0 rows。

### 4.6 `strategies`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
portfolio_id uuid FK → portfolios.id ON DELETE CASCADE
symbol text NOT NULL
name / strategy_type / decision_status / strategist_note text nullable
target_price / support_price / pressure_price numeric nullable
created_at / updated_at timestamptz
```

現有資料：0 rows。

### 4.7 `decision_logs`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
portfolio_id uuid FK → portfolios.id ON DELETE CASCADE
title text NOT NULL
advice / reason / rule_id text nullable
confidence integer nullable CHECK 0..100
evidence jsonb NOT NULL default []
payload jsonb NOT NULL default {}
created_at timestamptz
```

現有資料：0 rows。

### 4.8 `user_settings`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
setting_key text NOT NULL
setting_value jsonb NOT NULL default {}
created_at / updated_at timestamptz
```

Unique：`(user_id, setting_key)`。現有資料：1 row。RLS enabled，但沒有 Policy。

### 4.9 `onboarding_state`

```text
id uuid PK
user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
status text NOT NULL default pending
current_step text nullable
payload jsonb NOT NULL default {}
completed_at timestamptz nullable
created_at / updated_at timestamptz
```

Unique：`user_id`。現有資料：1 row。RLS enabled，但沒有 Policy。

### 4.10 `identity_claim_logs`

Legacy claim audit table：

```text
id uuid PK
workspace_user_id uuid NOT NULL FK → app_users.id ON DELETE CASCADE
auth_user_id uuid NOT NULL（no FK to auth.users）
user_code text NOT NULL
email text nullable
claim_status text NOT NULL default success
payload jsonb NOT NULL default {}
created_at timestamptz NOT NULL
```

現有資料：1 row。Indexes：PK、`workspace_user_id`、`auth_user_id`。
RLS enabled 但沒有 Policy；`anon`、`authenticated` 與 `service_role` 均有廣泛 table privileges。

## 5. View Catalog

| View | Source | User filter | Security result |
| --- | --- | --- | --- |
| `current_positions_view` | Latest row per `opening_positions` user/portfolio/symbol/market | View 本身沒有 `auth.uid()` filter | `SECURITY DEFINER` Advisor Error |
| `holdings_view` | Aggregate `transactions` into quantity/invested cost/avg cost | View 本身沒有 `auth.uid()` filter | `SECURITY DEFINER` Advisor Error |
| `my_workspace_view` | `app_users` + default `portfolios` | `app_users.auth_user_id = auth.uid()` | `SECURITY DEFINER` Advisor Error |

三個 View owner 均為 `postgres`，`reloptions = null`，沒有 `security_invoker=on`。`anon` 與 `authenticated` 也都有 View privileges。Supabase Advisor remediation：

- [Security Definer View](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)

Gate 1 Decision：未完成 security-invoker／grant／underlying RLS review 前，Module 不得直接查詢這三個 View。

## 6. Functions and RPC Catalog

Public schema 共 13 個 function；與 Investment Identity 直接相關的 RPC 有 3 個：

| RPC | Mode | Auth check in body | Current execute grant | Finding |
| --- | --- | --- | --- | --- |
| `claim_legacy_workspace(...)` | `SECURITY DEFINER` | `auth.uid()` non-null；依 `user_code` claim legacy row | `anon`, `authenticated` | anon/authenticated Advisor Warning；預設 legacy code 需移除或封存 |
| `get_my_workspace_summary()` | `SECURITY DEFINER` | `app_users.auth_user_id = auth.uid()` | `anon`, `authenticated` | anon/authenticated Advisor Warning |
| `link_workspace_identity(...)` | `SECURITY DEFINER` | `auth.uid()` non-null；依 `user_code` link | `anon`, `authenticated` | anon/authenticated Advisor Warning；不得作為新 Module 常態 login flow |

這些 Function 雖在 body 內檢查 Auth，但 Data API endpoint 的 EXECUTE surface 仍過寬，且 Security Definer 以 owner 權限執行。Supabase Advisor remediation：

- [Anon Security Definer Function Executable](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Authenticated Security Definer Function Executable](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

Gate 1 Decision：需逐一決定 Retire／Restrict／Rewrite；不得原樣搬入 Shared Gateway。

## 7. RLS and Grants

### 7.1 Current policy matrix

| Table | Policy state |
| --- | --- |
| `app_users` | `SELECT USING (true)` + `ALL USING (true) WITH CHECK (true)` to `public` |
| `portfolios` | 同上 |
| `opening_positions` | 同上 |
| `transactions` | 同上 |
| `watchlists` | 同上 |
| `strategies` | 同上 |
| `decision_logs` | 同上 |
| `user_settings` | RLS enabled；0 policies |
| `onboarding_state` | RLS enabled；0 policies |
| `identity_claim_logs` | RLS enabled；0 policies |

`public` policy role 會涵蓋所有 database roles。前 7 張 Table 的 Phase 1 policy 並未執行使用者隔離。

### 7.2 Grants

Catalog 顯示上述 10 張 Table 與 3 個 View 對 `anon`、`authenticated`、`service_role` 都有廣泛 privileges（包括 SELECT/INSERT/UPDATE/DELETE；catalog 亦列出 REFERENCES/TRIGGER/TRUNCATE）。RLS 仍是 row access 的最後一道防線，因此 `USING (true)` / `WITH CHECK (true)` 組合必須視為 P0。

Supabase Advisor remediation：

- [Permissive RLS Policy](https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy)
- [RLS Enabled With No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

Target policy 尚未執行，設計基準應為：

```sql
user_id = auth.uid()
```

但必須先完成 Legacy ID → Auth UUID migration；不可直接替換 expression，否則現有資料會全部不可見。

## 8. Index and Constraint Catalog

### 8.1 Existing indexes

| Table | Indexes |
| --- | --- |
| `app_users` | PK、`auth_user_id` unique/index、`user_code` unique/index |
| `portfolios` | PK only |
| `opening_positions` | PK、user+symbol、bootstrap_at、composite unique |
| `transactions` | PK、trade_date、user+symbol |
| `watchlists` | PK、user+symbol、user+symbol+market unique |
| `strategies` | PK、user+symbol |
| `decision_logs` | PK only |
| `user_settings` | PK、user+setting_key unique |
| `onboarding_state` | PK、user_id unique |

### 8.2 Missing covering indexes reported by Advisor

- `portfolios.user_id`
- `opening_positions.portfolio_id`
- `transactions.portfolio_id`
- `watchlists.portfolio_id`
- `strategies.portfolio_id`
- `decision_logs.user_id`
- `decision_logs.portfolio_id`

Remediation reference：[Unindexed Foreign Keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

本階段不新增或刪除 Index。Advisor 的 unused-index 訊息只代表目前統計期間未使用，不構成直接刪除依據。

## 9. Triggers, Realtime and Migrations

### 9.1 Triggers

10 張目標 Table 目前沒有 non-internal trigger。`updated_at` 欄位存在，但不能假設 Database 會自動更新；Repository／Migration design 需明確定義 owner。

### 9.2 Realtime

Investment Table 目前都不在 `supabase_realtime` publication。現有 publication 只有 WorkLog 相關 `user_tasks`、`work_entries`、`work_journal_entries`。

### 9.3 Relevant migration ledger

| Version | Migration |
| --- | --- |
| `20260630050232` | `v9_cloud_foundation_schema_v2` |
| `20260630071640` | `v9_1_opening_positions_bootstrap` |
| `20260630133910` | `v9_2_auth_identity_foundation` |
| `20260701050931` | `v10_legacy_google_identity_claim` |
| `20260701093857` | `v11_identity_fix_claim_legacy_workspace_v2` |
| `20260701094602` | `v11_identity_restore_rpc_parameter_names` |
| `20260702023000` | `create_worklog_core_tables`（Investment/WorkLog boundary reference） |

Migration history 已存在，但 Migration Source ZIP 內的 SQL 只有 Stub，不能視為可重建正式 Schema 的來源。

## 10. Gate 1 Risk Register

| ID | Severity | Finding | Gate |
| --- | --- | --- | --- |
| DB-INV-001 | P0 | Investment `user_id` 是 legacy `app_users.id` | UUID Migration Design + mapping verification |
| DB-INV-002 | P0 | 7 張主要 Table 對 public 使用 always-true read/write policy | RLS redesign + two-user isolation test |
| DB-INV-003 | P0 | 3 個 Security Definer View | security-invoker/grant review + View isolation test |
| DB-INV-004 | P0 | Identity Security Definer RPC 對 anon/authenticated executable | RPC retire/restrict/rewrite decision |
| DB-INV-005 | P1 | `user_settings`、`onboarding_state` 無 policy | 明確 owner policy 或移出 client surface |
| DB-INV-006 | P1 | Investment Realtime 未啟用 | Product requirement review；若啟用需先完成 RLS |
| DB-INV-007 | P2 | 7 個 FK 缺 covering index | Migration performance plan |
| DB-INV-008 | P2 | Target tables 無 updated_at trigger | 明確由 DB 或 Repository 負責，禁止雙重流程 |
| DB-INV-009 | P1 | `app_users.auth_user_id` 與 claim log 的 Auth UUID 沒有 FK | Migration preflight 驗證 orphan／duplicate，決定是否建立 constraint |

## 11. Gate 1 Exit Recommendation

已完成：

- [x] Tables、Columns、row-count catalog。
- [x] Views、Functions/RPC、Policies、Grants catalog。
- [x] Indexes、Constraints、Triggers、Realtime catalog。
- [x] Legacy User → Auth UUID aggregate mapping report。
- [x] Supabase Security／Performance Advisor review。

尚未授權：

- [ ] Target Schema Decision。
- [ ] Repeatable Migration / Preflight Health Check / Rollback Script。
- [ ] RLS、View、RPC remediation。
- [ ] Domain JS、UI 或 Shared Gateway Coding。

Final Gate status：

```text
Gate 1 Discovery: PASS
Gate 1 PM Review: APPROVED
Coding: NOT AUTHORIZED
Next Decision: UUID Migration + Security Remediation Design
```
