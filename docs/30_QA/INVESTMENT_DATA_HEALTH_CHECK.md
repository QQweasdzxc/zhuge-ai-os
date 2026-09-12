# Investment Gate 2 — Data Health Check

Document Version: 1.0
Decision Status: Proposed for PM Review
Execution Status: Not Authorized
Query Policy: Read-only and repeatable

## 1. Purpose

本文件定義 Investment UUID migration 前後必須重複執行的資料驗證。Health Check 不修資料，只產生 evidence；任何 fail 都交由 Runbook 決定 No-Go 或 Rollback。

每次執行必須記錄：

- Project Ref、database version、schema version。
- Query Set version/Git SHA。
- UTC timestamp + Asia/Taipei display time。
- Runtime Version/Build/Commit。
- Operator and reviewer。
- Before/After evidence checksum。

## 2. Execution Safety

所有 query 必須使用 read-only session：

```sql
begin transaction read only;

-- Run one approved query set.

rollback;
```

禁止在 Health Check 混入：`INSERT`、`UPDATE`、`DELETE`、`ALTER`、`DROP`、`CREATE`、`TRUNCATE` 或 RPC mutation。

## 3. Check Result Contract

| Result | Meaning |
| --- | --- |
| PASS | Expected equality/zero blocker |
| REVIEW | 合法資料可能觸發，需要 PM/Domain review |
| BLOCKED | Migration不得開始或繼續 |
| NOT AVAILABLE | Schema/Domain engine尚未提供，Gate不能誤判 PASS |

## 4. Identity Mapping Checks

### HC-ID-001 — Mapping classification

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
), classified as (
  select *,
    case
      when auth_user_id is null then 'E_INVALID_BLOCKED'
      when not auth_user_exists then 'C_ORPHAN_AUTH'
      when app_users_per_auth > 1 then 'D_DUPLICATE_MAPPING'
      else 'A_CANDIDATE_REQUIRES_ATTESTATION'
    end as mapping_class
  from mapping
)
select mapping_class, count(*) as mapping_count
from classified
group by mapping_class
order by mapping_class;
```

Pass：只有 `A_CANDIDATE_REQUIRES_ATTESTATION`，且 PM attestation完成。

### HC-ID-002 — Duplicate Auth mapping

```sql
select auth_user_id, count(*) as legacy_users
from public.app_users
where auth_user_id is not null
group by auth_user_id
having count(*) > 1;
```

Expected：0 rows。Evidence 輸出時應遮罩 UUID。

### HC-ID-003 — Legacy owner orphan

```sql
select 'portfolios' as object_name, count(*) as orphan_count
from public.portfolios d
left join public.app_users u on u.id = d.user_id
where u.id is null
union all
select 'opening_positions', count(*)
from public.opening_positions d
left join public.app_users u on u.id = d.user_id
where u.id is null
union all
select 'transactions', count(*)
from public.transactions d
left join public.app_users u on u.id = d.user_id
where u.id is null
union all
select 'watchlists', count(*)
from public.watchlists d
left join public.app_users u on u.id = d.user_id
where u.id is null
union all
select 'strategies', count(*)
from public.strategies d
left join public.app_users u on u.id = d.user_id
where u.id is null
union all
select 'decision_logs', count(*)
from public.decision_logs d
left join public.app_users u on u.id = d.user_id
where u.id is null;
```

Expected：all zero。

### HC-ID-004 — Dual-column invariant（Option B stage only）

此 query 只能在 temporary `auth_user_id` 已存在後使用：

```sql
select 'portfolios' as object_name, count(*) as mismatch_count
from public.portfolios d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id
union all
select 'opening_positions', count(*)
from public.opening_positions d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id
union all
select 'transactions', count(*)
from public.transactions d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id
union all
select 'watchlists', count(*)
from public.watchlists d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id
union all
select 'strategies', count(*)
from public.strategies d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id
union all
select 'decision_logs', count(*)
from public.decision_logs d
join public.app_users u on u.id = d.user_id
where d.auth_user_id is distinct from u.auth_user_id;
```

Expected：all zero。

## 5. Row Count Checks

### HC-ROW-001 — Total counts

```sql
select 'app_users' as object_name, count(*)::bigint as row_count from public.app_users
union all select 'portfolios', count(*) from public.portfolios
union all select 'opening_positions', count(*) from public.opening_positions
union all select 'transactions', count(*) from public.transactions
union all select 'watchlists', count(*) from public.watchlists
union all select 'strategies', count(*) from public.strategies
union all select 'decision_logs', count(*) from public.decision_logs
union all select 'user_settings', count(*) from public.user_settings
union all select 'onboarding_state', count(*) from public.onboarding_state
union all select 'identity_claim_logs', count(*) from public.identity_claim_logs
order by object_name;
```

Before/After expected：exact equality，除非 Runbook 明確批准新增 audit row。

### HC-ROW-002 — Per-owner counts

```sql
with counts as (
  select 'portfolios' object_name, user_id, count(*) row_count from public.portfolios group by user_id
  union all select 'opening_positions', user_id, count(*) from public.opening_positions group by user_id
  union all select 'transactions', user_id, count(*) from public.transactions group by user_id
  union all select 'watchlists', user_id, count(*) from public.watchlists group by user_id
  union all select 'strategies', user_id, count(*) from public.strategies group by user_id
  union all select 'decision_logs', user_id, count(*) from public.decision_logs group by user_id
)
select object_name, md5(user_id::text) as owner_evidence_key, row_count
from counts
order by object_name, owner_evidence_key;
```

`md5` 只用於避免一般 evidence 顯示 raw UUID，不是安全匿名化方法；完整 manifest 應存放在受限位置。

## 6. Foreign Key and Ownership Chain

### HC-FK-001 — Portfolio orphan

```sql
select 'opening_positions' object_name, count(*) orphan_count
from public.opening_positions d
left join public.portfolios p on p.id = d.portfolio_id
where d.portfolio_id is not null and p.id is null
union all
select 'transactions', count(*)
from public.transactions d
left join public.portfolios p on p.id = d.portfolio_id
where d.portfolio_id is not null and p.id is null
union all
select 'watchlists', count(*)
from public.watchlists d
left join public.portfolios p on p.id = d.portfolio_id
where d.portfolio_id is not null and p.id is null
union all
select 'strategies', count(*)
from public.strategies d
left join public.portfolios p on p.id = d.portfolio_id
where d.portfolio_id is not null and p.id is null
union all
select 'decision_logs', count(*)
from public.decision_logs d
left join public.portfolios p on p.id = d.portfolio_id
where d.portfolio_id is not null and p.id is null;
```

Expected：all zero。

### HC-FK-002 — Cross-owner portfolio link

```sql
select 'opening_positions' object_name, count(*) mismatch_count
from public.opening_positions d
join public.portfolios p on p.id = d.portfolio_id
where d.user_id <> p.user_id
union all
select 'transactions', count(*)
from public.transactions d
join public.portfolios p on p.id = d.portfolio_id
where d.user_id <> p.user_id
union all
select 'watchlists', count(*)
from public.watchlists d
join public.portfolios p on p.id = d.portfolio_id
where d.user_id <> p.user_id
union all
select 'strategies', count(*)
from public.strategies d
join public.portfolios p on p.id = d.portfolio_id
where d.user_id <> p.user_id
union all
select 'decision_logs', count(*)
from public.decision_logs d
join public.portfolios p on p.id = d.portfolio_id
where d.user_id <> p.user_id;
```

Expected：all zero。

### HC-FK-003 — Final Auth owner validity（post-cutover only）

```sql
select 'portfolios' object_name, count(*) invalid_owner_count
from public.portfolios d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null
union all
select 'opening_positions', count(*)
from public.opening_positions d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null
union all
select 'transactions', count(*)
from public.transactions d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null
union all
select 'watchlists', count(*)
from public.watchlists d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null
union all
select 'strategies', count(*)
from public.strategies d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null
union all
select 'decision_logs', count(*)
from public.decision_logs d
left join auth.users u on u.id = d.user_id
where d.user_id is null or u.id is null;
```

Expected：all zero。

## 7. Duplicate Checks

### HC-DUP-001 — Constraint-backed duplicates

```sql
select user_id, portfolio_id, symbol, market, bootstrap_at, count(*) duplicate_count
from public.opening_positions
group by user_id, portfolio_id, symbol, market, bootstrap_at
having count(*) > 1;

select user_id, symbol, market, count(*) duplicate_count
from public.watchlists
group by user_id, symbol, market
having count(*) > 1;

select user_id, setting_key, count(*) duplicate_count
from public.user_settings
group by user_id, setting_key
having count(*) > 1;
```

Expected：0 rows。

### HC-DUP-002 — Transaction duplicate candidates

```sql
select
  user_id,
  portfolio_id,
  trade_date,
  trade_type,
  symbol,
  quantity,
  price,
  gross_amount,
  fee,
  tax,
  currency,
  count(*) as candidate_count
from public.transactions
group by
  user_id, portfolio_id, trade_date, trade_type, symbol,
  quantity, price, gross_amount, fee, tax, currency
having count(*) > 1;
```

Result = REVIEW，不能自動刪除；同日相同價格與數量可能是真實分批交易。

## 8. Financial Aggregate Checks

### 8.1 Existing calculation contract

Migration source `IW_CORE.summarize()` 目前使用 `current_positions_view` 的：

- `invested_cost`
- `market_value`
- `unrealized_pnl`
- Currency split：TWD / USD
- ROI：`unrealized_pnl / invested_cost * 100`

它沒有 realized P&L calculation。

### HC-FIN-001 — Position financial snapshot

```sql
select
  md5(user_id::text) as owner_evidence_key,
  portfolio_id,
  currency,
  market,
  count(*) as position_count,
  sum(coalesce(quantity, 0)) as total_quantity,
  sum(coalesce(invested_cost, 0)) as invested_cost,
  sum(coalesce(market_value, 0)) as market_value,
  sum(coalesce(unrealized_pnl, 0)) as unrealized_pnl,
  case
    when sum(coalesce(invested_cost, 0)) = 0 then 0
    else sum(coalesce(unrealized_pnl, 0)) / sum(coalesce(invested_cost, 0)) * 100
  end as unrealized_roi_pct
from public.current_positions_view
group by user_id, portfolio_id, currency, market
order by owner_evidence_key, portfolio_id, currency, market;
```

Before/After：每個 dimension exact equality，display rounding除外。

### HC-FIN-002 — Transaction ledger aggregate

```sql
select
  md5(user_id::text) as owner_evidence_key,
  portfolio_id,
  currency,
  market,
  trade_type,
  count(*) as transaction_count,
  sum(coalesce(quantity, 0)) as quantity,
  sum(coalesce(gross_amount, 0)) as gross_amount,
  sum(coalesce(fee, 0)) as fee,
  sum(coalesce(tax, 0)) as tax,
  sum(coalesce(net_amount, 0)) as net_amount
from public.transactions
group by user_id, portfolio_id, currency, market, trade_type
order by owner_evidence_key, portfolio_id, currency, market, trade_type;
```

用途：驗證交易筆數、現金流、費稅、TWD/USD、TW/US分類沒有 migration drift。

### HC-FIN-003 — Holdings projection

```sql
select
  md5(user_id::text) as owner_evidence_key,
  portfolio_id,
  market,
  count(*) as holding_count,
  sum(coalesce(quantity, 0)) as quantity,
  sum(coalesce(invested_cost, 0)) as invested_cost
from public.holdings_view
group by user_id, portfolio_id, market
order by owner_evidence_key, portfolio_id, market;
```

注意：在 View 改為 security-invoker 後，DB operator snapshot與User session snapshot需分開執行並註明角色。

### HC-FIN-004 — Currency and market completeness

```sql
select 'opening_positions' object_name, currency, market, count(*) row_count
from public.opening_positions
group by currency, market
union all
select 'transactions', currency, market, count(*)
from public.transactions
group by currency, market
order by object_name, currency, market;
```

Expected：Before/After dimension set和counts相同。未知 market/currency值 = REVIEW。

### HC-FIN-005 — Realized P&L

Current status：**NOT AVAILABLE / Gate 2 Blocking Decision**。

現有 Schema 沒有 `realized_pnl` 欄位，`holdings_view` 也沒有處分成本基礎；Migration source只計算未實現損益。不能以 `net_amount` 冒充 realized P&L。

PM 必須先核准正式算法，例如：

- Weighted average cost。
- FIFO。
- Broker-provided realized P&L as source of truth。

核准後必須建立 versioned calculation contract，例如：

```text
InvestmentRealizedPnlEngine v1
input: ordered transaction ledger
output: owner / portfolio / currency / market / realized_pnl
```

在算法與 baseline snapshot未完成前，Runbook Step 8 不得標記 PASS。

## 9. Deterministic Table Fingerprints

Fingerprint 用於偵測非預期 row mutation，不取代 financial aggregate。

```sql
select 'portfolios' object_name,
       count(*) row_count,
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) fingerprint
from public.portfolios t
union all
select 'opening_positions', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), ''))
from public.opening_positions t
union all
select 'transactions', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), ''))
from public.transactions t
union all
select 'watchlists', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), ''))
from public.watchlists t
union all
select 'strategies', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), ''))
from public.strategies t
union all
select 'decision_logs', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), ''))
from public.decision_logs t;
```

Dual-column backfill本來會改變 fingerprint，因此比較時需使用排除temporary owner欄位的 versioned fingerprint query；不能直接比較 `to_jsonb(*)`。

## 10. RLS Isolation Check（Staging/Test only）

以真實 Supabase client sessions執行為主。Database test harness可在 rollback transaction中設定 sanitized test JWT claims：

```text
User A AAL1:
  own SELECT = rows
  User B SELECT = zero
  transaction INSERT/UPDATE/DELETE = denied

User A AAL2:
  own transaction mutation = allowed
  User B mutation = denied

Anon:
  all Investment Table/View/RPC = denied
```

不得將 User A/B access token寫入 evidence；只記 session label、AAL、HTTP status與row count。

## 11. Health Check Exit Criteria

- Identity mapping：A only + PM attestation。
- NULL/orphan/cross-owner：0。
- Row counts：exact match。
- Constraint-backed duplicates：0。
- Transaction duplicate candidates：reviewed。
- Position/transaction/holdings aggregates：exact match。
- TWD/USD與TW/US dimensions：exact match。
- Realized P&L：approved engine + baseline available。
- Fingerprints：符合該 migration stage的預期變化。
- RLS isolation：all negative tests denied。

## 12. PM Decision Points

1. 選擇 realized P&L 正式算法與來源。
2. 核准 financial comparison tolerance（推薦 raw numeric exact）。
3. 核准 evidence是否保存 raw UUID；推薦一般報告只保留 evidence key。
4. 核准 transaction duplicate candidate人工review規則。
5. 核准 market/currency允許清單與unknown value處理方式。
